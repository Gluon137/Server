import {newStructure,newSpiral,validateStructures} from './kirigami.mjs';
import {newDrawing,validateDrawing} from './drawing.mjs';
import {newSurface,validateSurfaces} from './surface.mjs';
export {newSurface};
export {newStructure,newSpiral};
export {newDrawing};
/** Millimetres; x runs along the spine. Opening angle is 0° closed, 180° flat. */
export const defaults = Object.freeze({version:2,construction:'one-sheet',card:{mode:'90',width:148,half:105},figures:[],structures:[],layout:{width:600,height:400,gap:8},colors:{cut:'#ff0000',mountain:'#0000ff',valley:'#00aa00',engrave:'#000000'}});
export const clone = value => JSON.parse(JSON.stringify(value));
const rectangle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5 95V5H95V95Z"/></svg>';
let serial=0;
export function newFigure(overrides={}) { return {id:`figure-${Date.now().toString(36)}-${++serial}`,name:'Neue Figur',svg:rectangle,contours:[[[.05,.05],[.95,.05],[.95,.95],[.05,.95]]],width:36,height:40,x:74,depth:22,bridgeWidth:3,bridgeOffset:0,color:'#df925a',...overrides}; }
const number=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`${label}: ungültige Zahl (${min}–${max}).`);return v;};
export function validateProject(input) {
 if(input?.version===1)throw new Error('Projektversion 1 verwendet separate Klebeteile und kann nicht als Einblattkarte geöffnet werden. Das Original bleibt erhalten.');
 if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==2||input.construction!=='one-sheet')throw new Error('Unbekanntes Einblatt-Projektformat (Version 2).');
 const p=clone(input);if(!p.card||!p.layout||!p.colors||!Array.isArray(p.figures)||p.figures.length>50)throw new Error('Projektstruktur unvollständig (höchstens 50 Figuren).');
 if(p.card.mode!=='90')throw new Error('Einblattkarten unterstützen den aufstehenden 90°-Mechanismus. Bei 180° liegt dieser Mechanismus flach.');
 for(const k of ['width','half'])number(p.card[k],`Karte ${k}`,10,2000);
 for(const k of ['width','height'])number(p.layout[k],`Bogen ${k}`,10,10000);number(p.layout.gap,'Abstand',0,100);
 for(const k of ['cut','mountain','valley','engrave'])if(!/^#[0-9a-f]{6}$/i.test(p.colors[k]))throw new Error('Ungültige Linienfarbe.');
 let projectPoints=0,projectSVGBytes=0;const ids=new Set();for(const f of p.figures){
  if(!f||typeof f!=='object'||typeof f.id!=='string'||!f.id||ids.has(f.id))throw new Error('Figuren brauchen eindeutige IDs.');ids.add(f.id);
  if(typeof f.name!=='string'||f.name.length>200||typeof f.svg!=='string'||f.svg.length>1000000||!/^\s*<svg\b/i.test(f.svg))throw new Error('Ungültige SVG-Figur.');
  // Defence in depth: import sanitization is mandatory; saved projects must not bypass it.
  if(/<(?:script|foreignObject|iframe|object|embed|image|use|style)\b|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(|<!DOCTYPE|<!ENTITY/i.test(f.svg))throw new Error('SVG enthält nicht erlaubte aktive oder externe Inhalte.');
  for(const tag of f.svg.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/g))if(!['svg','g','path','rect','circle','ellipse','polygon','polyline','line','title','desc','metadata'].includes(tag[1]))throw new Error('SVG enthält ein nicht erlaubtes Element.');
  for(const k of ['width','height','depth'])number(f[k],`${f.name} ${k}`,0.1,2000);number(f.x,`${f.name} Position`,-2000,4000);
  if(f.bridgeWidth===undefined)f.bridgeWidth=3;if(f.bridgeOffset===undefined)f.bridgeOffset=0;
  number(f.bridgeWidth,`${f.name} Stegbreite`,.1,2000);number(f.bridgeOffset,`${f.name} Stegversatz`,-2000,2000);
  if(!/^#[0-9a-f]{6}$/i.test(f.color))throw new Error('Ungültige Figurenfarbe.');
  if(!Array.isArray(f.contours)||!f.contours.length)throw new Error('Einblattmotive benötigen geschlossene Konturdaten.');
  {if(f.contours.length>200)throw new Error('Ungültige Konturen.');let count=0;for(const c of f.contours){if(!Array.isArray(c)||c.length<3)throw new Error('Kontur braucht mindestens drei Punkte.');for(const point of c){if(!Array.isArray(point)||point.length!==2)throw new Error('Ungültiger Konturpunkt.');point.forEach(n=>number(n,'Konturpunkt',-1e-9,1+1e-9));}count+=c.length;}if(count>2048)throw new Error('Ressourcenlimit: maximal 2048 Konturpunkte pro Figur.');projectPoints+=count;if(projectPoints>8192)throw new Error('Ressourcenlimit: maximal 8192 Konturpunkte im gesamten Projekt.');}
  projectSVGBytes+=f.svg.length;if(projectSVGBytes>4000000)throw new Error('Ressourcenlimit: SVG-Daten im Projekt dürfen zusammen höchstens 4 MB umfassen.');
  if(f.engravings!==undefined){if(!Array.isArray(f.engravings)||f.engravings.length>200)throw new Error('Ungültige Gravurlinien.');for(const line of f.engravings){if(!Array.isArray(line)||line.length<2||line.length>2048)throw new Error('Ungültige Gravurlinie.');for(const q of line){if(!Array.isArray(q)||q.length!==2)throw new Error('Ungültiger Gravurpunkt.');q.forEach(n=>number(n,'Gravurpunkt',-1e-9,1+1e-9));}projectPoints+=line.length;if(projectPoints>8192)throw new Error('Ressourcenlimit: maximal 8192 Kontur- und Gravurpunkte im gesamten Projekt.');}}
  if(f.sourceTexts!==undefined&&!Array.isArray(f.sourceTexts))throw new Error('Ungültige Schriftinformationen.');
 }
 validateStructures(p,number,ids);
 validateDrawing(p,number);
 validateSurfaces(p,number,ids);
 return p;
}
const motifs={
 animals:{name:'Fuchs',color:'#db8554',path:'M10 95L8 12L35 30L50 20L65 30L92 12L90 95L65 85L50 98L35 85Z',points:[[.1,.95],[.08,.12],[.35,.3],[.5,.2],[.65,.3],[.92,.12],[.9,.95],[.65,.85],[.5,.98],[.35,.85]]},
 city:{name:'Stadthaus',color:'#8298b9',path:'M10 100V40L50 5L90 40V100Z',points:[[.1,1],[.1,.4],[.5,.05],[.9,.4],[.9,1]]},
 flower:{name:'Blume',color:'#d58ba8',path:'M43 100V65L10 48L20 30L38 33L30 10L50 2L70 10L62 33L80 30L90 48L57 65V100Z',points:[[.43,1],[.43,.65],[.1,.48],[.2,.3],[.38,.33],[.3,.1],[.5,.02],[.7,.1],[.62,.33],[.8,.3],[.9,.48],[.57,.65],[.57,1]]},
 butterfly:{name:'Schmetterling',color:'#b093c7',path:'M50 100L42 75L8 90L3 50L35 45L5 20L15 2L48 30L50 20L52 30L85 2L95 20L65 45L97 50L92 90L58 75Z',points:[[.5,1],[.42,.75],[.08,.9],[.03,.5],[.35,.45],[.05,.2],[.15,.02],[.48,.3],[.5,.2],[.52,.3],[.85,.02],[.95,.2],[.65,.45],[.97,.5],[.92,.9],[.58,.75]]}
};
export function exampleProject(key='animals') {
 const p=clone(defaults);
 if(key==='surface-blank'||key==='surface-architecture'){
  p.surface={active:true,shapes:[]};
  if(key==='surface-architecture')p.surface.shapes=[
   newSurface({name:'Linke Fassade',offset:18,color:'#adbea1',contours:[[[12,0],[45,0],[45,30],[12,30]]]}),
   newSurface({name:'Giebelhaus',offset:26,color:'#d5ab83',contours:[[[57,0],[91,0],[91,34],[74,48],[57,34]]]}),
   newSurface({name:'Terrasse',orientation:'horizontal',offset:25,color:'#a2b8c6',contours:[[[104,0],[136,0],[136,26],[104,26]]]})
  ];
  return p;
 }
 if(key==='free-card'){
  p.drawing=newDrawing({lines:[{id:'free-flap-cut',operation:'CUT',points:[[38,67],[78,50],[98,88]]},{id:'free-flap-fold',operation:'FOLD_VALLEY',points:[[98,88],[38,67]],angle:80},{id:'free-main-fold',operation:'FOLD_VALLEY',points:[[0,130],[148,130]],angle:90}]});return p;
 }
 if(key==='free-architecture'){
  const lines=[];let cursor=0;for(const[i,x]of[12,57,102].entries()){
   const right=x+33,a=25+i*5,b=16+i*3,top=105-a,ridge=105+b-a,foot=105+b;
   lines.push({id:`stair-${i}-left`,operation:'CUT',points:[[x,top],[x,foot]]},{id:`stair-${i}-right`,operation:'CUT',points:[[right,top],[right,foot]]});
   for(const[name,y,operation]of[['back',top,'FOLD_VALLEY'],['ridge',ridge,'FOLD_MOUNTAIN'],['foot',foot,'FOLD_VALLEY']])lines.push({id:`stair-${i}-${name}`,operation,points:[[x,y],[right,y]],angle:90});
   if(x>cursor)lines.push({id:`spine-${i}`,operation:'FOLD_VALLEY',points:[[cursor,105],[x,105]],angle:90});cursor=right;
  }
  lines.push({id:'spine-end',operation:'FOLD_VALLEY',points:[[cursor,105],[148,105]],angle:90});p.drawing=newDrawing({lines});return p;
 }
 if(key==='spiral'){p.structures=[newSpiral()];return p;}
 if(key==='double-spiral'){
  p.structures=[newSpiral({name:'Linkes Spiralband',x:38,width:62,turns:1.75,innerRadius:5,ribbonWidth:3,height:24,levels:3,color:'#9aaa91'}),newSpiral({name:'Rechtes Spiralband',x:110,width:62,turns:1.75,innerRadius:5,ribbonWidth:3,height:24,levels:3,direction:'ccw',color:'#c39b78'})];return p;
 }
 if(['terraces','blocks','wave'].includes(key)){
  const count=key==='blocks'?5:4,span=key==='blocks'?24:30;
  p.structures=Array.from({length:count},(_,i)=>newStructure({name:`${key==='terraces'?'Terrasse':key==='blocks'?'Block':'Welle'} ${i+1}`,x:74+(i-(count-1)/2)*span,width:span-3,color:['#b18465','#b9a37c','#8f9e80','#c19c81','#a2ad94'][i],steps:Array.from({length:key==='terraces'?4:key==='blocks'?i%3+2:4},(_,j)=>({rise:key==='wave'?8+Math.round(4*Math.sin((i+j)*Math.PI/3)):key==='blocks'?9:10,run:key==='wave'?8:key==='blocks'?10:8}))}));
  return p;
 }
 const m=motifs[key]||motifs.animals;
 const base={name:m.name,color:m.color,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${m.path}"/></svg>`,contours:[m.points]};
 p.figures=(key==='flower'?[40,108]:key==='butterfly'?[74]:[27,74,121]).map((x,i)=>newFigure({...base,name:`${m.name} ${i+1}`,x,width:key==='butterfly'?52:key==='flower'?38:28,height:key==='city'?[38,49,33][i]:key==='butterfly'?44:33,depth:18,bridgeWidth:3}));
 return p;
}
