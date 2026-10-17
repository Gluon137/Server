import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../website/drehscheiben-studio/index.html',import.meta.url),'utf8');
const core=html.split('<script type="module">')[1].split('const $=id=>')[0];
const run=new Function('assert',core+`;return (async()=>{
const options={diameter:240,hole:3,slot:1.2,web:1.5,scale:90,segment:22,seed:72,labelColor:'#0000ff',cutColor:'#ff0000'};
// Compare each engraved digit with its rim counterpart, removing position and size.
for(const angle of [0,Math.PI/6,Math.PI/2,Math.PI,Math.PI*1.7]){
 for(const number of [1,12,85]){
  const p={number,angle,font:2.5,label:{point:[32,-40],leader:[[34,-40],[36,-40]]}};
  const paths=engravings({parts:[p],options}),n=numberLines(number,[0,0]).length;
  const rim=rotate([0,-114],angle);
  for(let i=0;i<n;i++)for(let j=0;j<paths[i].length;j++){
   const inner=mul(sub(paths[i][j],p.label.point),1/p.font);
   const outer=mul(sub(paths[n+i][j],rim),1/2.8);
   assert.ok(dist(inner,outer)<1e-10,'Inner and rim digits must have identical orientation');
  }
 }
}
// Exercise real placement with curves and two-digit labels, including clearance validation.
const lines=parsePath('M0 0 C25 -30 45 30 70 0 M0 20 C25 -10 45 50 70 20 M0 40 L70 40');
const model=await layout(lines,options);
assert.ok(model.count>=10);
assert.equal(validate(model).length,0);
for(const p of model.parts){
 const [start,end]=p.label.leader;
 const boundaryDistance=(v,poly)=>Math.min(...poly.map((a,i)=>pointSeg(v,a,poly[(i+1)%poly.length])));
 assert.ok(boundaryDistance(start,p.label.box)<1e-8,'Leader starts on label box boundary');
 assert.ok(boundaryDistance(end,p.poly)<1e-8,'Leader ends on its own cutout boundary');
 for(const q of model.parts)if(q!==p){
  assert.ok(!polygonNear(p.label.leader,q.poly,.29),'Leader avoids other cutouts');
  assert.ok(!polygonNear(p.label.leader,q.label.box,.29),'Leader avoids other labels');
  assert.ok(!polygonNear(p.label.leader,q.label.leader,.29),'Leaders do not cross');
 }
 const edge=sub(p.label.box[1],p.label.box[0]);
 assert.ok(Math.abs(cross(edge,[Math.cos(p.angle),Math.sin(p.angle)]))<1e-10,'Clearance box must rotate with label');
 for(const v of numberLines(p.number,p.label.point,p.font,p.angle).flat())assert.ok(inside(v,p.label.box),'Digits must stay inside clearance box');
}
const noHole=await layout(lines,{...options,hole:0});
assert.equal(validate(noHole).length,0);
for(const p of noHole.parts)assert.ok(!leaderNearCenter(p.label.leader,0));
const broken=structuredClone(model);delete broken.parts[0].label.leader;assert.ok(validate(broken).includes('Verbindungslinie'));
const svg=exportSVG(model);
for(const p of model.parts)assert.ok(svg.split('<g id="schnitte"')[0].includes('<path d="'+pathData(p.label.leader)+'"/>'),'Leader is exported as engraving');
for(const l of engravings(model))assert.ok(svg.includes('<path d="'+pathData(l)+'"/>'));
console.log('OK: matching label orientation, rotated collision boxes, '+model.count+' valid slots, SVG export');
})();`);
await run(assert);
