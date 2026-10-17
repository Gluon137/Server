"""Independent manufacturing invariants; run with .baustein-venv/bin/python."""
import copy
import json
import math
from pathlib import Path
import re
import sys
import unittest
from xml.etree import ElementTree as ET
import numpy as np
from shapely.geometry import Point,Polygon

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'website/box-studio/backend'))
import geometry


def build(change=None):
    p=geometry.default_project()
    if change:change(p)
    return geometry.build_project(p)


def part(result,ident):return next(p for p in result['parts'] if p['id']==ident)


class Manufacturing(unittest.TestCase):
    def test_defaults_valid_and_connected(self):
        r=build();self.assertTrue(r['valid'],r['errors']);self.assertEqual(7,len(r['parts']))
        for p in r['parts']:
            poly=Polygon(p['nominal'],p['nominalHoles'])
            self.assertTrue(poly.is_valid);self.assertGreater(poly.area,0)
        self.assertTrue(r['sheets'])

    def test_orthogonal_fingers_do_not_share_material(self):
        r=build(lambda p:p['box'].update(lid='none'))
        panels=r['parts'];t=3
        # Probe the complete edge prisms at non-boundary irrational offsets.
        probes=[]
        for z in (t*.371,t*1.371,50.371,98.371):
            for x in [t*.371,200-t*.371]+[i+.371 for i in range(4,197,2)]:
                for y in [t*.371,140-t*.371]:probes.append([x,y,z])
        for x in [t*.371,200-t*.371]:
            for y in [i+.371 for i in range(4,137,2)]:
                for z in [t*.371]+[i+.371 for i in range(4,97,3)]:probes.append([x,y,z])
        for q in probes:
            inside=[]
            for p in panels:
                f=p['frame'];d=np.array(q)-f['origin'];depth=float(d@f['normal'])
                if 1e-5<depth<t-1e-5:
                    uv=[float(d@f['u']),float(d@f['v'])]
                    if Polygon(p['nominal'],p['nominalHoles']).contains(Point(uv)):inside.append(p['id'])
            self.assertLessEqual(len(inside),1,(q,inside))

    def test_dimensions_and_burn_separate(self):
        a=build();b=build(lambda p:p['material'].update(burn=.12))
        self.assertEqual(part(a,'front')['nominal'],part(b,'front')['nominal'])
        self.assertNotEqual(part(a,'front')['cutPath'],part(b,'front')['cutPath'])
        self.assertIn('C ',part(b,'front')['cutPath'])
        c=build(lambda p:p['box'].update(dimensions='inner'))
        self.assertEqual([0,0,206,146],part(c,'bottom')['bounds'])

    def test_exact_outer_and_usable_inner_height(self):
        for lid in ['none','removable','sliding','hinged']:
            outer=build(lambda p:p['box'].update(lid=lid))
            relevant=[part(outer,x) for x in ['bottom','front','back','left','right']+(['lid'] if lid!='none' else [])]
            maxz=max(float((np.asarray(q['frame']['origin'])+np.asarray(q['frame']['u'])*x+np.asarray(q['frame']['v'])*y+np.asarray(q['frame']['normal'])*d)[2]) for q in relevant for x,y in q['nominal'] for d in [0,q['thickness']])
            self.assertAlmostEqual(100,maxz)
            inner=build(lambda p:p['box'].update(lid=lid,dimensions='inner'))
            underside=part(inner,'front')['bounds'][3] if lid=='none' else part(inner,'lid')['frame']['origin'][2]
            self.assertAlmostEqual(100,underside-3)

    def test_tangent_board_on_wrap(self):
        r=build(lambda p:(p['box'].update(shape='cylinder'),p['parts'].append({'id':'tag','host':'wrap','width':20,'height':20,'offset':10})))
        self.assertTrue(r['valid'],r['errors']);frame=part(r,'tag')['frame']
        self.assertAlmostEqual(0,float(np.dot(frame['u'],frame['normal'])),places=6)
        self.assertAlmostEqual(0,float(np.dot(frame['v'],frame['normal'])),places=6)

    def test_real_lids_and_hardware(self):
        slide=build(lambda p:p['box'].update(lid='sliding'))
        self.assertTrue(slide['valid'],slide['errors'])
        self.assertEqual('slider',slide['joints'][0]['type'])
        self.assertTrue({'rail-left','rail-right'}<={p['id'] for p in slide['parts']})
        hinge=build(lambda p:p['box'].update(lid='hinged'))
        self.assertTrue(hinge['valid'],hinge['errors'])
        self.assertEqual('revolute',hinge['joints'][0]['type'])
        self.assertTrue(any(h['id']=='hinge-pin' and h['diameter']>0 for h in hinge['hardware']))
        self.assertTrue(part(hinge,'hinge-left')['nominalHoles'])

    def test_flex_and_stretch_change_development(self):
        for shape in ['rounded','cylinder']:
            a=build(lambda p:(p['box'].update(shape=shape),p['layout'].update(width=1000)))
            b=build(lambda p:(p['box'].update(shape=shape),p['layout'].update(width=1000),p['material'].update(flexStretch=1.15)))
            self.assertTrue(a['valid'],a['errors']);self.assertTrue(b['valid'],b['errors'])
            self.assertGreater(len(part(a,'wrap')['flexCuts']),10)
            self.assertGreater(part(a,'wrap')['bounds'][2],part(b,'wrap')['bounds'][2])
            self.assertTrue(part(a,'bottom-ring')['nominalHoles'])
            samples=part(a,'wrap')['surface']['samples']
            self.assertTrue(all(a['s']<b['s'] for a,b in zip(samples,samples[1:])))
            svg=''.join(s['svg'] for s in a['sheets'])
            self.assertIn('data-operation="flex"',svg)

    def test_all_features_and_inner_first_svg(self):
        for shape in ['circle','rect','slot','polygon','pattern','svg','text']:
            r=build(lambda p:p['features'].append({'id':'feature','partId':'front','shape':shape,'points':[[-4,-3],[4,-3],[0,4]],'contours':[[[-4,-3],[4,-3],[0,4]]],'lines':[[[-5,-5],[5,-5]]],'text':'Hello','width':10,'height':8}))
            self.assertTrue(r['valid'],(shape,r['errors']));self.assertTrue(part(r,'front')['nominalHoles'])
            for sheet in r['sheets']:
                root=ET.fromstring(sheet['svg'])
                for group in root.findall('.//{*}g[@id]'):
                    ops=[path.attrib['data-operation'] for path in group.findall('{*}path')]
                    self.assertEqual('outline',ops[-1])
                    self.assertTrue(all(op!='outline' for op in ops[:-1]))

    def test_protected_and_minimum_web(self):
        protected=build(lambda p:p['features'].append({'id':'hole','partId':'front','shape':'circle','x':-97,'width':10}))
        self.assertFalse(protected['valid']);self.assertTrue(any(e['code']=='PROTECTED_ZONE' for e in protected['errors']))
        web=build(lambda p:p['features'].append({'id':'holes','partId':'front','shape':'pattern','width':10,'pitch':10.2,'count':3}))
        self.assertFalse(web['valid']);self.assertTrue(any(e['code']=='MINIMUM_WEB' for e in web['errors']))
        flex=build(lambda p:(p['box'].update(shape='cylinder'),p['features'].append({'id':'hole','partId':'wrap','shape':'circle','width':10})))
        self.assertFalse(flex['valid']);self.assertTrue(any(e['code']=='PROTECTED_ZONE' for e in flex['errors']))

    def test_custom_resizing_tabs_and_cycles(self):
        def add(p):p['parts'].append({'id':'divider','host':'bottom','width':100,'height':60,'fit':'width','rotation':[90,0,0],'offset':30,'connection':'tabs'})
        a=build(add);self.assertTrue(a['valid'],a['errors']);self.assertTrue(part(a,'bottom')['nominalHoles'])
        b=build(lambda p:(add(p),p['box'].update(width=240)))
        self.assertEqual(40,part(b,'divider')['resolvedWidth']-part(a,'divider')['resolvedWidth'])
        c=build(lambda p:p['parts'].extend([{'id':'a','host':'b'},{'id':'b','host':'a'}]))
        self.assertFalse(c['valid']);self.assertTrue(any(e['code']=='DEPENDENCY_CYCLE' for e in c['errors']))

    def test_screw_holes_and_bom(self):
        r=build(lambda p:p['parts'].append({'id':'tag','host':'front','width':60,'height':30,'connection':'screw'}))
        self.assertTrue(r['valid'],r['errors']);self.assertEqual(2,len(part(r,'tag')['nominalHoles']))
        self.assertEqual(2,len(part(r,'front')['nominalHoles']))
        self.assertTrue(any(h['id']=='screw-tag' and h['quantity']==2 for h in r['hardware']))

    def test_real_slider_and_rotor_templates(self):
        for kind,w,h,low,high in [('slider',90,25,-8,8),('rotor',70,20,-45,45)]:
            r=build(lambda p:p['parts'].append({'id':'latch','kind':kind,'host':'bottom','width':w,'height':h,'motion':{'type':'slider' if kind=='slider' else 'revolute','min':low,'max':high,'value':0}}))
            self.assertTrue(r['valid'],r['errors']);self.assertEqual('valid',r['checks']['motion'])
            self.assertEqual(2 if kind=='slider' else 1,len(part(r,'latch')['nominalHoles']))
            self.assertTrue(part(r,'bottom')['nominalHoles'])
            self.assertTrue(any(h['id']=='latch-pin-latch' for h in r['hardware']))

    def test_edge_notches_and_evenodd_import(self):
        notch=build(lambda p:p['features'].append({'id':'notch','partId':'front','shape':'rect','width':20,'height':20,'y':50}))
        self.assertTrue(notch['valid'],notch['errors'])
        self.assertLess(Polygon(part(notch,'front')['nominal']).area,200*100)
        nested=build(lambda p:p['features'].append({'id':'nested','partId':'front','shape':'svg','contours':[[[-10,-10],[10,-10],[10,10],[-10,10]],[[-5,-5],[5,-5],[5,5],[-5,5]]]}))
        self.assertFalse(nested['valid']);self.assertTrue(any(e['code']=='DETACHED_MATERIAL' for e in nested['errors']))

    def test_motion_unknown_fields_cannot_override_output(self):
        r=build(lambda p:p['parts'].append({'id':'piece','host':'bottom','width':30,'height':20,'offset':20,'motion':{'type':'slider','axis':[1,0,0],'min':0,'max':5,'value':0,'partIds':['bottom'],'id':'hostile'}}))
        self.assertEqual('motion-piece',r['joints'][0]['id']);self.assertEqual(['piece'],r['joints'][0]['partIds'])
        json.dumps(r,allow_nan=False)

    def test_imported_holes_and_necks_are_manufacturable(self):
        outer=[[0,0],[60,0],[60,40],[0,40]]
        tiny=[[29.98,19.98],[30.02,19.98],[30.02,20.02],[29.98,20.02]]
        hole=build(lambda p:(p['material'].update(burn=.1),p['parts'].append({'id':'import','host':'bottom','offset':150,'shape':'svg','width':60,'height':40,'contours':[outer,tiny]})))
        self.assertFalse(hole['valid']);self.assertTrue(any(e['code']=='CUT_TOO_SMALL' for e in hole['errors']))
        self.assertEqual('',part(hole,'import')['cutPath'])
        self.assertFalse(any(x['partId']=='import' for sheet in hole['sheets'] for x in sheet['placements']))
        dumbbell=[[0,0],[20,0],[20,19.98],[40,19.98],[40,0],[60,0],[60,40],[40,40],[40,20.02],[20,20.02],[20,40],[0,40]]
        neck=build(lambda p:p['parts'].append({'id':'import','host':'bottom','offset':150,'shape':'polygon','width':60,'height':40,'points':dumbbell}))
        self.assertFalse(neck['valid']);self.assertTrue(any(e['code']=='MINIMUM_WEB' for e in neck['errors']))
        self.assertEqual('',part(neck,'import')['cutPath'])
        close_hole=[[.1,10],[5,10],[5,15],[.1,15]]
        web=build(lambda p:p['parts'].append({'id':'import','host':'bottom','offset':150,'shape':'svg','width':60,'height':40,'contours':[outer,close_hole]}))
        self.assertFalse(web['valid']);self.assertTrue(any(e['code']=='MINIMUM_WEB' for e in web['errors']))
        good=build(lambda p:p['parts'].append({'id':'import','host':'bottom','offset':150,'shape':'svg','width':60,'height':40,'contours':[outer,[[20,10],[40,10],[40,30],[20,30]]]}))
        self.assertTrue(good['valid'],good['errors']);self.assertTrue(part(good,'import')['cutPath'])

    def test_sheet_bounds_and_safe_text(self):
        r=build(lambda p:p['parts'].append({'id':'deco','name':'<script>alert(1)</script>','host':'front','width':20,'height':20,'offset':10}))
        for sheet in r['sheets']:
            root=ET.fromstring(sheet['svg']);self.assertFalse(root.findall('.//{*}script'))
            for placement in sheet['placements']:
                pp=part(r,placement['partId']);w=pp['bounds'][2]-pp['bounds'][0];h=pp['bounds'][3]-pp['bounds'][1]
                if placement['angle']:w,h=h,w
                self.assertGreaterEqual(placement['x'],5);self.assertGreaterEqual(placement['y'],5)
                self.assertLessEqual(placement['x']+w,sheet['width']-5+1e-6)
                self.assertLessEqual(placement['y']+h,sheet['height']-5+1e-6)

    def test_finite_and_resource_rejections(self):
        for change in [lambda p:p['material'].update(burn=float('nan')),lambda p:p['parts'].append({'id':'x','rotation':[float('inf'),0,0]}),lambda p:p['features'].append({'id':'a','partId':'front','count':129}),lambda p:p['groups'].append({'id':'g','partIds':[{}]}),lambda p:p['parts'].append({'id':'x','host':[]}),lambda p:p['features'].append({'id':'f','partId':{}}),lambda p:p.update(ignored=float('inf'))]:
            p=geometry.default_project();change(p)
            with self.assertRaises(ValueError):geometry.validate_project(p)
        p=geometry.default_project();p['features']=[{'id':str(i),'partId':'front','shape':'pattern','count':128} for i in range(4)]
        with self.assertRaises(ValueError):geometry.validate_project(p)

if __name__=='__main__':unittest.main()
