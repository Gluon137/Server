import {compileSpiral,newSpiral} from './spiral.mjs';
export {newSpiral};
/** Parallel-hinge ribbons, cut from a single connected card blank. */
let serial=0;
export function newStructure(overrides={}) {
 return {id:`structure-${Date.now().toString(36)}-${++serial}`,name:'Treppenband',x:74,width:24,color:'#b18465',steps:[{rise:12,run:8},{rise:12,run:8},{rise:12,run:8}],...overrides};
}
export function validateStructures(project,number,ids) {
 if(project.structures===undefined)project.structures=[];
 if(!Array.isArray(project.structures)||project.structures.length>20)throw new Error('Höchstens 20 Kirigami-Bänder sind möglich.');
 let panels=0,spirals=0;
 for(const s of project.structures){
  if(!s||typeof s!=='object'||typeof s.id!=='string'||!s.id||ids.has(s.id))throw new Error('Kirigami-Bänder brauchen eindeutige IDs.');ids.add(s.id);
  if(typeof s.name!=='string'||s.name.length>200||!/^#[0-9a-f]{6}$/i.test(s.color))throw new Error('Ungültiger Name oder Farbe eines Kirigami-Bandes.');
  number(s.x,'Kirigami-Position',-2000,4000);number(s.width,'Kirigami-Breite',2,2000);
  if(s.type==='spiral'){
   if(++spirals>6)throw new Error('Höchstens 6 Spiralbänder sind möglich.');
   number(s.turns,'Spiralwindungen',.5,6);number(s.ribbonWidth,'Spiral-Stegbreite',.5,1000);number(s.innerRadius,'Spiral-Innenradius',0,1000);number(s.rotation,'Spiraldrehung',-360,360);number(s.height,'Spiral-Aufstellhöhe',.1,2000);number(s.levels,'Spiralstufen',1,12);
   if(!Number.isInteger(s.levels)||!['cw','ccw'].includes(s.direction))throw new Error('Ungültige Spiralstufen oder Spiralrichtung.');
   continue;
  }
  if(s.type!==undefined&&s.type!=='stairs')throw new Error('Unbekannter Kirigami-Bandtyp.');
  if(!Array.isArray(s.steps)||!s.steps.length||s.steps.length>12)throw new Error('Ein Treppenband braucht 1 bis 12 Stufen.');
  for(const step of s.steps){if(!step||typeof step!=='object')throw new Error('Ungültige Kirigami-Stufe.');number(step.rise,'Stufenhöhe',1,2000);number(step.run,'Stufentiefe',1,2000);}
  panels+=2*s.steps.length;if(panels>240)throw new Error('Höchstens 240 Kirigami-Flächen sind möglich.');
 }
}
const rectangle=(x0,t0,x1,t1)=>[[[[x0,t0],[x1,t0],[x1,t1],[x0,t1],[x0,t0]]]];
export function compileStructure(structure) {
 if(structure.type==='spiral')return compileSpiral(structure);
 const A=structure.steps.reduce((n,s)=>n+s.rise,0),B=structure.steps.reduce((n,s)=>n+s.run,0),x0=structure.x-structure.width/2,x1=structure.x+structure.width/2;
 let D=0,Z=A,t=-A;const panels=[],folds=[{t,operation:'FOLD_VALLEY'}];
 for(const step of structure.steps){
  const endRoof=t+step.run;
  panels.push({kind:'roof',D,Z,t0:t,t1:endRoof,source:rectangle(x0,t,x1,endRoof)});D+=step.run;t=endRoof;
  folds.push({t,operation:'FOLD_MOUNTAIN'});
  const endFront=t+step.rise;
  panels.push({kind:'front',D,Z,t0:t,t1:endFront,source:rectangle(x0,t,x1,endFront)});Z-=step.rise;t=endFront;
  folds.push({t,operation:'FOLD_VALLEY'});
 }
 return {structureId:structure.id,structure,panels,folds,footprint:rectangle(x0,-A,x1,B),window:{minX:x0,maxX:x1,minY:-A,maxY:B},A,B};
}
export function structurePoint(panel,[x,t],cos,sin){
 const D=panel.kind==='roof'?t+panel.Z:panel.D,Z=panel.kind==='roof'?panel.Z:panel.D-t;
 return [x,D+Z*cos,Z*sin];
}
