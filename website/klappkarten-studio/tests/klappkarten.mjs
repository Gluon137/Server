import assert from 'node:assert/strict';
import {defaults,clone,newFigure,newStructure,newSpiral,exampleProject,validateProject} from '../project.mjs';
import {structurePoint} from '../kirigami.mjs';
import {horizontalSections} from '../spiral.mjs';
import {buildProject,poseProject,triangulateContours} from '../geometry.mjs';
import {exportSVG,exportProject} from '../export.mjs';
const EPS=1e-6,near=(a,b,message)=>assert.ok(Math.abs(a-b)<EPS,`${message}: ${a} vs ${b}`),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const project=overrides=>({...clone(defaults),figures:[newFigure(overrides)]});
const square=[[[0,0],[1,0],[1,1],[0,1]]];
const area=r=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
const triangleArea3=([a,b,c])=>{const u=a.map((n,i)=>b[i]-n),v=a.map((n,i)=>c[i]-n);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
for(const key of ['animals','city','flower','butterfly']){
 const p=exampleProject(key),build=buildProject(p);assert.deepEqual(build.errors,[],key);assert.equal(p.version,2);assert.equal(p.construction,'one-sheet');assert.equal(p.card.mode,'90');
 assert.equal(build.parts.length,1);assert.equal(build.parts[0].id,'card');assert.ok(!build.parts.some(a=>a.svg));assert.ok(build.assemblySteps.some(a=>/nichts angeklebt/.test(a)));
 const areas=build.material.areas;near(areas.base+areas.front+areas.roof+areas.waste,areas.blank,'source material partition');
 const flat=poseProject(p,180);for(const panel of flat.panels){for(let i=0;i<panel.sourceTriangles.length;i++)for(let j=0;j<3;j++){const [x,t]=panel.sourceTriangles[i][j],q=panel.triangles[i][j];near(q[0],x,'flat x');near(q[1],t,'flat net t');near(q[2],0,'flat net z');}}
 for(let angle=0;angle<=180;angle+=15){const posed=poseProject(p,angle);for(let k=0;k<posed.panels.length;k++){const panel=posed.panels[k],ref=flat.panels[k];for(let i=0;i<panel.triangles.length;i++){const q=panel.triangles[i],r=ref.triangles[i];for(let j=0;j<3;j++)near(distance(q[j],q[(j+1)%3]),distance(r[j],r[(j+1)%3]),`rigid ${angle}`);}
  if(angle===0)for(const q of panel.vertices){near(q[2],0,'closed flat');assert.ok(q[1]>=-EPS&&q[1]<=p.card.half+EPS,'closed within leaf');}
  if(angle>0&&angle<180){const cot=1/Math.tan(angle*Math.PI/360);for(let i=0;i<panel.triangles.length;i++)for(let j=0;j<3;j++)near(panel.triangles[i][j][1]-panel.triangles[i][j][2]*cot,panel.sourceTriangles[i][j][1],'projection recovers unique net material');}
 }}
 const meshArea=flat.panels.reduce((s,panel)=>s+panel.triangles.reduce((a,t)=>a+triangleArea3(t),0),0);near(meshArea,areas.base+areas.front+areas.roof,'rendered and manufactured areas agree');
 const svg=exportSVG(p);for(const layer of ['CUT','FOLD_MOUNTAIN','FOLD_VALLEY','ENGRAVE'])assert.match(svg,new RegExp(`id="${layer}"`));assert.equal((svg.match(/data-part="card"/g)||[]).length,4);assert.ok(!svg.includes('data-part="figure'));assert.ok(!svg.includes('viewBox="0 0 100 100"'),'raw source SVG never becomes a closed silhouette cut');assert.equal(JSON.parse(exportProject(p)).figures[0].svg,p.figures[0].svg,'editable source retained in project');
}
// Different height/depth ratios keep both leaves and all hinges continuous.
for(const [height,depth] of [[20,40],[40,20],[30,30]]){
 const p=project({width:30,height,depth,contours:square}),b=buildProject(p),f=b.figures[0];assert.deepEqual(b.errors,[]);near(f.anchors.ridge[0][1],depth-height,'asymmetric ridge');
 for(const angle of [0,12,45,90,135,180]){const t=angle*Math.PI/180,co=Math.cos(t),si=Math.sin(t),front=([x,y])=>[x,depth+(depth-y)*co,(depth-y)*si],roof=([x,y])=>[x,height*co+y+height,height*si];
  for(const q of f.anchors.ridge)near(distance(front(q),roof(q)),0,'shared ridge');for(const [x,y]of f.anchors.back)near(distance(roof([x,y]),[x,-y*co,-y*si]),0,'back hinge');for(const [x,y]of f.anchors.foot)near(distance(front([x,y]),[x,y,0]),0,'foot hinge');
 }
 const cuts=b.parts[0].paths.filter(a=>a.operation==='CUT'&&a.figureId).map(a=>a.d.match(/-?\d+(?:\.\d+)?/g).map(Number));
 for(const anchor of [f.anchors.back,f.anchors.foot]){const y=anchor[0][1]+p.card.half;for(const line of cuts)for(let i=2;i<line.length;i+=2){const [ax,ay,bx,by]=[line[i-2],line[i-1],line[i],line[i+1]];assert.ok(!(Math.abs(ay-y)<EPS&&Math.abs(by-y)<EPS&&Math.min(ax,bx)<anchor[1][0]-EPS&&Math.max(ax,bx)>anchor[0][0]+EPS),'no CUT along retained anchor');}}
}
// A source edge on the spine is a cutout boundary, never a simultaneous card fold.
for(const [height,depth,contours] of [[40,20,[[[0,0],[1,0],[1,.5],[0,.5]]]], [30,30,square], [40,20,[[[0,.5],[1,.5],[1,1],[0,1]]]]]){
 const p=project({height,depth,width:36,x:74,contours}),b=buildProject(p);assert.deepEqual(b.errors,[]);
 const segments=path=>{const values=path.d.match(/-?\d+(?:\.\d+)?/g).map(Number),result=[];for(let i=2;i<values.length;i+=2)result.push([[values[i-2],values[i-1]],[values[i],values[i+1]]]);return result;};
 const cuts=b.parts[0].paths.filter(a=>a.operation==='CUT').flatMap(segments),main=b.parts[0].paths.filter(a=>a.operation==='FOLD_VALLEY'&&!a.figureId).flatMap(segments);
 for(const [a,z]of main)for(const [c,d]of cuts)if(Math.abs(a[1]-c[1])<EPS&&Math.abs(a[1]-d[1])<EPS)assert.ok(Math.min(Math.max(a[0],z[0]),Math.max(c[0],d[0]))-Math.max(Math.min(a[0],z[0]),Math.min(c[0],d[0]))<EPS,'main crease never overlaps horizontal CUT');
 if(height===40&&depth===20&&contours[0][0][1]===0){assert.equal(main.length,2);near(main[0][1][0],56,'left main crease stops at silhouette boundary');near(main[1][0][0],92,'right main crease starts after silhouette boundary');}
}
// Front hole waste is discarded, while the actual base card loses the full outer footprint.
{const p=project({contours:[...square,[[.1,.2],[.3,.2],[.3,.7],[.1,.7]]],width:40,height:35,depth:15}),b=buildProject(p);assert.deepEqual(b.errors,[]);assert.ok(b.material.areas.waste>0);near(b.material.areas.blank-b.material.areas.base,b.material.areas.front+b.material.areas.roof+b.material.areas.waste,'card holes remove extracted and waste material');assert.ok(b.parts[0].paths.some(p=>p.operation==='CUT'&&p.figureId&&p.d.endsWith('Z')),'internal waste hole has closed CUT');}
{const t=triangulateContours([...square,[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]]);near(t.reduce((s,t)=>s+area(t),0),.75,'even-odd hole triangulation');}
{const p=project({contours:[...square,[[.4,.2],[.6,.2],[.6,.7],[.4,.7]]],bridgeWidth:5});assert.ok(buildProject(p).warnings.some(a=>/füllt/.test(a.message)),'visible support fills holes explicitly');}
{const p=project({contours:[[[0,.1],[.2,.1],[.2,.4],[0,.4]],[[.4,.6],[.6,.6],[.6,.9],[.4,.9]]]});assert.ok(buildProject(p).errors.some(a=>/Materialinsel/.test(a.message)));assert.throws(()=>exportSVG(p),/Materialinsel/);}
{const p=project({contours:square,bridgeWidth:.8});assert.ok(buildProject(p).errors.some(a=>/mindestens 1 mm/.test(a.message)));}
{const p=project({contours:square,bridgeWidth:1.5});assert.ok(buildProject(p).warnings.some(a=>/unter 2 mm/.test(a.message)));}
{const p=project({height:80,depth:40});assert.ok(buildProject(p).errors.some(a=>/geschlossenen Zustand/.test(a.message)));assert.throws(()=>exportSVG(p),/Export gesperrt/);assert.doesNotThrow(()=>validateProject(p));}
{const p=project({x:2,width:40});assert.ok(buildProject(p).errors.some(a=>/Kartenrand/.test(a.message)));}
{const p=project();p.figures.push({...clone(p.figures[0]),id:'overlap'});assert.ok(buildProject(p).errors.some(a=>/2 mm Abstand/.test(a.message)));}
{const p=project();p.layout.width=50;assert.ok(buildProject(p).errors.some(a=>/Materialbogen/.test(a.message)));}
for(const contours of [[[[0,0],[1,1],[0,1],[1,0]]],[[[0,0],[.7,0],[.7,.7],[0,.7]],[[.4,.4],[1,.4],[1,1],[.4,1]]],[[[0,0],[.5,0],[.5,.5],[0,.5]],[[.5,.5],[1,.5],[1,1],[.5,1]]]]){
 const p=project({contours});assert.ok(buildProject(p).errors.some(a=>/Konturen überkreuzen oder berühren/.test(a.message)));assert.throws(()=>exportSVG(p),/Vereinen\/Abziehen/);
}
{const p=project({contours:[[[0,0],[.5,0],[1,0],[1,1],[0,1],[0,0]]]});assert.deepEqual(buildProject(p).errors,[],'collinear samples and repeated closing point valid');}
{const p=project({contours:square,engravings:[[[.1,.3],[.9,.3]]]}),b=buildProject(p),line=b.parts[0].paths.find(a=>a.operation==='ENGRAVE');assert.ok(line);const values=line.d.match(/-?\d+(?:\.\d+)?/g).map(Number),f=p.figures[0];near(values[0],f.x-.4*f.width,'normalized engraving x');near(values[1],p.card.half+f.depth-.7*f.height,'normalized engraving y');assert.ok(exportSVG(p).indexOf(line.d)>exportSVG(p).indexOf('id="ENGRAVE"'));}
for(const svg of ['<svg><script>x</script></svg>','<svg><image href="https://example.com"/></svg>','<svg><animate/></svg>','<svg><path onload="x"/></svg>'])assert.throws(()=>validateProject(project({svg})));
assert.throws(()=>validateProject({...clone(defaults),version:1}),/separate Klebeteile/);assert.throws(()=>validateProject({...clone(defaults),construction:'glued'}));assert.throws(()=>validateProject({...clone(defaults),card:{...defaults.card,mode:'180'}}),/180° liegt/);assert.throws(()=>validateProject(project({contours:[]})));assert.throws(()=>validateProject(project({bridgeWidth:NaN})));assert.throws(()=>poseProject(project(),NaN));
assert.notEqual(newFigure().id,newFigure().id);
// Architectural ribbons are a single strip with genuine broad treads and risers.
for(const key of ['terraces','blocks','wave']){
 const p=exampleProject(key),built=buildProject(p),flat=poseProject(p,180);assert.deepEqual(built.errors,[],key);assert.ok(p.structures.length>1);assert.equal(built.parts.length,1);
 const areas=built.material.areas;near(areas.base+areas.front+areas.roof+areas.waste,areas.blank,'Kirigami partitions one sheet');near(areas.waste,0,'ribbons need no internal waste');
 for(const s of built.structures){
  const cuts=built.parts[0].paths.filter(p=>p.structureId===s.structureId&&p.operation==='CUT'),folds=built.parts[0].paths.filter(p=>p.structureId===s.structureId&&p.operation.startsWith('FOLD'));
  assert.equal(cuts.length,2,'only the two long sides are cut');assert.equal(folds.length,2*s.structure.steps.length+1,'end hinges and every panel boundary folded');
  near(s.panels[0].t0,-s.A,'top hinge source');near(s.panels.at(-1).t1,s.B,'bottom hinge source');
  for(const angle of [0,1,15,45,90,135,179,180]){
   const rad=angle*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad),posed=poseProject(p,angle);
   for(const panel of posed.panels){const reference=flat.panels.find(r=>r.id===panel.id);
    for(let i=0;i<panel.triangles.length;i++)for(let j=0;j<3;j++){
     const q=panel.triangles[i][j],r=reference.triangles[i][j],next=(j+1)%3;
     near(distance(q,panel.triangles[i][next]),distance(r,reference.triangles[i][next]),`Kirigami rigid ${angle}`);
     if(angle===180){near(q[0],panel.sourceTriangles[i][j][0],'Kirigami flat x');near(q[1],panel.sourceTriangles[i][j][1],'Kirigami exact source t');near(q[2],0,'Kirigami flat plane');}
     if(angle===0){near(q[2],0,'Kirigami closed plane');assert.ok(q[1]>=-EPS&&q[1]<=p.card.half+EPS,'Kirigami fits closed card');}
     if(angle>0&&angle<180)near(q[1]-q[2]/Math.tan(rad/2),panel.sourceTriangles[i][j][1],'unique net projection proves no material penetration');
    }
   }
   for(let i=1;i<s.panels.length;i++)for(const x of [s.window.minX,s.window.maxX])near(distance(structurePoint(s.panels[i-1],[x,s.panels[i].t0],co,si),structurePoint(s.panels[i],[x,s.panels[i].t0],co,si)),0,'adjacent staircase panels share entire hinge');
   for(const x of [s.window.minX,s.window.maxX]){
    near(distance(structurePoint(s.panels[0],[x,-s.A],co,si),[x,s.A*co,s.A*si]),0,'Kirigami attached to moving leaf');
    near(distance(structurePoint(s.panels.at(-1),[x,s.B],co,si),[x,s.B,0]),0,'Kirigami attached to fixed leaf');
   }
  }
 }
 const svg=exportSVG(p);assert.ok(svg.includes('id="FOLD_MOUNTAIN"'));assert.ok(!svg.includes('data-part="structure'),'one blank, not separate strips');
}
{const p=clone(defaults);delete p.structures;assert.deepEqual(validateProject(p).structures,[],'v2 motif projects remain compatible');}
{const p=clone(defaults);p.structures=[newStructure({steps:[{rise:70,run:40}]})];assert.ok(buildProject(p).errors.some(e=>e.structureId&&/geschlossenen/.test(e.message)));assert.throws(()=>exportSVG(p),/Export gesperrt/);}
{const p=clone(defaults);p.structures=[newStructure(),newStructure()];assert.ok(buildProject(p).errors.some(e=>e.structureId&&/2 mm Abstand/.test(e.message)));}
{const p=project();p.structures=[newStructure()];assert.ok(buildProject(p).errors.some(e=>/2 mm Abstand/.test(e.message)),'figures and ribbons cannot share source material');}
{const p=clone(defaults);p.structures=[newStructure({x:5})];assert.ok(buildProject(p).errors.some(e=>/Kartenrand/.test(e.message)));}
for(const overrides of [{width:1},{steps:[]},{steps:[{rise:0,run:2}]},{steps:[{rise:2,run:NaN}]},{steps:Array.from({length:13},()=>({rise:1,run:1}))}]){
 const p=clone(defaults);p.structures=[newStructure(overrides)];assert.throws(()=>validateProject(p));
}
{const p=clone(defaults);p.structures=Array.from({length:11},()=>newStructure({steps:Array.from({length:12},()=>({rise:1,run:1}))}));assert.throws(()=>validateProject(p),/240/);}
{const p=project();p.structures=[newStructure({id:p.figures[0].id})];assert.throws(()=>validateProject(p),/eindeutige IDs/);}
assert.notEqual(newStructure().id,newStructure().id);
// The spiral is retained material with a free inner end, not a drawing placed on
// a rectangular stair. Each disconnected slab component is genuinely rigid.
const pathSegments=path=>{const values=path.d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi).map(Number),out=[];for(let i=2;i<values.length;i+=2)out.push([[values[i-2],values[i-1]],[values[i],values[i+1]]]);if(path.d.endsWith('Z'))out.push([[values.at(-2),values.at(-1)],[values[0],values[1]]]);return out;};
const collinearOverlap=([a,b],[c,d])=>{const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(Math.abs(cross(a,b,c))>EPS||Math.abs(cross(a,b,d))>EPS)return 0;const axis=Math.abs(a[0]-b[0])>=Math.abs(a[1]-b[1])?0:1;return Math.max(0,Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis])));};
const pointToSegment=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],v=dx*dx+dy*dy,u=v?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/v)):0;return Math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dy);};
for(const key of ['spiral','double-spiral']){
 const p=exampleProject(key),built=buildProject(p),flat=poseProject(p,180);assert.deepEqual(built.errors,[],key);assert.equal(built.parts.length,1);assert.equal(built.material.base.length,1,'the remaining card stays connected');
 const areas=built.material.areas;near(areas.base+areas.front+areas.roof+areas.waste,areas.blank,'spiral source material partition');near(areas.waste,0,'the open spiral leaves no discarded interior islands');
 for(const s of built.structures){
  assert.equal(s.structure.type,'spiral');assert.equal(s.footprint.length,1);assert.equal(s.footprint[0].length,1,'one simple ribbon, not closed concentric rings');assert.ok(s.sourcePointCount<=1024);assert.ok(s.faceCount>s.panels.length,'one slab can contain several connected portions of the same spiral');assert.equal(s.steps.length,s.structure.levels);
  const source=s.footprint[0][0],parameters=s.structure,turn=parameters.turns*2*Math.PI,slope=((parameters.width-parameters.ribbonWidth)/2-parameters.innerRadius)/turn,sign=parameters.direction==='cw'?1:-1;let tested=0,maxError=0;
  for(let i=0;i<=8192;i++){const u=turn*i/8192,phi=parameters.rotation*Math.PI/180+sign*u,r=parameters.innerRadius+slope*u,co=Math.cos(phi),si=Math.sin(phi),dx=slope*co-sign*r*si,dy=slope*si+sign*r*co,n=Math.hypot(dx,dy);
   for(const side of [-1,1]){const q=[s.sourceOffset.x+r*co-side*parameters.ribbonWidth*dy/(2*n),s.sourceOffset.t+r*si+side*parameters.ribbonWidth*dx/(2*n)];
    if(q[1]<=s.window.minY+.05||q[1]>=s.window.maxY-.05)continue;let nearest=Infinity;for(let j=1;j<source.length;j++)nearest=Math.min(nearest,pointToSegment(q,source[j-1],source[j]));maxError=Math.max(maxError,nearest);tested++;
   }
  }
  assert.ok(tested>10000,'dense exact normal-offset boundary samples tested away from deliberate horizontal cap trims');assert.ok(maxError<=.05,`spiral physical chord error ${maxError} stays below 0.05 mm`);
  const perimeter=s.footprint[0][0].slice(1).reduce((n,q,i)=>n+distance(q,s.footprint[0][0][i]),0),anchors=[...s.anchors.back,...s.anchors.foot];
  assert.equal(anchors.length,2,'only the two outer-turn cap hinges attach to the card; the centre remains free');
  for(const hinge of anchors)assert.ok(distance(...hinge)>=1,'finite uncut outer hinges');
  near(s.cuts.reduce((n,line)=>n+distance(...line),0)+anchors.reduce((n,line)=>n+distance(...line),0),perimeter,'CUT boundary leaves every anchor uncut');
  for(const fold of s.folds){assert.ok(distance(...fold.points)>EPS,'all folds have material width');const intervals=horizontalSections(s.footprint,fold.t);assert.ok(intervals.some(line=>fold.points[0][0]>=line[0][0]-EPS&&fold.points[1][0]<=line[1][0]+EPS),'fold is confined to retained spiral material');}
  for(const angle of [0,1,15,45,90,135,179,180]){
   const rad=angle*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad);
   for(const fold of s.folds){const before=s.panels.find(face=>Math.abs(face.t1-fold.t)<EPS),after=s.panels.find(face=>Math.abs(face.t0-fold.t)<EPS);
    for(const [x,t]of [fold.points[0],fold.points[1],[(fold.points[0][0]+fold.points[1][0])/2,fold.t]]){
     if(before&&after)near(distance(structurePoint(before,[x,t],co,si),structurePoint(after,[x,t],co,si)),0,'spiral faces retain the exact finite hinge');
     else if(after)near(distance(structurePoint(after,[x,t],co,si),[x,-t*co,-t*si]),0,'spiral back cap stays attached to moving leaf');
     else near(distance(structurePoint(before,[x,t],co,si),[x,t,0]),0,'spiral front cap stays attached to fixed leaf');
    }
   }
  }
 }
 for(const angle of [0,1,15,45,90,135,179,180]){
  const posed=poseProject(p,angle);
  for(const face of posed.panels){const ref=flat.panels.find(other=>other.id===face.id);for(let i=0;i<face.triangles.length;i++)for(let j=0;j<3;j++){
   const q=face.triangles[i][j],next=(j+1)%3;near(distance(q,face.triangles[i][next]),distance(ref.triangles[i][j],ref.triangles[i][next]),'spiral triangle length stays constant');
   if(angle===180){near(q[0],face.sourceTriangles[i][j][0],'spiral 180 x identity');near(q[1],face.sourceTriangles[i][j][1],'spiral 180 t identity');near(q[2],0,'spiral 180 flat');}
   if(angle===0){near(q[2],0,'spiral closed flat');assert.ok(q[1]>=-EPS&&q[1]<=p.card.half+EPS,'spiral fits fully closed card');}
   if(angle>0&&angle<180)near(q[1]-q[2]/Math.tan(angle*Math.PI/360),face.sourceTriangles[i][j][1],'spiral no-intersection projection recovers source t');
  }}
 }
 const cuts=built.parts[0].paths.filter(path=>path.operation==='CUT').flatMap(pathSegments),folds=built.parts[0].paths.filter(path=>path.operation.startsWith('FOLD')).flatMap(pathSegments);
 for(const cut of cuts)for(const fold of folds)assert.ok(collinearOverlap(cut,fold)<EPS,'spiral export never cuts a folding interval');
 for(const line of built.parts[0].paths.filter(path=>path.operation==='FOLD_VALLEY'&&!path.figureId&&!path.structureId).flatMap(pathSegments))for(const s of built.structures)for(const section of horizontalSections(s.footprint,0))assert.ok(collinearOverlap(line.map(([x,y])=>[x,y-p.card.half]),section)<EPS,'card spine never crosses retained spiral material or its boundary');
 assert.ok(built.parts[0].paths.filter(path=>path.structureId&&path.operation==='CUT').length>20,'machine data follows the actual curved spiral boundary');
 const svg=exportSVG(p);assert.match(svg,/data-structure=/);assert.equal(JSON.parse(exportProject(p)).structures[0].type,'spiral');assert.ok(built.warnings.some(w=>/koordinierte Faltbewegung/.test(w.message)),'guided precreasing is explained');
}
for(const overrides of [{rotation:90},{rotation:-45,direction:'ccw'},{levels:12},{height:22},{turns:1.5,ribbonWidth:3},{width:88,turns:2.25,ribbonWidth:3.5,innerRadius:8,height:32,levels:5,rotation:30,direction:'ccw'}]){
 const p=clone(defaults);p.structures=[newSpiral(overrides)];assert.deepEqual(buildProject(p).errors,[],`valid spiral variation ${JSON.stringify(overrides)}`);
}
for(const overrides of [{turns:6},{ribbonWidth:20},{ribbonWidth:.5},{innerRadius:0},{height:100},{rotation:145},{width:2000,turns:6,ribbonWidth:5,innerRadius:6}]){
 const p=clone(defaults);p.structures=[newSpiral(overrides)];assert.doesNotThrow(()=>validateProject(p),'geometric conflicts remain editable');const b=buildProject(p);assert.ok(b.errors.some(e=>e.structureId===p.structures[0].id));assert.throws(()=>exportSVG(p),/Export gesperrt/);assert.doesNotThrow(()=>poseProject(p,90),'invalid geometry has a safe finite preview');
}
for(const overrides of [{turns:NaN},{turns:7},{ribbonWidth:0},{innerRadius:-1},{rotation:Infinity},{direction:'evil'},{levels:1.5},{levels:13},{height:0},{type:'unknown'}]){
 const p=clone(defaults);p.structures=[newSpiral(overrides)];assert.throws(()=>validateProject(p),'malformed or oversized spiral schema is rejected');
}
{const p=clone(defaults);p.structures=Array.from({length:7},()=>newSpiral());assert.throws(()=>validateProject(p),/6 Spiralbänder/);}
{const p=clone(defaults);p.structures=[newSpiral({x:2})];assert.ok(buildProject(p).errors.some(e=>/Kartenrand/.test(e.message)));}
{const p=clone(defaults);p.card.half=50;p.structures=[newSpiral()];assert.ok(buildProject(p).errors.some(e=>/geschlossenen/.test(e.message)));}
{const p=clone(defaults);p.structures=[newSpiral(),newStructure()];assert.ok(buildProject(p).errors.some(e=>/2 mm Abstand/.test(e.message)));}
assert.notEqual(newSpiral().id,newSpiral().id);
console.log('Klappkarten: one-sheet topology, rigid kinematics, net/material identity, holes, finite hinges, architectural ribbons and spirals, SVG operations and trust boundaries passed.');
