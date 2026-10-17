import assert from 'node:assert/strict';
import {newSurface,validateSurfaces,compileSurfaces} from '../surface.mjs';
import {triangulateContours} from '../geometry.mjs';
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-5,`${m}: ${a} != ${b}`);
const make=shapes=>({card:{width:148,half:105},surface:{active:true,shapes}});
const compile=p=>compileSurfaces(p,triangulateContours);
const validate=p=>validateSurfaces(p,(v,l,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(l);},new Set());
const point=(p,[x,t],angle)=>{const a=angle*Math.PI/180,D=p.kind==='front'?p.D:t+p.Z,Z=p.kind==='roof'?p.Z:p.D-t;return[x,D+Z*Math.cos(a),Z*Math.sin(a)];};
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
let checks=0;
function conserved(g){const a=g.material.areas;near(a.blank,a.base+a.front+a.roof+a.waste,'all paper accounted');checks++;}
for(const orientation of ['vertical','horizontal']){
 const p=make([newSurface({orientation,contours:[[[28,5],[67,5],[77,19],[58,41],[28,32]]]})]);validate(p);const g=compile(p);assert.deepEqual(g.errors,[]);conserved(g);
 assert.equal(g.connectivity.reached.length,g.connectivity.nodes.length,'all faces attached');checks++;
 for(const panel of g.panels)for(const tri of panel.triangles)for(const a of [0,45,90,135,180]){
  const world=tri.map(q=>point(panel,q,a));for(let i=0;i<3;i++)near(distance(world[i],world[(i+1)%3]),distance(tri[i],tri[(i+1)%3]),'rigid triangle');
  if(a===180)for(let i=0;i<3;i++){near(world[i][1],tri[i][1],'flat source');near(world[i][2],0,'flat z');}
  if(a===0)for(const q of world){assert.ok(q[1]>=-1e-5&&q[1]<=p.card.half+1e-5);near(q[2],0,'closed z');}
 }checks++;
 for(const h of g.hinges){const nodes=h.owners.map(i=>g.connectivity.nodes[i]);for(const a of [0,45,90,180])for(const q of [h.a,h.b])near(distance(point(nodes[0],q,a),point(nodes[1],q,a)),0,'coincident hinges');}checks++;
 assert.ok(g.paths.some(x=>x.operation==='FOLD_MOUNTAIN'));assert.ok(g.paths.some(x=>x.operation==='FOLD_VALLEY'));assert.ok(g.paths.some(x=>x.operation==='CUT'));checks++;
}
{
 const contours=[[[30,0],[90,0],[90,45],[30,45]],[[45,12],[65,12],[65,30],[45,30]]];
 for(const orientation of ['vertical','horizontal']){const g=compile(make([newSurface({orientation,contours})]));assert.deepEqual(g.errors,[]);conserved(g);near(g.material.areas.waste,360,'holes preserved');checks++;}
}
{
 const a=newSurface({name:'back',offset:20,contours:[[[25,0],[85,0],[85,40],[25,40]]]}),b=newSurface({name:'front',offset:30,contours:[[[55,0],[110,0],[110,30],[55,30]]]});
 const g=compile(make([a,b]));conserved(g);assert.ok(g.warnings.some(w=>w.surfaceId===a.id&&w.message.includes('ausgespart')));assert.ok(!g.warnings.some(w=>w.surfaceId===b.id&&w.message.includes('ausgespart')));checks++;
 const reverse=compile(make([b,a]));conserved(reverse);assert.ok(reverse.warnings.some(w=>w.surfaceId===b.id&&w.message.includes('ausgespart')));checks++;
 const occupied=g.panels.filter(p=>p.surfaceId===b.id);assert.ok(occupied.length);checks++;
}
{
 const g=compile(make([newSurface({contours:[[[40,0],[80,30],[40,30],[80,0]]]})]));assert.ok(g.errors.some(e=>e.message.includes('überkreuzen')));checks++;
 const tooTall=compile(make([newSurface({offset:80})]));assert.ok(tooTall.errors.some(e=>e.message.includes('geschlossenen')));checks++;
 const edge=compile(make([newSurface({contours:[[[0,0],[30,0],[30,25],[0,25]]]})]));assert.ok(edge.errors.some(e=>e.message.includes('Kartenrand')));checks++;
 assert.throws(()=>validate(make([newSurface({offset:NaN})])));assert.throws(()=>validate(make([newSurface({contours:[[[0,0],[1,1]]]})])));checks++;
}
{
 // Two independent polygon components each receive their own integral supports.
 const g=compile(make([newSurface({contours:[[[25,5],[42,5],[42,25],[25,25]],[[88,5],[110,5],[110,35],[88,35]]]})]));assert.deepEqual(g.errors,[]);conserved(g);checks++;
 const empty=compile(make([]));assert.deepEqual(empty.errors,[]);conserved(empty);near(empty.material.areas.base,31080,'blank');checks++;
}
{
 const a=newSurface({offset:20,contours:[[[40,0],[60,0],[60,30],[40,30]]]}),b=newSurface({offset:30,contours:[[[39,0],[59.999,0],[59.999,40],[39,40]]]});
 const g=compile(make([a,b]));conserved(g);
 assert.ok(g.errors.some(e=>e.surfaceId===a.id&&e.message.includes('unter 1 mm')),'priority-created 0.001mm physical hinge blocks export');checks++;
 const wideTrim=compile(make([a,newSurface({...b,contours:[[[39,0],[59,0],[59,40],[39,40]]]})]));
 assert.ok(wideTrim.errors.some(e=>e.surfaceId===a.id&&e.message.includes('beiden Kartenhälften')),'one-sided trimmed flap cannot masquerade as driven popup');checks++;
}
{
 // One wide physical foot hinge is split at a priority ownership boundary.
 // Its first exported segment is only .5mm; the welded planar faces have a
 // contiguous 25mm hinge and must remain valid.
 const a=newSurface({offset:20,contours:[[[40,0],[60,0],[60,30],[40,30]]]}),b=newSurface({offset:20,contours:[[[40.5,0],[65,0],[65,5],[40.5,5]]]});
 const g=compile(make([a,b]));assert.deepEqual(g.errors,[]);
 assert.ok(g.hinges.some(h=>distance(h.a,h.b)<1),'fixture really contains a split sub-mm segment');
 assert.ok(g.hingeSpans.some(h=>h.y===20&&h.left===40&&h.right===65),'contiguous welded foot span aggregated');conserved(g);checks++;
}
{
 const bad=newSurface({contours:[[[30,0],[60,0],[45,0],[65,30],[30,30]]]});
 assert.ok(compile(make([bad])).errors.some(e=>e.surfaceId===bad.id&&e.message.includes('überkreuzen')),'adjacent doubled-back edge rejected');checks++;
 const valid=newSurface({contours:[[[30,0],[45,0],[60,0],[60,30],[30,30]]]});
 assert.deepEqual(compile(make([valid])).errors,[],'straight consecutive collinear edges remain valid');checks++;
}
console.log(`${checks} surface geometry checks passed`);
