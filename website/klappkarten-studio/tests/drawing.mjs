import assert from 'node:assert/strict';
import {clone,defaults,newDrawing,exampleProject,validateProject} from '../project.mjs';
import {buildProject,poseProject} from '../geometry.mjs';
import {exportSVG,exportProject} from '../export.mjs';
const EPS=1e-5,near=(a,b,label)=>assert.ok(Math.abs(a-b)<EPS,`${label}: ${a} ≠ ${b}`),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const line=(id,operation,points,angle=90,closed=false)=>({id,operation,points,angle,closed});
const project=lines=>({...clone(defaults),drawing:newDrawing({lines})});
function mapped(panel,q,H){
 const [a,b,c]=panel.sourceTriangles[0],p=[q[0],q[1]-H],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-a[0],c[1]-a[1]],w=[p[0]-a[0],p[1]-a[1]],den=u[0]*v[1]-u[1]*v[0],s=(w[0]*v[1]-w[1]*v[0])/den,t=(u[0]*w[1]-u[1]*w[0])/den,[A,B,C]=panel.triangles[0];
 return A.map((n,i)=>n+s*(B[i]-n)+t*(C[i]-n));
}
function locateOnOldMesh(pose,q){for(const panel of pose.panels)for(let i=0;i<panel.sourceTriangles.length;i++){
 const[a,b,c]=panel.sourceTriangles[i],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-a[0],c[1]-a[1]],w=[q[0]-a[0],q[1]-a[1]],den=u[0]*v[1]-u[1]*v[0],s=(w[0]*v[1]-w[1]*v[0])/den,t=(u[0]*w[1]-u[1]*w[0])/den,weights=[1-s-t,s,t];
 if(weights.every(n=>n>=-1e-6&&n<=1+1e-6))return[0,1,2].map(axis=>weights.reduce((n,bary,j)=>n+bary*panel.triangles[i][j][axis],0));
}return null;}
function rigidChecks(p){
 const build=buildProject(p);assert.deepEqual(build.errors,[]);const flat=poseProject(p,0);assert.equal(flat.valid,true);
 for(const f of flat.panels)for(let i=0;i<f.sourceTriangles.length;i++)for(let j=0;j<3;j++)assert.deepEqual(f.triangles[i][j],[...f.sourceTriangles[i][j],0],'flat preview exactly reproduces material net');
 for(const progress of [0,7,25,47,50,75,93,100]){
  const posed=poseProject(p,progress);assert.equal(posed.valid,true);assert.equal(posed.flatFallback,false);
  for(const panel of posed.panels){const ref=flat.panels.find(f=>f.id===panel.id);for(let i=0;i<panel.triangles.length;i++)for(let j=0;j<3;j++)near(distance(panel.triangles[i][j],panel.triangles[i][(j+1)%3]),distance(ref.triangles[i][j],ref.triangles[i][(j+1)%3]),`rigid face at ${progress}%`);}
  for(const h of build.drawing.hinges){const left=posed.panels.find(f=>f.id===build.drawing.faces[h.left].id),right=posed.panels.find(f=>f.id===build.drawing.faces[h.right].id);for(const q of[h.a,h.b])near(distance(mapped(left,q,p.card.half),mapped(right,q,p.card.half)),0,'both endpoints of every finite hinge coincide');}
 }
 near(build.material.areas.base+build.material.areas.waste,build.material.areas.blank,'retained material and waste partition card');
 return build;
}
// Whole-sheet oblique hinge and arbitrary-axis chain, without bending a panel.
const diagonal=project([line('diagonal','FOLD_VALLEY',[[0,0],[148,210]],73)]);assert.equal(rigidChecks(diagonal).drawing.faces.length,2);
const chain=project([line('outline','CUT',[[20,100],[20,20],[120,20],[120,100],[70,100]]),line('first','FOLD_VALLEY',[[20,100],[70,100]],65),line('second','FOLD_MOUNTAIN',[[20,60],[120,80]],110)]);
assert.equal(rigidChecks(chain).drawing.faces.length,3);assert.ok(poseProject(chain,100).panels.some(f=>f.vertices.some(q=>Math.abs(q[2])>1)),'target pose actually folds');
for(const key of ['free-card','free-architecture']){const p=exampleProject(key),build=rigidChecks(p);assert.equal(build.parts.length,1);assert.equal(build.parts[0].paths.filter(p=>p.d.endsWith('Z')).length,1,'one outer card cut');assert.match(exportSVG(p),/FOLD_MOUNTAIN/);assert.deepEqual(JSON.parse(exportProject(p)),validateProject(p));}
// Genuine compatible closed cycles: parallel reverse steps must remain connected at every progress.
const architecture=rigidChecks(exampleProject('free-architecture'));assert.ok(architecture.drawing.hinges.length>=architecture.drawing.faces.length,'tests cycle constraints beyond a spanning tree');
// Conversion uses exported line coordinates, including curved spiral boundaries
// rounded independently from their hinge endpoints. These must weld consistently.
for(const key of ['animals','city','flower','butterfly','terraces','blocks','wave','spiral','double-spiral']){
 const p=exampleProject(key),compiled=buildProject(p),analytic=poseProject(p,90);p.drawing=newDrawing(p.card,{lines:compiled.parts[0].paths.slice(1).map((s,i)=>{const nums=s.d.match(/-?\d+(?:\.\d+)?/g).map(Number),points=[];for(let j=0;j<nums.length;j+=2)points.push(nums.slice(j,j+2));return{id:`convert-${i}`,operation:s.operation,points,closed:s.d.endsWith('Z'),angle:90};})});rigidChecks(p);
 for(const panel of poseProject(p,100).panels){const source=panel.sourceTriangles[0].reduce((q,p)=>q.map((v,i)=>v+p[i]/3),[0,0]),actual=panel.triangles[0].reduce((q,p)=>q.map((v,i)=>v+p[i]/3),[0,0,0]),expected=locateOnOldMesh(analytic,source);assert.ok(expected,`${key}: corresponding old material exists`);near(distance(actual,expected),0,`${key}: generic hinges reproduce analytic 90° pose`);}
}
// A closed cut makes an aperture, not another rigid island glued into the preview.
const aperture=project([line('hole','CUT',[[25,25],[65,25],[65,65],[25,65]],90,true)]),holeBuild=rigidChecks(aperture);
assert.equal(holeBuild.drawing.waste.length,1);assert.equal(holeBuild.drawing.faces.filter(f=>f.kept).length,1);assert.equal(holeBuild.drawing.faces.find(f=>f.kept).contours.length,2);near(holeBuild.material.areas.waste,1600,'removed hole area');
const holePose=poseProject(aperture,0),meshArea=holePose.panels.reduce((n,f)=>n+f.sourceTriangles.reduce((s,[a,b,c])=>s+Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2,0),0);near(meshArea,148*210-1600,'aperture removed from actual mesh');
const nested=project([line('outside','CUT',[[20,20],[90,20],[90,90],[20,90]],90,true),line('inside','CUT',[[30,30],[40,30],[40,40],[30,40]],90,true)]);near(rigidChecks(nested).material.areas.waste,4900,'nested cut components do not fill their enclosing hole');
// Interior open cuts and intersections remain one connected rigid patch.
for(const lines of[[line('slit','CUT',[[25,25],[65,65]])],[line('cross1','CUT',[[25,25],[65,65]]),line('cross2','CUT',[[25,65],[65,25]])]]){const b=rigidChecks(project(lines));assert.equal(b.drawing.faces.length,1);near(b.material.areas.base,148*210,'slit removes no area');}
// A dangling crease cannot manufacture an independent moving panel.
const dangling=project([line('unfinished','FOLD_VALLEY',[[25,25],[65,65]])]);assert.ok(buildProject(dangling).errors.some(e=>e.lineId==='unfinished'&&/keine zwei/.test(e.message)));assert.equal(poseProject(dangling,100).flatFallback,true);assert.throws(()=>exportSVG(dangling),/Export gesperrt/);
// Overlap conflicts, same-operation deduplication, and anchor validation.
const overlap=project([line('cut','CUT',[[20,30],[80,30]]),line('fold','FOLD_VALLEY',[[30,30],[60,30]])]);assert.ok(buildProject(overlap).errors.some(e=>e.lineId==='fold'&&/Überlagerte/.test(e.message)));
const duplicate=project([line('first','FOLD_VALLEY',[[0,105],[148,105]]),line('second','FOLD_VALLEY',[[148,105],[0,105]])]);assert.equal(rigidChecks(duplicate).drawing.hinges.length,1);
const anchor=project([]);anchor.drawing.anchor=[0,20];assert.ok(buildProject(anchor).errors.some(e=>/Fixpunkt/.test(e.message)));
const disconnected=project([line('sever','CUT',[[74,0],[74,210]])]);near(rigidChecks(disconnected).material.areas.waste,74*210,'disconnected material automatically becomes waste');
// Equal prescribed angles around an incompatible non-parallel cycle are never faked by a spanning tree.
const impossible=project([line('horizontal','FOLD_VALLEY',[[0,105],[148,105]]),line('vertical','FOLD_VALLEY',[[74,0],[74,210]])]),bad=buildProject(impossible);assert.ok(bad.errors.some(e=>e.progress&&/Faltzyklus/.test(e.message)));const safe=poseProject(impossible,100);assert.equal(safe.valid,false);assert.equal(safe.flatFallback,true);assert.ok(safe.panels.every(f=>f.vertices.every(q=>q[2]===0)));assert.throws(()=>exportSVG(impossible),/Export gesperrt/);
// Creases in discarded components are omitted; engraving clips to retained material.
const engrave=project([...aperture.drawing.lines,line('etch','ENGRAVE',[[0,45],[148,45]])]),engraveBuild=rigidChecks(engrave);assert.equal(engraveBuild.parts[0].paths.filter(p=>p.operation==='ENGRAVE').length,2);assert.ok(engraveBuild.parts[0].paths.every(p=>p.operation==='CUT'||p.operation==='ENGRAVE'));
const outside=project([line('outside','CUT',[[-1,40],[80,40]])]);assert.ok(buildProject(outside).errors.some(e=>e.lineId==='outside'));assert.equal(poseProject(outside,50).flatFallback,true);
// Existing procedural data survives dormant free drawings unchanged.
const legacy=exampleProject('spiral'),baseline=poseProject(legacy,90);legacy.drawing=newDrawing({active:false});assert.deepEqual(poseProject(legacy,90),baseline);assert.ok(!validateProject(clone(defaults)).drawing);
// Untrusted projects cannot bypass the typed, finite, bounded line schema.
for(const mutate of[p=>p.drawing.lines.push(line('x','SCRIPT',[[0,0],[1,1]])),p=>p.drawing.lines.push(line('x','FOLD_VALLEY',[[0,0],[1,1],[2,1]])),p=>p.drawing.lines.push(line('x','CUT',[[0,0],[NaN,1]])),p=>p.drawing.lines.push(line('x','FOLD_VALLEY',[[0,0],[1,1]],181)),p=>p.drawing.lines.push(line('x','CUT',Array.from({length:2401},(_,i)=>[i%148,i%210])))]){const p=project([]);mutate(p);assert.throws(()=>validateProject(p));}
const grid=project(Array.from({length:31},(_,i)=>line(`v${i}`,'CUT',[[4+i*4,0],[4+i*4,210]])).concat(Array.from({length:31},(_,i)=>line(`h${i}`,'CUT',[[0,4+i*6],[148,4+i*6]]))));assert.throws(()=>buildProject(grid),/höchstens 300 Faltflächen/,'intersection-heavy drawings stop before unbounded mesh allocation');
assert.throws(()=>architecture.drawing.pose(NaN),/Faltfortschritt/);
console.log('Free drawing: planar faces/holes, cuts, arbitrary-axis rigid trees, compatible and inconsistent cycles, finite hinges, exact flat net, waste, engraving and schema passed.');
