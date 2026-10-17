export const parameterRanges={mechanism:{radius:[5,22],rodLength:[45,100],eccentricRadius:[15,32],ground:[55,90],coupler:[40,85],rocker:[25,60]},material:{thickness:[2,6],dowel:[3,8],running:[0,1],glue:[-0.4,0.6],axial:[0.1,1],slide:[0.1,1]},figure:{width:[45,110],height:[45,110]},layout:{width:[200,1200],height:[200,900],gap:[2,20]}};
export const clone = value => JSON.parse(JSON.stringify(value));
export const motifs = {
  bird: {name:'Vogel', points:[[8,48],[26,40],[31,22],[43,36],[65,23],[87,39],[97,43],[87,50],[82,68],[65,82],[35,82],[21,70]],anchor:[52,68]},
  wave: {name:'Winkende Figur', points:[[38,94],[38,72],[30,72],[30,48],[18,38],[10,20],[18,14],[28,31],[39,37],[42,30],[37,22],[38,12],[44,5],[56,5],[62,12],[63,22],[58,30],[61,37],[72,31],[81,14],[90,20],[82,39],[70,48],[70,72],[62,72],[62,94],[53,94],[50,76],[47,94]],anchor:[50,58]},
  flower: {name:'Blume',points:[[36,22],[42,5],[58,5],[64,22],[82,16],[94,30],[83,46],[96,59],[89,77],[69,75],[63,94],[43,94],[36,77],[16,83],[5,65],[17,49],[6,35],[17,19]],anchor:[51,55]}
};
export function createProject(){ return {format:'automaten-studio',version:1,mechanism:{type:'slider',radius:12,rodLength:65,eccentricRadius:24,ground:70,coupler:55,rocker:38},material:{thickness:3,dowel:6,running:0.2,glue:0,axial:0.3,slide:0.3},figure:{motif:'bird',width:80,height:80,...clone(motifs.bird),color:'#cf8757'},layout:{width:600,height:400,gap:6}}; }
export function useMotif(project,key){ if(!Object.hasOwn(motifs,key))throw Error('Unbekanntes Motiv'); const result=clone(project); Object.assign(result.figure,clone(motifs[key]),{motif:key}); return result; }
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function inside(p,poly){ let yes=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j]; if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes; }
export function distanceSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy; const s=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/n)):0;return Math.hypot(p[0]-a[0]-s*dx,p[1]-a[1]-s*dy);}
function intersects(a,b,c,d){const eps=1e-8; const v=[cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)]; if(v[0]*v[1]<-eps&&v[2]*v[3]<-eps)return true; return (Math.abs(v[0])<eps&&distanceSegment(c,a,b)<eps)||(Math.abs(v[1])<eps&&distanceSegment(d,a,b)<eps)||(Math.abs(v[2])<eps&&distanceSegment(a,c,d)<eps)||(Math.abs(v[3])<eps&&distanceSegment(b,c,d)<eps);}
export function validateProject(input){ const errors=[]; let p; try{p=clone(input);}catch{return {valid:false,errors:['Projekt ist kein gültiges JSON-Objekt.']};} if(!p||typeof p!=='object'||Array.isArray(p))return {valid:false,errors:['Projektobjekt fehlt.']};
 if(p.format!=='automaten-studio'||p.version!==1)errors.push('Unbekanntes Projektformat oder Version.');
 const ranges=parameterRanges;
 const labels={radius:'Kurbelradius',rodLength:'Pleuellänge',eccentricRadius:'Exzenterradius',ground:'Lagerabstand',coupler:'Koppellänge',rocker:'Schwingenlänge',thickness:'Materialstärke',dowel:'Dübeldurchmesser',running:'Laufloch-Zugabe',glue:'Leimloch-Zugabe',axial:'Axialspiel',slide:'Führungsspiel',width:'Breite',height:'Höhe',gap:'Schnittabstand'};
 
 for(const [section,fields] of Object.entries(ranges)){if(!p[section]||typeof p[section]!=='object'){errors.push(`${section}: Angaben fehlen.`);continue;}for(const [key,[lo,hi]]of Object.entries(fields)){const n=p[section][key];if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)errors.push(`${labels[key]}: Zahl von ${lo} bis ${hi} erforderlich.`);}}
 if(!['slider','eccentric','lever'].includes(p.mechanism?.type))errors.push('Unbekannter Mechanismus.');
 const f=p.figure; if(!['bird','wave','flower','custom'].includes(f?.motif))errors.push('Unbekanntes Figurenmotiv.'); if(f?.name!==undefined&&(typeof f.name!=='string'||f.name.length>100||/[\u0000-\u001f]/.test(f.name)))errors.push('Figurenname: höchstens 100 druckbare Zeichen.'); const points=f?.points;const pointOK=q=>Array.isArray(q)&&q.length===2&&q.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100);
 if(!Array.isArray(points)||points.length<3||points.length>256||!points.every(pointOK))errors.push('Figur: 3 bis 256 Punkte im Bereich 0–100 erforderlich.');
 else {let area=0;for(let i=0;i<points.length;i++){let a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.1)errors.push('Figur enthält doppelte oder zu nahe Punkte.');for(let j=i+1;j<points.length;j++){if(j===i+1||(i===0&&j===points.length-1))continue;if(intersects(a,b,points[j],points[(j+1)%points.length]))errors.push('Figur schneidet oder berührt sich selbst.');}} if(Math.abs(area)<40)errors.push('Figurfläche ist zu klein.');
 if(pointOK(f.anchor)&&Number.isFinite(f.width)&&Number.isFinite(f.height)){const poly=points.map(q=>[q[0]*f.width/100,q[1]*f.height/100]),a=[f.anchor[0]*f.width/100,f.anchor[1]*f.height/100];if(!inside(a,poly)||poly.some((q,i)=>distanceSegment(a,q,poly[(i+1)%poly.length])<6))errors.push('Figuranker benötigt rundum mindestens 6 mm Material.');}}
 if(!pointOK(f?.anchor))errors.push('Figuranker fehlt oder liegt außerhalb 0–100.');
 if(typeof f?.color!=='string'||!/^#[\da-f]{6}$/i.test(f.color))errors.push('Ungültige Figurenfarbe.');
 return {valid:errors.length===0,errors:[...new Set(errors)],project:p}; }
