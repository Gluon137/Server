# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded box/flat-board fabrication. Nominal solids and laser burn stay separate."""
from copy import deepcopy
import html
import math
import re
import numpy as np
from shapely import affinity
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, LineString, Point, box as rect
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from rectpack import newPacker
from adapters import FingerProfiles, contour_path, circle_path, flex_lines

EPS = 1e-7
BASE_IDS = {'bottom','front','back','left','right','lid','wrap','bottom-ring','top-ring','lid-ring','rail-left','rail-right','hinge-left','hinge-right','hinge-lid-left','hinge-lid-right','seam-strap'}
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$')


def default_project():
    return {'version':1,'box':{'shape':'rect','width':200,'depth':140,'height':100,'radius':20,'dimensions':'outer','lid':'removable'},
      'material':{'thickness':3,'finger':9,'play':0.15,'burn':0,'flexStretch':1.05,'flexPitch':3},
      'parts':[],'features':[],'groups':[],'hardware':[],
      'layout':{'width':600,'height':400,'margin':5,'spacing':5,'rotate':True}}


def _num(value, path, lo=-10000, hi=10000):
    if type(value) not in (int,float) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f'{path}: endliche Zahl zwischen {lo:g} und {hi:g} erwartet.')
    return float(value)


def _vec(value,path,n=3,lo=-10000,hi=10000):
    if type(value) is not list or len(value)!=n:
        raise ValueError(f'{path}: {n} Koordinaten erwartet.')
    return [_num(v,path,lo,hi) for v in value]


def _enum(value,choices,path):
    if value not in choices:
        raise ValueError(f'{path}: unbekannter Wert.')


def _motion(m,path):
    if type(m) is not dict: raise ValueError(f'{path}: Objekt erwartet.')
    _enum(m.get('type','fixed'),('fixed','slider','revolute'),path+'.type')
    axis=_vec(m.get('axis',[0,0,1]),path+'.axis')
    if np.linalg.norm(axis)<EPS: raise ValueError(f'{path}: Bewegungsachse darf nicht null sein.')
    _vec(m.get('pivot',[0,0,0]),path+'.pivot')
    lo=_num(m.get('min',0),path+'.min',-3000,3000)
    hi=_num(m.get('max',90),path+'.max',-3000,3000)
    value=_num(m.get('value',0),path+'.value',-3000,3000)
    if not lo<=value<=hi: raise ValueError(f'{path}: min ≤ value ≤ max erwartet.')
    if m.get('type')=='revolute' and hi-lo>720: raise ValueError(f'{path}: höchstens zwei Umdrehungen erlaubt.')


def validate_project(project):
    if type(project) is not dict or project.get('version')!=1 or type(project.get('version')) is not int:
        raise ValueError('Projektversion muss 1 sein.')
    # Reject non-finite values even in ignored metadata: responses use strict JSON.
    stack=[(project,0)];nodes=0
    while stack:
        value,depth=stack.pop();nodes+=1
        if depth>32 or nodes>100000:raise ValueError('Projekt verschachtelt oder zu komplex.')
        if type(value) is float and not math.isfinite(value):raise ValueError('Nicht endliche Projektzahl.')
        if type(value) is dict:stack.extend((v,depth+1) for v in value.values())
        elif type(value) is list:stack.extend((v,depth+1) for v in value)
    p=deepcopy(default_project())
    p.update(deepcopy(project))
    for key in ('box','material','layout'):
        if type(project.get(key,{})) is not dict: raise ValueError(f'{key}: Objekt erwartet.')
        p[key]={**default_project()[key],**project.get(key,{})}
    b,m,l=p['box'],p['material'],p['layout']
    _enum(b['shape'],('rect','rounded','cylinder'),'box.shape')
    _enum(b['lid'],('none','removable','sliding','hinged'),'box.lid')
    _enum(b['dimensions'],('outer','inner'),'box.dimensions')
    for k in ('width','depth','height','radius'): _num(b[k],'box.'+k,1,3000)
    _num(b.get('lidValue',0),'box.lidValue',0,3000)
    for k,lo,hi in [('thickness',.5,30),('finger',.5,300),('play',0,5),('burn',0,2),('flexStretch',.8,1.3),('flexPitch',.5,20)]: _num(m[k],'material.'+k,lo,hi)
    for k in ('width','height'): _num(l[k],'layout.'+k,10,10000)
    for k in ('margin','spacing'): _num(l[k],'layout.'+k,0,1000)
    if type(l['rotate']) is not bool: raise ValueError('layout.rotate muss boolesch sein.')
    for key,limit in [('parts',128),('features',512),('groups',64),('hardware',128)]:
        if type(p[key]) is not list or len(p[key])>limit: raise ValueError(f'{key}: maximal {limit} Einträge erlaubt.')
        if any(type(x) is not dict for x in p[key]): raise ValueError(f'{key}: Objekte erwartet.')
    ids=set(BASE_IDS)
    for part in p['parts']:
        ident=part.get('id')
        if type(ident) is not str or not ID.fullmatch(ident) or ident in ids: raise ValueError('Zusatzplatten benötigen eindeutige, sichere IDs.')
        ids.add(ident)
        if type(part.get('host','bottom')) is not str: raise ValueError('part.host: Platten-ID erwartet.')
        _enum(part.get('kind','custom'),('custom','divider','shelf','reinforcement','decoration','slider','rotor'),'part.kind')
        _enum(part.get('shape','rect'),('rect','circle','polygon','svg'),'part.shape')
        _enum(part.get('connection','none'),('none','glue','screw','tabs'),'part.connection')
        _enum(part.get('fit','fixed'),('fixed','width','height','both'),'part.fit')
        for key in ('width','height'): _num(part.get(key,60),'part.'+key,.5,3000)
        _vec(part.get('rotation',[0,0,0]),'part.rotation',lo=-3600,hi=3600)
        _num(part.get('offset',0),'part.offset',-3000,3000)
        _motion(part.get('motion',{}),'part.motion')
    seen_features=set(); total_points=0; generated_points=0
    for item in p['parts']+p['features']:
        if 'name' in item and (type(item['name']) is not str or len(item['name'])>200): raise ValueError('Name: höchstens 200 Zeichen.')
        for key in ('source','text'):
            if key in item and (type(item[key]) is not str or len(item[key])>2*1024*1024): raise ValueError('Importtext überschreitet das Zeichenbudget.')
        for key in ('points','contours','lines'):
            value=item.get(key,[])
            if type(value) is not list: raise ValueError(f'{key}: Koordinatenliste erwartet.')
            loops=[value] if key=='points' else value
            for loop in loops:
                if type(loop) is not list: raise ValueError('Kontur muss eine Liste sein.')
                total_points+=len(loop)
                if total_points>12000: raise ValueError('Maximal 12000 importierte Konturpunkte erlaubt.')
                for point in loop: _vec(point,'Konturpunkt',2)
        anchor=item.get('anchor',{})
        if type(anchor) is not dict: raise ValueError('anchor: Objekt erwartet.')
        for axis in ('u','v'): _enum(anchor.get(axis,'center'),('start','center','end','relative'),'anchor.'+axis)
        for key in ('x','y'): _num(anchor.get(key,0),'anchor.'+key,-3000,3000)
    for feature in p['features']:
        ident=feature.get('id')
        if type(ident) is not str or not ID.fullmatch(ident) or ident in seen_features: raise ValueError('Features benötigen eindeutige IDs.')
        seen_features.add(ident)
        if type(feature.get('partId')) is not str: raise ValueError('feature.partId: Platten-ID erwartet.')
        _enum(feature.get('shape','circle'),('circle','rect','slot','polygon','pattern','svg','text'),'feature.shape')
        _enum(feature.get('operation','cut'),('cut','engrave'),'feature.operation')
        for key in ('x','y'): _num(feature.get(key,0),'feature.'+key,-3000,3000)
        for key in ('width','height'): _num(feature.get(key,10),'feature.'+key,.1,3000)
        _num(feature.get('angle',0),'feature.angle',-3600,3600)
        _num(feature.get('pitch',12),'feature.pitch',.1,3000)
        if type(feature.get('count',3)) is not int or not 1<=feature.get('count',3)<=128: raise ValueError('Musteranzahl muss zwischen 1 und 128 liegen.')
        generated_points += 192 * (feature.get('count',3) if feature.get('shape')=='pattern' else 1)
        if generated_points>80000: raise ValueError('Das Feature-Muster überschreitet das Geometriebudget.')
    grouped=set(); groupids=set()
    for group in p['groups']:
        ident=group.get('id')
        if type(ident) is not str or not ID.fullmatch(ident) or ident in groupids: raise ValueError('Gruppen benötigen eindeutige IDs.')
        groupids.add(ident)
        if type(group.get('name','')) is not str or len(group.get('name',''))>200:raise ValueError('Ungültiger Gruppenname.')
        members=group.get('partIds',[])
        if type(members) is not list or len(members)>128 or any(type(k) is not str for k in members) or len(set(members))!=len(members): raise ValueError('Ungültige Gruppenmitglieder.')
        if any(type(k) is not str or k not in ids or k in grouped for k in members): raise ValueError('Gruppen enthalten unbekannte oder doppelt gruppierte Platten.')
        grouped.update(members); _motion(group.get('motion',{}),'group.motion')
    for part in p['parts']:
        if part['id'] in grouped and part.get('motion',{}).get('type','fixed')!='fixed': raise ValueError('Gruppierte Platten benötigen feste Einzelbewegungen.')
    for hardware in p['hardware']:
        if 'id' in hardware and (type(hardware['id']) is not str or not ID.fullmatch(hardware['id'])):raise ValueError('Ungültige Hardware-ID.')
        if type(hardware.get('name','')) is not str or len(hardware.get('name',''))>200: raise ValueError('Ungültiger Hardware-Name.')
        if type(hardware.get('quantity')) is not int or not 1<=hardware['quantity']<=10000: raise ValueError('Hardwareanzahl muss zwischen 1 und 10000 liegen.')
        for key in ('diameter','length'): _num(hardware.get(key,0),'hardware.'+key,0,3000)
    return p


def _err(errors,code,message,ids=None,feature=None):
    e={'code':code,'message':message,'partIds':ids or []}
    if feature: e['featureId']=feature
    errors.append(e)


def _loop(ring): return [[round(x,8),round(y,8)] for x,y in list(ring.coords)[:-1]]

def _frame(origin,u,v,normal=None):
    u=np.asarray(u,dtype=float);v=np.asarray(v,dtype=float)
    n=np.asarray(normal,dtype=float) if normal is not None else np.cross(u,v)
    return {'origin':list(map(float,origin)),'u':u.tolist(),'v':v.tolist(),'normal':n.tolist()}


def _part(ident,name,shape,t,frame,protected=None,**extra):
    return {'id':ident,'name':name,'thickness':t,'frame':frame,'_shape':shape,
            'bounds':list(shape.bounds),'engrave':[],'flexCuts':[],
            '_protected':protected or [],**extra}


def _world(p,point,depth=0):
    if p.get('surface'):
        return _surface_frame(p,point)['origin']+np.asarray(_surface_frame(p,point)['normal'])*depth
    f=p['frame'];return np.asarray(f['origin'])+np.asarray(f['u'])*point[0]+np.asarray(f['v'])*point[1]+np.asarray(f['normal'])*depth


def _surface_frame(p,point):
    samples=p['surface']['samples'];s=float(point[0])
    index=next((i for i in range(len(samples)-1) if samples[i]['s']<=s<=samples[i+1]['s']),0 if s<samples[0]['s'] else len(samples)-2)
    a,b=samples[index:index+2];f=(s-a['s'])/(b['s']-a['s'])
    normal=np.array([a['nx']*(1-f)+b['nx']*f,a['ny']*(1-f)+b['ny']*f,0]);normal/=np.linalg.norm(normal)
    tangent=np.array([b['x']-a['x'],b['y']-a['y'],0]);tangent/=np.linalg.norm(tangent)
    # Interpolated normals and secants differ slightly on an arc; keep frame orthogonal.
    tangent-=normal*np.dot(normal,tangent);tangent/=np.linalg.norm(tangent)
    return {'origin':np.array([a['x']*(1-f)+b['x']*f,a['y']*(1-f)+b['y']*f,p['surface']['z']+point[1]]),
            'u':tangent,'v':np.array([0,0,1]),'normal':normal}


def _local(p,world):
    f=p['frame'];d=np.asarray(world)-f['origin'];return [float(np.dot(d,f['u'])),float(np.dot(d,f['v']))]


def _strip(shape,side,start,end,t):
    x0,y0,x1,y1=shape.bounds
    return {'bottom':rect(start,y0,end,y0+t),'top':rect(start,y1-t,end,y1),
            'left':rect(x0,start,x0+t,end),'right':rect(x1-t,start,x1,end)}[side]


def _rect_box(p,errors,hardware,joints):
    b,m=p['box'],p['material'];t=m['thickness'];W,D,H=b['width'],b['depth'],b['height']
    if b['dimensions']=='inner':
        W+=2*t;D+=2*t;H+=3*t+m['play'] if b['lid']=='sliding' else t
    elif b['lid'] in ('removable','hinged'):H-=t
    parts=[_part('bottom','Boden',rect(0,0,W,D),t,_frame([0,0,0],[1,0,0],[0,1,0])),
      _part('front','Vorderwand',rect(0,0,W,H),t,_frame([0,0,0],[1,0,0],[0,0,1],[0,1,0])),
      _part('back','Rückwand',rect(0,0,W,H),t,_frame([0,D,0],[1,0,0],[0,0,1],[0,-1,0])),
      _part('left','Linke Wand',rect(0,0,D,H),t,_frame([0,0,0],[0,1,0],[0,0,1],[1,0,0])),
      _part('right','Rechte Wand',rect(0,0,D,H),t,_frame([W,0,0],[0,1,0],[0,0,1],[-1,0,0]))]
    by={x['id']:x for x in parts}
    if min(W,D,H)<6*t:
        _err(errors,'BOX_TOO_SMALL','Die Abmessungen müssen mindestens sechs Materialstärken betragen.');return parts
    profiles=FingerProfiles({'thickness':t,'relative':False,'finger':m['finger'],'space':m['finger'],'surroundingspaces':1,'play':m['play']})
    seams=[('bottom','bottom','front','bottom',W),('bottom','top','back','bottom',W),
      ('bottom','left','left','bottom',D),('bottom','right','right','bottom',D),
      ('front','left','left','left',H),('front','right','right','left',H),
      ('back','left','left','right',H),('back','right','right','right',H)]
    for aid,aside,bid,bside,length in seams:
        a,bb=by[aid],by[bid];base_a,base_b=rect(*a['bounds']),rect(*bb['bounds'])
        try: pos,negative=profiles.intervals(length-2*t)
        except ValueError:
            _err(errors,'JOINT_TOO_SHORT','Eine Kante ist zu kurz für die gewählte Zinkenbreite.',[aid,bid]);continue
        # Corner shoulders connect trihedral cubes to the face interior.
        shoulders=[(-1e-6,t+1e-6),(length-3*t-1e-6,length-2*t+1e-6)]
        pos=list(pos)+shoulders;negative=list(negative)+shoulders
        keep=unary_union([_strip(base_a,aside,s+t,e+t,t) for s,e in pos])
        full=_strip(base_a,aside,t,length-t,t)
        a['_shape']=a['_shape'].difference(full.difference(keep))
        cuts=[_strip(base_b,bside,s+t,e+t,t) for s,e in negative]
        # The earlier panel owns trihedral corner cubes: Z, then Y, then X.
        cuts += [_strip(base_b,bside,0,t,t),_strip(base_b,bside,length-t,length,t)]
        bb['_shape']=bb['_shape'].difference(unary_union(cuts))
        a['_protected'].append(_strip(base_a,aside,0,length,t*1.5))
        bb['_protected'].append(_strip(base_b,bside,0,length,t*1.5))
    lid=b['lid'];play=m['play']
    if lid in ('removable','hinged'):
        top=_part('lid','Deckel',rect(0,0,W,D-max(play,.05) if lid=='hinged' else D),t,_frame([0,0,H],[1,0,0],[0,1,0]))
        parts.append(top)
        if lid=='removable':
            ring=rect(t+play,t+play,W-t-play,D-t-play).difference(rect(2*t+play,2*t+play,W-2*t-play,D-2*t-play))
            parts.append(_part('lid-ring','Deckel-Führungsring',ring,t,_frame([0,0,H-t],[1,0,0],[0,1,0])))
            top['_protected'].append(ring)
            parts[-1]['_protected'].append(ring)
            hardware.append({'id':'lid-glue','name':'Holzleim: Deckel-Führungsring','quantity':1,'diameter':0,'length':0})
    elif lid=='sliding':
        # Lid travels out through the shortened front; rails support its underside.
        z=H-2*t-play
        by['front']['_shape']=by['front']['_shape'].intersection(rect(0,0,W,z))
        top=_part('lid','Schiebedeckel',rect(t+play,0,W-t-play,D-t-play),t,_frame([0,0,z],[1,0,0],[0,1,0]))
        parts.append(top)
        for side,x in [('left',t),('right',W-2*t)]:
            parts.append(_part('rail-'+side,'Deckelschiene '+side,rect(0,0,t,D-2*t),t,_frame([x,t,z-t],[1,0,0],[0,1,0])))
            parts[-1]['_protected'].append(parts[-1]['_shape'])
        hardware.append({'id':'rail-glue','name':'Holzleim: zwei Deckelschienen','quantity':1,'diameter':0,'length':0})
        joints.append({'id':'lid-motion','name':'Schiebedeckel','partIds':['lid'],'type':'slider','axis':[0,-1,0],'pivot':[0,0,z],'min':0,'max':D-t,'value':0,'contacts':[]})
    if lid=='hinged':
        # Four external hinge cheeks, alternating along the pin. Pin runs along X.
        radius=2*t;cy=D+2*t;cz=H-t
        moving=['lid'];contacts=[]
        for side,x in [('left',3*t),('right',W-6*t)]:
            fixedshape=rect(D,H-3*t,cy,cz).union(Point(cy,cz).buffer(radius,quad_segs=16))
            fixedshape=fixedshape.difference(Point(cy,cz).buffer(t/2+play,quad_segs=16))
            fixed=_part('hinge-'+side,'Scharnierlager '+side,fixedshape,t,_frame([x,0,0],[0,1,0],[0,0,1],[1,0,0]))
            moving_shape=rect(D-max(play,.05),H,cy,H+t).union(Point(cy,cz).buffer(radius,quad_segs=16))
            moving_shape=moving_shape.difference(Point(cy,cz).buffer(t/2+play,quad_segs=16))
            mov=_part('hinge-lid-'+side,'Deckel-Scharnier '+side,moving_shape,t,_frame([x+t+play,0,0],[0,1,0],[0,0,1],[1,0,0]))
            parts.extend([fixed,mov]);moving.append(mov['id'])
            fixed['_protected'].append(fixedshape);mov['_protected'].append(moving_shape)
        hardware.extend([{'id':'hinge-pin','name':'Scharnierachse / Rundstab','quantity':1,'diameter':t,'length':W},
          {'id':'hinge-glue','name':'Holzleim: vier Scharnierwangen','quantity':1,'diameter':0,'length':0}])
        joints.append({'id':'lid-motion','name':'Klappdeckel','partIds':moving,'type':'revolute','axis':[-1,0,0],'pivot':[0,cy,cz],'min':0,'max':110,'value':0,'contacts':contacts})
    return parts


def _rounded(w,d,r):
    return rect(r,r,w-r,d-r).buffer(r,quad_segs=24) if r>EPS else rect(0,0,w,d)


def _curved_box(p,errors,hardware,joints):
    b,m=p['box'],p['material'];t=m['thickness'];play=m['play'];stretch=m['flexStretch']
    W,D,H=b['width'],b['depth'],b['height']
    if b['shape']=='cylinder':D=W
    if b['dimensions']=='inner':W+=2*t;D+=2*t;H+=t
    elif b['lid']=='removable':H-=t
    r=W/2 if b['shape']=='cylinder' else b['radius']
    if min(W,D,H)<8*t or r<3*t or r>min(W,D)/2:
        _err(errors,'CURVE_RADIUS','Rundungen benötigen Radius ≥ drei Materialstärken und passende Abmessungen.');return []
    if b['lid'] not in ('none','removable'):
        _err(errors,'CURVED_LID','Runde Formen unterstützen offene und abnehmbare Deckel.');return []
    outer=Point(W/2,D/2).buffer(W/2,quad_segs=64) if b['shape']=='cylinder' else _rounded(W,D,r)
    if b['shape']=='cylinder':
        inside=Point(W/2,D/2).buffer(r-t-play-.05,quad_segs=64)
        collar=inside.difference(Point(W/2,D/2).buffer(r-2*t-play-.05,quad_segs=64))
    else:
        inside=outer.buffer(-t-play-.05,quad_segs=16); collar=inside.difference(outer.buffer(-2*t-play-.05,quad_segs=16))
    parts=[_part('bottom','Boden',inside,t,_frame([0,0,0],[1,0,0],[0,1,0])),
      _part('bottom-ring','Boden-Haltering',collar,t,_frame([0,0,t],[1,0,0],[0,1,0])),
      _part('top-ring','Oberer Haltering',collar,t,_frame([0,0,H-t],[1,0,0],[0,1,0]))]
    # Exact outer mapping; developed neutral axis accounts for stretch only in arcs.
    samples=[];zones=[];s=0.0
    if b['shape']=='cylinder':
        circumference=2*math.pi*(r-t/2);length=circumference/stretch
        for i in range(257):
            a=2*math.pi*i/256;samples.append({'s':length*i/256,'x':W/2+r*math.cos(a),'y':D/2+r*math.sin(a),'nx':-math.cos(a),'ny':-math.sin(a)})
        zones=[(0,length)];s=length
    else:
        segments=[('line',(r,0),(W-r,0)),('arc',(W-r,r),(-90,0)),('line',(W,r),(W,D-r)),('arc',(W-r,D-r),(0,90)),
          ('line',(W-r,D),(r,D)),('arc',(r,D-r),(90,180)),('line',(0,D-r),(0,r)),('arc',(r,r),(180,270))]
        for typ,a,bb in segments:
            if typ=='line':
                length=math.dist(a,bb)
                if length<EPS:continue
                dx=(bb[0]-a[0])/length;dy=(bb[1]-a[1])/length
                samples.append({'s':s,'x':a[0],'y':a[1],'nx':-dy,'ny':dx});s+=length
                samples.append({'s':s,'x':bb[0],'y':bb[1],'nx':-dy,'ny':dx})
            else:
                length=math.pi/2*(r-t/2)/stretch;start=s;zones.append((start,start+length))
                for i in range(33):
                    ang=math.radians(bb[0]+(bb[1]-bb[0])*i/32)
                    samples.append({'s':start+length*i/32,'x':a[0]+r*math.cos(ang),'y':a[1]+r*math.sin(ang),'nx':-math.cos(ang),'ny':-math.sin(ang)})
                s+=length
    # Retain every arc endpoint once; s is strictly monotone for interpolation.
    unique=[]
    for sample in samples:
        if unique and abs(unique[-1]['s']-sample['s'])<EPS: unique[-1]=sample
        else: unique.append(sample)
    wrap=_part('wrap','Flexmantel',rect(0,0,s,H),t,_frame([0,0,0],[1,0,0],[0,0,1],[0,1,0]),surface={'type':'wrap','samples':unique,'z':0})
    wrap['_protected']=[rect(0,0,s,2*t),rect(0,H-2*t,s,H),rect(0,0,2*t,H),rect(s-2*t,0,s,H)]
    for lo,hi in zones:
        width=hi-lo
        if width<2*m['flexPitch']:
            _err(errors,'FLEX_TOO_SHORT','Der Bogen ist für das Flexraster zu kurz.',['wrap']);continue
        # Slits retain top/bottom webs, and are genuine upstream FlexEdge output.
        wrap['flexCuts']+=flex_lines(width,H-2*t,t,m['flexPitch'],stretch,lo,t)
        wrap['_protected'].append(rect(lo,0,hi,H))
    parts.append(wrap)
    # A seam strap glues to the inner tangent at the developed seam.
    span=max(4*t,3*m['flexPitch']);strap_samples=[]
    # A second short developed flex strip follows the inner seam curvature.
    # Its 0.1mm glue gap also encloses the chord approximation tolerance.
    sample_positions={0.0,span,span/2}
    for q in unique:
        rel=(q['s']+span/2)%s
        if rel<span:sample_positions.add(rel)
    for local_s in sorted(sample_positions):
        source_s=(s-span/2+local_s)%s
        index=next((i for i in range(len(unique)-1) if unique[i]['s']<=source_s<=unique[i+1]['s']),len(unique)-2)
        a,bb=unique[index:index+2];f=(source_s-a['s'])/(bb['s']-a['s'])
        nx=a['nx']*(1-f)+bb['nx']*f;ny=a['ny']*(1-f)+bb['ny']*f;norm=math.hypot(nx,ny);nx/=norm;ny/=norm
        strap_samples.append({'s':local_s,'x':a['x']*(1-f)+bb['x']*f+nx*(t+.1),
            'y':a['y']*(1-f)+bb['y']*f+ny*(t+.1),'nx':nx,'ny':ny})
    strap=_part('seam-strap','Mantel-Klebelasche',rect(0,0,span,H-4*t),t,_frame([0,0,0],[1,0,0],[0,0,1],[0,1,0]),
        surface={'type':'wrap','samples':strap_samples,'z':2*t},protected=[rect(0,0,span,H-4*t)])
    strap['flexCuts']=flex_lines(span,H-6*t,t,m['flexPitch'],stretch,0,t)
    parts.append(strap)
    if b['lid']=='removable':
        parts.append(_part('lid','Deckel',outer,t,_frame([0,0,H],[1,0,0],[0,1,0])))
        guide=outer.buffer(-2*t-2*play-.15,quad_segs=16).difference(outer.buffer(-3*t-2*play-.15,quad_segs=16))
        parts.append(_part('lid-ring','Deckel-Führungsring',guide,t,_frame([0,0,H-t],[1,0,0],[0,1,0])))
    if b['shape']=='cylinder':
        for part in parts:
            radii={'bottom':(r-t-play-.05,None),'bottom-ring':(r-t-play-.05,r-2*t-play-.05),'top-ring':(r-t-play-.05,r-2*t-play-.05),
                   'lid':(r,None),'lid-ring':(r-2*t-2*play-.15,r-3*t-2*play-.15)}
            if part['id'] in radii:
                outer_r,inner_r=radii[part['id']]
                part['_circleOuter']=(W/2,D/2,outer_r)
                if inner_r:part['_circleHoles']=[(W/2,D/2,inner_r)]
    hardware.append({'id':'curve-glue','name':'Holzleim: Halteringe, Mantelnaht und Deckelführung','quantity':1,'diameter':0,'length':0})
    curve_segments=256 if b['shape']=='cylinder' else 96
    tolerance=r*(1-math.cos(math.pi/curve_segments))+.0003*r
    for part in parts:part['motionTolerance']=tolerance
    parts[0]['_protected'].append(collar)
    for part in parts:
        if part['id'] in ('bottom-ring','top-ring','lid-ring'):part['_protected'].append(part['_shape'])
        if part['id']=='lid':
            guide=next((q for q in parts if q['id']=='lid-ring'),None)
            if guide:part['_protected'].append(guide['_shape'])
    return parts


def _anchor(mode,value,start,end):
    return {'start':start+value,'end':end-value,'center':(start+end)/2+value,'relative':start+(end-start)*value}[mode]


def _rotation(angles):
    x,y,z=map(math.radians,angles)
    rx=np.array([[1,0,0],[0,math.cos(x),-math.sin(x)],[0,math.sin(x),math.cos(x)]])
    ry=np.array([[math.cos(y),0,math.sin(y)],[0,1,0],[-math.sin(y),0,math.cos(y)]])
    rz=np.array([[math.cos(z),-math.sin(z),0],[math.sin(z),math.cos(z),0],[0,0,1]])
    return rz@ry@rx


def _board_shape(source,w,h):
    typ=source.get('shape','rect')
    if typ=='rect':return rect(0,0,w,h)
    if typ=='circle':return affinity.scale(Point(w/2,h/2).buffer(1,quad_segs=48),w/2,h/2,origin=(w/2,h/2))
    loops=source.get('contours',[]) if typ=='svg' else [source.get('points',[])]
    if not loops or any(len(loop)<3 for loop in loops):raise ValueError('Geschlossene Außenkontur mit mindestens drei Punkten fehlt.')
    result=Polygon()
    for loop in loops:
        poly=Polygon(loop)
        if not poly.is_valid or poly.area<EPS:raise ValueError('Die importierte Kontur ist ungültig oder überschneidet sich.')
        result=result.symmetric_difference(poly)
    if result.geom_type!='Polygon':raise ValueError('Eine Platte muss aus genau einem zusammenhängenden Teil bestehen.')
    x0,y0,x1,y1=result.bounds
    result=affinity.translate(result,-x0,-y0)
    return affinity.scale(result,w/(x1-x0),h/(y1-y0),origin=(0,0))


def _connect_board(board,host,source,p,errors,hardware,contacts):
    connection=source.get('connection','none');t=board['thickness'];play=p['material']['play']
    if connection=='none':return
    n=np.asarray(board['frame']['normal']);hn=np.asarray(host['frame']['normal'])
    if connection=='tabs':
        if abs(np.dot(n,hn))>1e-6:
            _err(errors,'TABS_ANGLE','Steckverbindungen benötigen rechtwinklige Platten.',[board['id'],host['id']]);return
        w,h=board['bounds'][2:]
        edge=None
        candidates=[([0,0],[w,0],[0,-1]),([0,h],[w,h],[0,1]),([0,0],[0,h],[-1,0]),([w,0],[w,h],[1,0])]
        for a,b,out in candidates:
            if all(abs(np.dot(_world(board,q)-host['frame']['origin'],hn)-host['thickness'])<1e-5 for q in (a,b)):
                inward=np.asarray(board['frame']['u'])*out[0]+np.asarray(board['frame']['v'])*out[1]
                if np.dot(inward,hn)<-.99:edge=(np.array(a),np.array(b),np.array(out));break
        if edge is None:
            _err(errors,'TABS_POSITION','Eine Plattenkante muss genau auf der Vorderseite der Trägerplatte sitzen.',[board['id'],host['id']]);return
        a,b,out=edge;length=float(np.linalg.norm(b-a));direction=(b-a)/length
        try:
            profiles=FingerProfiles({'thickness':t,'relative':False,'finger':p['material']['finger'],'space':p['material']['finger'],'surroundingspaces':1,'play':play})
            intervals=profiles.intervals(length-2*t)[0]
        except ValueError:
            _err(errors,'TABS_LENGTH','Die Kante ist für die Steckverbindung zu kurz.',[board['id']]);return
        slots=[];tabs=[]
        for lo,hi in intervals:
            aa=a+direction*(lo+t);bb=a+direction*(hi+t)
            tab=Polygon([aa,bb,bb+out*host['thickness'],aa+out*host['thickness']]);tabs.append(tab)
            # The slot follows the actual extrusion direction and allows play.
            corners=[_local(host,_world(board,q,depth)) for q in (aa,bb) for depth in (0,t)]
            slot=Polygon(corners).convex_hull.buffer(play/2,join_style=2)
            if not host['_shape'].buffer(EPS).contains(slot) or any(slot.intersects(z) for z in host['_protected']):
                _err(errors,'TABS_PROTECTED','Ein Steckschlitz liegt im Rand- oder Verbindungsbereich.',[board['id'],host['id']]);return
            slots.append(slot)
        host['_shape']=host['_shape'].difference(unary_union(slots));board['_shape']=board['_shape'].union(unary_union(tabs))
        host['_protected']+= [s.buffer(t) for s in slots]
        board['_protected']+= [tab.buffer(t/2) for tab in tabs]
    elif connection=='screw':
        if abs(abs(np.dot(n,hn))-1)>1e-6:
            _err(errors,'SCREW_ANGLE','Die Schraubverbindung benötigt parallele Platten.',[board['id'],host['id']]);return
        w,h=board['bounds'][2:];diameter=max(2,min(4,t));radius=diameter/2+play/2
        for q in ([w*.25,h/2],[w*.75,h/2]):
            hole=Point(q).buffer(radius,quad_segs=24);hp=Point(_local(host,_world(board,q))).buffer(radius,quad_segs=24)
            if not host['_shape'].contains(hp.buffer(t/2)) or any(hp.intersects(z) for z in host['_protected']):
                _err(errors,'SCREW_POSITION','Ein Schraubenloch trifft einen Rand oder eine geschützte Verbindung.',[board['id'],host['id']]);return
            board['_shape']=board['_shape'].difference(hole);host['_shape']=host['_shape'].difference(hp)
            board['_protected'].append(hole.buffer(t));host['_protected'].append(hp.buffer(t))
        hardware.append({'id':'screw-'+board['id'],'name':'Schraube mit Mutter für '+board['name'],'quantity':2,'diameter':diameter,'length':math.ceil(2*t+6)})
    elif connection=='glue':
        hardware.append({'id':'glue-'+board['id'],'name':'Holzleim für '+board['name'],'quantity':1,'diameter':0,'length':0})


def _mechanism(board,host,source,p,errors,hardware):
    """Real guide/pivot fabrication for the two reusable latch templates."""
    kind=source['kind'];t=board['thickness'];play=p['material']['play']
    if abs(abs(np.dot(board['frame']['normal'],host['frame']['normal']))-1)>1e-6:
        _err(errors,'MECHANISM_ANGLE','Riegel benötigen parallele Träger- und Riegelplatten.',[board['id'],host['id']]);return
    w,h=board['bounds'][2:];diameter=max(2,min(t,4));radius=diameter/2+max(play/2,.05)
    motion=source.get('motion',{});low=motion.get('min',-8);high=motion.get('max',8)
    centers=[[w/4,h/2],[3*w/4,h/2]] if kind=='slider' else [[w/2,h/2]]
    slots=[];bores=[]
    for center in centers:
        if kind=='slider':
            slot=LineString([[center[0]-high,center[1]],[center[0]-low,center[1]]]).buffer(radius,quad_segs=24)
        else:slot=Point(center).buffer(radius,quad_segs=24)
        bore=Point(_local(host,_world(board,center))).buffer(radius,quad_segs=24)
        if not board['_shape'].buffer(-max(.6,t/2)).covers(slot) or not host['_shape'].buffer(-max(.6,t/2)).covers(bore) or any(bore.intersects(z) for z in host['_protected']):
            _err(errors,'MECHANISM_FIT','Riegelführung oder Drehachse trifft einen Rand oder lässt zu schmale Stege.',[board['id'],host['id']]);return
        slots.append(slot);bores.append(bore)
    board['_shape']=board['_shape'].difference(unary_union(slots));host['_shape']=host['_shape'].difference(unary_union(bores))
    board['_protected'] += [s.buffer(t/2) for s in slots];host['_protected'] += [b.buffer(t/2) for b in bores]
    count=len(centers);length=math.ceil(2*t+max(0,source.get('offset',0))+6)
    hardware.extend([{'id':'latch-pin-'+board['id'],'name':'Führungsschraube mit Stoppmutter' if kind=='slider' else 'Drehachse mit Sicherung',
                     'quantity':count,'diameter':diameter,'length':length},
                    {'id':'latch-washer-'+board['id'],'name':'Unterlegscheibe für '+board['name'],'quantity':2*count,'diameter':2.5*diameter,'length':0}])


def _custom_parts(p,parts,errors,hardware,joints):
    pending={x['id']:x for x in p['parts']};by={x['id']:x for x in parts};t=p['material']['thickness']
    while pending:
        progress=False
        for ident,source in list(pending.items()):
            hostid=source.get('host','bottom')
            if hostid in pending:continue
            del pending[ident];progress=True;host=by.get(hostid)
            if host is None:
                _err(errors,'HOST_MISSING','Die Trägerplatte existiert in dieser Kastenform nicht.',[ident,hostid]);continue
            x0,y0,x1,y1=host['bounds'];fit=source.get('fit','fixed')
            w=x1-x0-2*t if fit in ('width','both') else source.get('width',60)
            h=y1-y0-2*t if fit in ('height','both') else source.get('height',40)
            if min(w,h)<t:
                _err(errors,'BOARD_TOO_SMALL','Abhängige Plattenmaße sind zu klein.',[ident]);continue
            try:shape=_board_shape(source,w,h)
            except ValueError as exc:_err(errors,'BOARD_CONTOUR',str(exc),[ident]);continue
            a=source.get('anchor',{});cx=_anchor(a.get('u','center'),a.get('x',0),x0,x1);cy=_anchor(a.get('v','center'),a.get('y',0),y0,y1)
            hostframe=_surface_frame(host,[cx,cy]) if host.get('surface') else host['frame']
            basis=np.column_stack([hostframe['u'],hostframe['v'],hostframe['normal']])
            rot=basis@_rotation(source.get('rotation',[0,0,0]));u,v,n=rot[:,0],rot[:,1],rot[:,2]
            center=_world(host,[cx,cy],host['thickness']+source.get('offset',0));origin=center-u*w/2-v*h/2
            board=_part(ident,source.get('name',ident),shape,t,_frame(origin,u,v,n),kind=source.get('kind','custom'),host=hostid,
                        _sourceShape=source.get('shape','rect'))
            board['resolvedWidth']=w;board['resolvedHeight']=h
            curved_connection=host.get('surface') and (source.get('connection','none')!='none' or source.get('kind') in ('slider','rotor'))
            if curved_connection:
                _err(errors,'CURVED_CONNECTION','Tangentiale Platten sind möglich; automatische Klebe-, Schraub-, Steck- und Riegelführungen benötigen eine ebene Trägerfläche.',[ident,hostid])
            else:_connect_board(board,host,source,p,errors,hardware,[])
            if source.get('kind') in ('slider','rotor') and not curved_connection:
                _mechanism(board,host,source,p,errors,hardware)
            parts.append(board);by[ident]=board
            motion=source.get('motion',{})
            if source.get('kind') in ('slider','rotor') and motion.get('type','fixed')!='fixed':
                motion={**motion,'type':'slider' if source['kind']=='slider' else 'revolute',
                        'axis':board['frame']['u'] if source['kind']=='slider' else board['frame']['normal'],
                        'pivot':_world(board,[w/2,h/2]).tolist()}
            if motion.get('type','fixed')!='fixed':joints.append({'id':'motion-'+ident,'name':board['name'],'partIds':[ident],**{k:deepcopy(motion[k]) for k in ('type','axis','pivot','min','max','value') if k in motion},'contacts':[]})
        if not progress:
            _err(errors,'DEPENDENCY_CYCLE','Zyklische Abhängigkeit zwischen Zusatzplatten.',list(pending));break
    for group in p['groups']:
        motion=group.get('motion',{})
        missing=[ident for ident in group['partIds'] if ident not in by]
        if missing:_err(errors,'GROUP_PART_MISSING','Eine Gruppenplatte existiert in dieser Kastenform nicht.',missing);continue
        inherited=[joint for joint in joints if set(joint['partIds']).intersection(group['partIds'])]
        if motion.get('type','fixed')=='fixed':
            if inherited:
                inherited[0]['partIds']=sorted(set(inherited[0]['partIds']+group['partIds']))
        else:
            moving=set(group['partIds'])
            for joint in inherited:
                moving.update(joint['partIds']);joints.remove(joint)
            joints.append({'id':'group-'+group['id'],'name':group.get('name',group['id']),'partIds':sorted(moving),**{k:deepcopy(motion[k]) for k in ('type','axis','pivot','min','max','value') if k in motion},'contacts':[]})
    for group in p['groups']:
        for member in group.get('partIds',[]):
            if member in by:by[member]['groupId']=group['id']


def _feature_shapes(f):
    typ=f.get('shape','circle');w=f.get('width',10);h=f.get('height',10)
    if typ in ('circle','pattern'):polygons=[Point((i-(f.get('count',3)-1)/2)*f.get('pitch',12),0).buffer(w/2,quad_segs=48) for i in range(f.get('count',3))] if typ=='pattern' else [Point(0,0).buffer(w/2,quad_segs=48)]
    elif typ=='rect':polygons=[rect(-w/2,-h/2,w/2,h/2)]
    elif typ=='slot':
        if w>=h:polygons=[LineString([(-(w-h)/2,0),((w-h)/2,0)]).buffer(h/2,quad_segs=24)]
        else:polygons=[LineString([(0,-(h-w)/2),(0,(h-w)/2)]).buffer(w/2,quad_segs=24)]
    else:
        contours=[f.get('points',[])] if typ=='polygon' else f.get('contours',[])
        polygons=[]
        for points in contours:
            if len(points)<3:raise ValueError('Geschlossene Kontur mit mindestens drei Punkten fehlt.')
            poly=Polygon(points)
            if not poly.is_valid or poly.area<EPS:raise ValueError('Kontur überschneidet sich oder hat keine Fläche.')
            polygons.append(poly)
        if not polygons and not f.get('lines'):raise ValueError('Umrisse fehlen. Text zuerst im Browser in Pfade umwandeln.')
    return polygons,[LineString(line) for line in f.get('lines',[]) if len(line)>=2]


def _features(p,parts,errors):
    by={q['id']:q for q in parts};t=p['material']['thickness'];burn=p['material']['burn'];web=max(.6,t/2,2*burn+.2)
    for f in p['features']:
        part=by.get(f.get('partId'));ident=f['id']
        if part is None:_err(errors,'FEATURE_HOST','Die Fläche der Bearbeitung existiert nicht.',[f.get('partId')],ident);continue
        try:polygons,lines=_feature_shapes(f)
        except ValueError as exc:_err(errors,'FEATURE_CONTOUR',str(exc),[part['id']],ident);continue
        x0,y0,x1,y1=part['bounds'];a=f.get('anchor',{})
        x=_anchor(a.get('u','center'),f.get('x',a.get('x',0)),x0,x1);y=_anchor(a.get('v','center'),f.get('y',a.get('y',0)),y0,y1)
        angle=f.get('angle',0)
        polygons=[affinity.translate(affinity.rotate(poly,angle,origin=(0,0)),x,y) for poly in polygons]
        lines=[affinity.translate(affinity.rotate(line,angle,origin=(0,0)),x,y) for line in lines]
        if f.get('operation','cut')=='engrave':
            all_lines=lines+[LineString(poly.exterior.coords) for poly in polygons]
            if any(not part['_shape'].buffer(EPS).covers(line) for line in all_lines):
                _err(errors,'ENGRAVE_OUTSIDE','Die Gravur liegt außerhalb der Platte.',[part['id']],ident);continue
            part['engrave'] += [[[float(xx),float(yy)] for xx,yy in line.coords] for line in all_lines]
            continue
        # Imported open paths always retain their engraving semantics.
        if any(not part['_shape'].buffer(EPS).covers(line) for line in lines):
            _err(errors,'ENGRAVE_OUTSIDE','Ein offener Gravurpfad liegt außerhalb der Platte.',[part['id']],ident);continue
        cut=Polygon()
        if f.get('shape') in ('svg','text'):
            for poly in polygons:cut=cut.symmetric_difference(poly)
        else:cut=unary_union(polygons)
        if not cut.is_empty:
            if burn and any(poly.buffer(-burn).is_empty for poly in polygons):
                _err(errors,'CUT_TOO_SMALL','Ein Ausschnitt ist kleiner als die kompensierte Schnittfuge.',[part['id']],ident);continue
            if any(cut.intersects(zone) for zone in part['_protected']):
                _err(errors,'PROTECTED_ZONE','Ausschnitt trifft Zinken, Flexzone, Führung oder Befestigung.',[part['id']],ident);continue
            interior=part['_shape'].covers(cut)
            if interior and not part['_shape'].buffer(-web).covers(cut):
                _err(errors,'MINIMUM_WEB','Ausschnitte benötigen ausreichende Reststege zu Rand und anderen Löchern.',[part['id']],ident);continue
            if not interior and (not cut.intersects(part['_shape']) or any(cut.distance(Polygon(ring))<web-EPS for ring in part['_shape'].interiors)):
                _err(errors,'MINIMUM_WEB','Der Randausschnitt trifft ein vorhandenes Loch oder liegt außerhalb.',[part['id']],ident);continue
            if any(a.distance(b)<web-EPS and not a.contains(b) and not b.contains(a) for i,a in enumerate(polygons) for b in polygons[i+1:]):
                _err(errors,'MINIMUM_WEB','Zwischen den Ausschnitten verbleibt kein ausreichender Steg.',[part['id']],ident);continue
            remaining=part['_shape'].difference(cut)
            if remaining.geom_type!='Polygon' or not remaining.is_valid:
                _err(errors,'DETACHED_MATERIAL','Der Ausschnitt trennt Materialinseln ab.',[part['id']],ident);continue
            if remaining.buffer(-web/2).geom_type!='Polygon' or remaining.buffer(-web/2).is_empty:
                _err(errors,'MINIMUM_WEB','Der Ausschnitt erzeugt einen zu schmalen Materialhals.',[part['id']],ident);continue
            part['_shape']=remaining
            if not interior:part.pop('_circleOuter',None)
            # Keep exact upstream cubic circle paths whenever geometry is circular.
            if f.get('shape') in ('circle','pattern'):
                for poly in polygons:
                    c=poly.centroid;part.setdefault('_circleHoles',[]).append((c.x,c.y,f.get('width',10)/2))
                radius=f.get('width',10)/2
                part['motionTolerance']=max(part.get('motionTolerance',0),radius*(1-math.cos(math.pi/192))+.0003*radius)
        part['engrave'] += [[[float(xx),float(yy)] for xx,yy in line.coords] for line in lines]


def _finalize(parts,p,errors):
    m=p['material'];burn=m['burn'];t=m['thickness'];count=0;web=max(.6,t/2,2*burn+.2)
    for part in parts:
        shape=part['_shape']
        if shape.is_empty or shape.geom_type!='Polygon' or not shape.is_valid:
            _err(errors,'INVALID_PART','Die Bearbeitung erzeugt keine zusammenhängende, gültige Platte.',[part['id']]);continue
        shape=orient(shape,sign=1);part['_shape']=shape
        part['nominal']=_loop(shape.exterior);part['nominalHoles']=[_loop(r) for r in shape.interiors]
        # Validate the final contours, including holes imported as board geometry.
        # Earlier feature checks alone cannot establish their machinability.
        part['holePaths']=[];part['outerPath']='';part['cutPath']=''
        holes=[Polygon(ring) for ring in shape.interiors]
        bad=False
        for hole in holes:
            compensated=hole.buffer(-burn) if burn else hole
            if compensated.is_empty or compensated.geom_type!='Polygon' or not compensated.is_valid:
                _err(errors,'CUT_TOO_SMALL','Ein Loch kollabiert oder zerfällt bei der Schnittfugenkorrektur.',[part['id']]);bad=True;break
        if part.get('_sourceShape') in ('polygon','svg'):
            core=shape.buffer(-web/2)
            if core.is_empty or core.geom_type!='Polygon':
                _err(errors,'MINIMUM_WEB','Die importierte Platte enthält einen zu schmalen Materialhals.',[part['id']]);bad=True
            exterior=LineString(shape.exterior.coords)
            if any(hole.distance(exterior)<web-EPS for hole in holes) or any(a.distance(b)<web-EPS for i,a in enumerate(holes) for b in holes[i+1:]):
                _err(errors,'MINIMUM_WEB','Importierte Löcher lassen zum Rand oder untereinander zu schmale Reststege.',[part['id']]);bad=True
        if burn and shape.buffer(-burn).is_empty:
            _err(errors,'BURN_COLLAPSE','Die Schnittkorrektur ist größer als ein verbleibender Materialbereich.',[part['id']]);bad=True
        if bad:
            part['_manufacturable']=False
            part['bounds']=list(shape.bounds);part['protected']=[]
            count+=len(part['nominal'])+sum(map(len,part['nominalHoles']))
            continue
        part['bounds']=list(shape.bounds);part['protected']=[]
        for zone in part['_protected']:
            if zone.geom_type!='Polygon' or zone.is_empty:continue
            pieces=constrained_delaunay_triangles(zone).geoms if zone.interiors else [zone]
            part['protected'] += [_loop(piece.exterior) for piece in pieces]
        paths=[];circleholes=part.get('_circleHoles',[])
        for hole in shape.interiors:
            poly=Polygon(hole);circle=next((c for c in circleholes if abs(poly.area-math.pi*c[2]**2)<max(.01,poly.area*.002) and poly.centroid.distance(Point(c[:2]))<1e-5),None)
            if circle:paths.append(circle_path(*circle,t,burn,hole=True))
            else:paths.append(contour_path(_loop(hole),t,burn,hole=True))
        part['holePaths']=paths
        part['outerPath']=(circle_path(*part['_circleOuter'],t,burn)
                           if part.get('_circleOuter') else contour_path(part['nominal'],t,burn))
        part['cutPath']=' '.join(paths+[part['outerPath']])
        count+=len(part['nominal'])+sum(map(len,part['nominalHoles']))+2*len(part['flexCuts'])
    if count>100000:_err(errors,'GEOMETRY_BUDGET','Das erzeugte Projekt überschreitet das Budget von 100000 Geometriepunkten.')
    return count


def _line_path(points):
    return 'M '+' L '.join(f'{x:.6f} {y:.6f}' for x,y in points)


def _pack(parts,p,errors):
    l=p['layout'];margin=l['margin'];spacing=l['spacing'];W=l['width']-2*margin;H=l['height']-2*margin
    if min(W,H)<=0:
        _err(errors,'SHEET_MARGIN','Der Rand lässt keine nutzbare Plattenfläche übrig.');return []
    packer=newPacker(rotation=l['rotate'])
    sizes={};by={q['id']:q for q in parts}
    for part in parts:
        if not part.get('nominal') or part.get('_manufacturable') is False:continue
        x0,y0,x1,y1=part['bounds'];w=x1-x0+2*p['material']['burn'];h=y1-y0+2*p['material']['burn'];sizes[part['id']]=(w,h)
        if not ((w<=W and h<=H) or (l['rotate'] and h<=W and w<=H)):
            _err(errors,'PART_TOO_LARGE','Ein Bauteil passt nicht auf das gewählte Materialformat.',[part['id']]);continue
        packer.add_rect(w+spacing,h+spacing,rid=part['id'])
    packer.add_bin(W+spacing,H+spacing,count=max(1,len(parts)))
    packer.pack();sheets=[]
    packed=set()
    for index,bin_ in enumerate(packer):
        placements=[];groups=[]
        for item in bin_:
            ident=item.rid;part=by[ident];packed.add(ident);w,h=sizes[ident]
            rotated=abs(float(item.width)-(w+spacing))>1e-5
            angle=90 if rotated else 0;x=float(item.x)+margin;y=float(item.y)+margin;burn=p['material']['burn']
            x0,y0,x1,y1=part['bounds']
            transform=(f'translate({x+h-burn:.6f} {y+burn:.6f}) rotate(90) translate({-x0:.6f} {-y0:.6f})' if rotated else f'translate({x+burn-x0:.6f} {y+burn-y0:.6f})')
            # Internal cuts and flex precede each exterior; each part remains a group.
            elements=[f'<path data-operation="engrave" stroke="#2563eb" d="{_line_path(line)}"/>' for line in part['engrave']]
            elements += [f'<path data-operation="cut" d="{path}"/>' for path in part['holePaths']]
            elements += [f'<path data-operation="flex" d="{_line_path(line)}"/>' for line in part['flexCuts']]
            elements += [f'<path data-operation="outline" d="{part["outerPath"]}"/>']
            groups.append(f'<g id="part-{html.escape(ident,quote=True)}" transform="{transform}"><title>{html.escape(part["name"])}</title>'+''.join(elements)+'</g>')
            placements.append({'partId':ident,'x':x,'y':y,'angle':angle})
        if placements:
            svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{l["width"]}mm" height="{l["height"]}mm" viewBox="0 0 {l["width"]} {l["height"]}"><g fill="none" stroke="#dc2626" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round">'+''.join(groups)+'</g></svg>'
            sheets.append({'index':len(sheets),'width':l['width'],'height':l['height'],'svg':svg,'placements':placements})
    for ident in sizes.keys()-packed:
        if not any(e['code']=='PART_TOO_LARGE' and ident in e['partIds'] for e in errors):_err(errors,'PACKING_FAILED','Ein Bauteil konnte nicht angeordnet werden.',[ident])
    return sheets


def build_project(project):
    p=validate_project(project);errors=[];warnings=[]
    hardware=[{'id':h.get('id','hardware-'+str(i)),'name':h.get('name','Beschlag'),'quantity':h['quantity'],'diameter':h.get('diameter',0),'length':h.get('length',0)} for i,h in enumerate(p['hardware'])];joints=[]
    b,m=p['box'],p['material'];burn=m['burn'];t=m['thickness']
    if burn>=t/2:_err(errors,'BURN_TOO_LARGE','Brennausgleich muss kleiner als die halbe Materialstärke sein.')
    if m['play']>=t:_err(errors,'PLAY_TOO_LARGE','Verbindungsspiel muss kleiner als die Materialstärke sein.')
    if m['flexPitch']<=2*burn+.2:_err(errors,'FLEX_WEB','Flexraster lässt nach Schnittfuge zu kleine Stege übrig.')
    parts=_rect_box(p,errors,hardware,joints) if b['shape']=='rect' else _curved_box(p,errors,hardware,joints)
    if b['shape']!='rect':warnings.append('Flexdehnung und Biegeradius müssen mit einer Materialprobe kalibriert werden.')
    _custom_parts(p,parts,errors,hardware,joints)
    _features(p,parts,errors)
    for joint in joints:
        motion=joint
        motion.setdefault('axis',[0,0,1]);motion.setdefault('pivot',[0,0,0]);motion.setdefault('min',0);motion.setdefault('max',90);motion.setdefault('value',0)
        if joint['id']=='lid-motion':
            value=p['box'].get('lidValue',0);_num(value,'box.lidValue',joint['min'],joint['max']);joint['value']=value
    try:point_count=_finalize(parts,p,errors)
    except (ValueError,ZeroDivisionError) as exc:
        _err(errors,'TOOLPATH',str(exc));point_count=0
    sheets=_pack(parts,p,errors)
    # Late import keeps validation usable independently of the motion engine.
    public=[{k:v for k,v in part.items() if not k.startswith('_')} for part in parts]
    try:
        from motion import check_project
        motion=check_project(public,joints)
    except ImportError:
        motion={'status':'unchecked','results':[],'errors':[]}
        warnings.append('Die Kollisionsprüfung ist nicht verfügbar.')
    errors.extend(motion.get('errors',[]))
    warnings.extend(motion.get('messages',[])[:8])
    status=motion.get('status','unchecked')
    if status=='collision' and not motion.get('errors'):_err(errors,'COLLISION','Die Montage oder Bewegung enthält eine Kollision.')
    checks={'geometry':'invalid' if any('collision' not in e['code'].lower() for e in errors) else 'valid',
      'manufacturing':'invalid' if errors else 'valid','assembly':'invalid' if status=='collision' else 'unchecked',
      'motion':'invalid' if status=='collision' else ('valid' if status=='clear' else 'unchecked')}
    return {'valid':not errors,'errors':errors,'warnings':warnings,'parts':public,'joints':joints,'sheets':sheets,'hardware':hardware,
      'checks':checks,'motionChecks':motion.get('results',[]),'stats':{'partCount':len(public),'sheetCount':len(sheets),'featureCount':len(p['features']),
      'cutLength':sum(part['_shape'].length+sum(LineString(line).length for line in part['flexCuts']) for part in parts),
      'materialArea':sum(part['_shape'].area for part in parts),'pointCount':point_count,'thickness':t,'burn':burn,
      'flexStretch':m['flexStretch']}}
