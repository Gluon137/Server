import assert from 'node:assert/strict';
import {createProject, clone, validateProject, motifs, useMotif} from '../website/automaten-studio/project.mjs';
import {buildProject, poseProject} from '../website/automaten-studio/geometry.mjs';
import {packSheets, exportSVG, exportPartsList, exportAssemblyHTML} from '../website/automaten-studio/export.mjs';

const near=(a,b,message,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${message}: ${a} != ${b}`);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const box=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))});
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const crosses=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-12&&cross(c,d,a)*cross(c,d,b)<-1e-12;
const edges=poly=>poly.map((p,i)=>[p,poly[(i+1)%poly.length]]);
function inside(point,poly){let result=false;for(const [a,b] of edges(poly))if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;return result;}
function simple(poly){for(let i=0;i<poly.length;i++)for(let j=i+2;j<poly.length;j++){if(i===0&&j===poly.length-1)continue;assert.ok(!crosses(poly[i],poly[(i+1)%poly.length],poly[j],poly[(j+1)%poly.length]),'Physical cut contour has no crossing');}}
const material=(point,contours)=>contours.reduce((value,poly)=>value!==inside(point,poly),false);
function packed(model){
 const packed=packSheets(model);assert.deepEqual(packed.errors,[]);const ids=[];
 for(const sheet of packed.sheets){const placed=[];for(const entry of sheet.entries){
  ids.push(entry.id);assert.equal(entry.rotation,0);const part=model.parts.find(p=>p.id===entry.id);assert.ok(part,'Packed part exists');
  const contours=part.contours.map(poly=>poly.map(([x,y])=>[x+entry.x,y+entry.y]));
  for(const poly of contours)for(const [x,y] of poly)assert.ok(x>=-1e-7&&y>=-1e-7&&x<=sheet.width+1e-7&&y<=sheet.height+1e-7,'Every actual cut point lies inside the sheet');
  for(const other of placed){
   for(const a of contours)for(const b of other)for(const [p,q] of edges(a))for(const [r,s] of edges(b))assert.ok(!crosses(p,q,r,s),'Packed cut paths cannot cross');
   assert.ok(!contours[0].some(p=>material(p,other))&&!other[0].some(p=>material(p,contours)),'Packed material cannot overlap through containment');
  }placed.push(contours);
 }}
 assert.deepEqual(ids.sort(),model.parts.map(p=>p.id).sort(),'Packing contains every part exactly once');return packed;
}
const initial=createProject(), original=JSON.stringify(initial);
assert.equal(initial.format,'automaten-studio');assert.equal(initial.version,1);
const validated=validateProject(initial);assert.equal(validated.valid,true,validated.errors.join('; '));assert.deepEqual(validated.project,initial);
validated.project.figure.points[0][0]=99;assert.equal(JSON.stringify(initial),original,'Import validation clones nested input');
const copied=clone(initial);copied.figure.anchor[0]=1;assert.notDeepEqual(copied.figure.anchor,initial.figure.anchor);
for(const key of ['bird','wave','flower']){assert.ok(motifs[key].name&&motifs[key].points.length>=3);const p=useMotif(createProject(),key);assert.deepEqual(p.figure.points,motifs[key].points);p.figure.points[0][0]+=1;assert.notDeepEqual(p.figure.points,motifs[key].points,'Preset is independently editable');}

for(const type of ['slider','eccentric','lever']){
 const p=createProject();p.mechanism.type=type;const model=buildProject(p);assert.equal(model.valid,true,`${type}: ${model.errors.join('; ')}`);
 assert.equal(JSON.stringify(p),JSON.stringify({...initial,mechanism:{...initial.mechanism,type}}),'Building does not mutate project');
 assert.ok(model.parts.some(p=>p.kind==='figure')&&model.parts.some(p=>p.kind==='frame')&&model.parts.some(p=>p.kind==='mechanism')&&model.parts.some(p=>p.kind==='coupon'));
 assert.equal(new Set(model.parts.map(p=>p.id)).size,model.parts.length);
 for(const part of model.parts)for(const poly of part.contours){assert.ok(poly.length>=3&&poly.flat().every(Number.isFinite));simple(poly);}
 const poses=[];for(let angle=0;angle<=360;angle+=5){const pose=poseProject(model,angle);poses.push(pose);assert.ok(pose.entries.length&&pose.joints.flat().every(Number.isFinite));assert.ok(Object.values(pose.bounds).every(Number.isFinite));
  const [o,c,b,d]=pose.joints;near(distance(o,c),p.mechanism.radius,`${type} crank remains rigid`);
  if(type==='slider'){near(distance(c,b),p.mechanism.rodLength,'Connecting rod closure');near(b[0],o[0],'Slider follows its guide');}
  if(type==='lever'){near(distance(c,b),p.mechanism.coupler,'Four-bar coupler closure');near(distance(b,d),p.mechanism.rocker,'Four-bar output closure');near(distance(o,d),p.mechanism.ground,'Fixed ground pivots');}
 }
 const first=poses[0],last=poses.at(-1);assert.deepEqual(first.entries.map(e=>e.id),last.entries.map(e=>e.id));
 first.joints.forEach((p,i)=>p.forEach((v,j)=>near(v,last.joints[i][j],'One revolution returns to original joint')));
 first.entries.forEach((entry,i)=>{near(entry.x,last.entries[i].x,'Periodic part x');near(entry.y,last.entries[i].y,'Periodic part y');near(Math.sin(entry.rotation*Math.PI/180),Math.sin(last.entries[i].rotation*Math.PI/180),'Periodic rotation');});
 if(type!=='lever'){const output=poses.map(p=>p.joints[2][1]);near(Math.max(...output)-Math.min(...output),2*p.mechanism.radius,'Measured stroke is twice the crank radius');near(model.metrics.stroke,2*p.mechanism.radius,'Displayed stroke matches measured motion');}
 assert.ok(model.dowels.length&&model.dowels.every(d=>d.diameter===p.material.dowel&&d.quantity>0&&d.length>p.material.thickness));
 const figure=model.parts.find(part=>part.id==='figure'),host=model.parts.find(part=>part.id==={slider:'slider',eccentric:'yoke',lever:'rocker'}[type]);
 const figureStack=(Math.abs(figure.layer-host.layer)+1)*p.material.thickness;
 assert.ok(model.dowels.find(d=>d.id===(type==='lever'?'rocker-coupler-pin':'figure-pin')).length>=figureStack-1e-7,'Figure pin spans all glued host, support and figure plates');

 if(type==='lever')assert.ok(!model.dowels.some(d=>d.id==='figure-pin'),'Lever uses one continuous coupler-to-figure pin');
 const pinParts={'drive-axle':['rear-crank','drive-collar-back','backplate','bearing-cheek-front',type==='eccentric'?'eccentric':'crank'],'crank-pin':['crank','coupler','crank-pin-collar'],'slider-pin':['slider','coupler','slider-pin-collar'],'rocker-ground-pin':['backplate','rocker','rocker-ground-collar',...Array.from({length:5},(_,i)=>'rocker-spacer-'+(i+1))],'rocker-coupler-pin':['coupler','rocker','rocker-coupler-collar','figure-pad-0','figure-pad-1','figure'],'figure-pin':[host.id,'figure-pad-0','figure-pad-1','figure']};
 for(const pin of model.dowels){if(!pinParts[pin.id])continue;const stack=pinParts[pin.id].map(id=>model.parts.find(part=>part.id===id));assert.ok(stack.every(part=>part&&Number.isFinite(part.z)),'Every axial stack has real positions');const length=Math.max(...stack.map(part=>part.z+p.material.thickness))-Math.min(...stack.map(part=>part.z));assert.ok(pin.length>=length-1e-7&&pin.length<length+.101,pin.id+' length spans actual mating part Z intervals');}
 const board=model.parts.find(part=>part.id==='backplate');
 for(const frame of model.parts.filter(part=>part.kind==='frame'&&part.layer===1&&model.fixed[part.id])){const e=model.fixed[frame.id];assert.ok(frame.contours[0].every(([x,y])=>inside([x+e.x,y+e.y],board.contours[0])),'First-layer fixed support has a backplate attachment surface');}
 assert.ok(model.assembly.length>=3);const sheets=packed(model);
 for(let index=0;index<sheets.sheets.length;index++){
  const svg=exportSVG(model,index);assert.match(svg,/<svg\b/);assert.match(svg,/width="[\d.]+mm"/);assert.match(svg,/height="[\d.]+mm"/);assert.match(svg,/viewBox="0 0 [\d.]+ [\d.]+"/);
  assert.ok(!/<(?:text|script|foreignObject|image)\b|stroke-dasharray|NaN|Infinity/.test(svg),'Machine SVG contains finite cut geometry only');
  assert.ok((svg.match(/<path\b/g)||[]).length>=sheets.sheets[index].entries.length,'Every part has an outline in SVG');
  const cutTags=[...svg.matchAll(/<path\b[^>]*>/g)].map(match=>match[0]);
  const sheetParts=sheets.sheets[index].entries.map(entry=>model.parts.find(part=>part.id===entry.id));
  assert.equal(cutTags.length,sheetParts.reduce((sum,part)=>sum+part.contours.length,0),'Every physical contour exported exactly once');
  const firstOuter=cutTags.findIndex(tag=>tag.includes('data-contour="outer"'));
  assert.ok(cutTags.slice(0,firstOuter).every(tag=>tag.includes('data-contour="inner"'))&&cutTags.slice(firstOuter).every(tag=>tag.includes('data-contour="outer"')),'All inner cuts precede every outside cut');
  for(const part of sheetParts)assert.equal(cutTags.filter(tag=>tag.includes('data-part="'+part.id+'"')).length,part.contours.length,'Export contour count matches '+part.id);

 }
 assert.match(exportPartsList(model),/mm/);assert.match(exportAssemblyHTML(model),/<html|<!doctype html/i);assert.match(exportAssemblyHTML(model),/@media print/);
 const thick=clone(p);thick.material.thickness+=1;const rebuilt=buildProject(thick);assert.equal(rebuilt.valid,true,rebuilt.errors.join('; '));
 for(const d of model.dowels){const next=rebuilt.dowels.find(n=>n.id===d.id);assert.ok(next&&next.length>d.length,`${d.id}: dowel stack length follows material thickness`);}
}

// Calibrated running and glued bores must change real cut contours, not just labels.
const calibrationBase=buildProject(createProject());
function boreContours(model,diameter){return model.parts.filter(part=>part.kind!=='coupon').flatMap(part=>part.contours.slice(1).flatMap((poly,i)=>{const b=box(poly);return Math.abs(b.maxX-b.minX-diameter)<1e-6&&Math.abs(b.maxY-b.minY-diameter)<1e-6?[{id:part.id,index:i+1}]:[];}));}
for(const [field,offset] of [['running',.25],['glue',.15]]){
 const p=createProject(),diameter=p.material.dowel+p.material[field],bores=boreContours(calibrationBase,diameter);assert.ok(bores.length,field+' has actual fabrication holes');
 p.material[field]+=offset;const changed=buildProject(p);assert.equal(changed.valid,true,changed.errors.join('; '));
 for(const bore of bores){const b=box(changed.parts.find(part=>part.id===bore.id).contours[bore.index]);near(b.maxX-b.minX,diameter+offset,field+' changes hole diameter');near(b.maxY-b.minY,diameter+offset,field+' changes hole diameter');}
}

const dense=createProject();dense.figure.points=Array.from({length:256},(_,i)=>[50+45*Math.cos(i/256*2*Math.PI),50+45*Math.sin(i/256*2*Math.PI)]);dense.figure.anchor=[50,50];assert.equal(validateProject(dense).valid,true,'A detailed 256-point authored contour remains importable');
const bad=[p=>p.format='other',p=>p.version=99,p=>p.mechanism.type='unknown',p=>p.mechanism.radius=NaN,p=>p.material.dowel=Infinity,p=>p.material.running=-1,p=>p.layout.width=0,p=>p.figure.width=-1,p=>p.figure.color='" onload="alert(1)',p=>p.figure.points=[[0,0],[100,100],[0,100],[100,0]],p=>p.figure.points=[[0,0],[20,0],[40,0]],p=>p.figure.points=[[0,0],[110,0],[0,100]],p=>p.figure.anchor=[-1,50],p=>p.figure.points=[[0,0],[100,0],[100,100],[50,0],[0,100]],p=>p.figure.points=Array.from({length:257},(_,i)=>[50+45*Math.cos(i/257*2*Math.PI),50+45*Math.sin(i/257*2*Math.PI)]),p=>{p.figure.points=[[0,0],[100,0],[100,100],[0,100]];p.figure.anchor=[7.49,50];}];
for(const change of bad){const p=createProject();change(p);const result=validateProject(p);assert.equal(result.valid,false,'Invalid import rejected: '+JSON.stringify(p));assert.ok(result.errors.length);}
for(const change of [p=>{p.mechanism.rodLength=10;},p=>{p.mechanism.type='lever';p.mechanism.radius=22;p.mechanism.ground=90;p.mechanism.coupler=40;p.mechanism.rocker=25;},p=>{p.figure.anchor=[1,1];}]){
 const p=createProject();change(p);const model=buildProject(p);assert.equal(model.valid,false,'Infeasible mechanism or unsupported mounting pad rejected');assert.ok(model.errors.length);assert.throws(()=>exportSVG(model));
}
for(const type of ['slider','lever']){const p=createProject();p.mechanism.type=type;p.mechanism.radius=5;const model=buildProject(p);assert.equal(model.valid,false,'Overlapping crank bores cannot fabricate a usable crank');assert.match(model.errors.join(' '),/Steg|Bohr|Loch/i);}
const zConflict=useMotif(createProject(),'flower');Object.assign(zConflict.mechanism,{rodLength:45,radius:22});Object.assign(zConflict.material,{thickness:2,axial:1});Object.assign(zConflict.figure,{width:110,height:110});
assert.equal(validateProject(zConflict).valid,true);const obstructed=buildProject(zConflict);assert.equal(obstructed.valid,false,'Real axial overlap blocks fabrication');assert.match(obstructed.checks.collision.text,/Decksteg.*Figur|Figur.*Decksteg/);
const obstructingFigure=obstructed.parts.find(p=>p.id==='figure'),caps=obstructed.parts.filter(p=>p.id.startsWith('guide-cap'));
assert.ok(caps.some(cap=>cap.layer!==obstructingFigure.layer&&cap.z<obstructingFigure.z+zConflict.material.thickness&&obstructingFigure.z<cap.z+zConflict.material.thickness),'Collision regression crosses different layer labels with overlapping real Z intervals');
const tooSmall=createProject();tooSmall.layout.width=20;tooSmall.layout.height=20;const small=buildProject(tooSmall);assert.ok(!small.valid||packSheets(small).errors.length,'A part larger than a sheet cannot be silently omitted');
console.log('Automaten: project validation, rigid-link closure, periodic motion, fabrication contours, packing, dowel stacks and exports passed.');
