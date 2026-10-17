import {validateProject,clone,inside} from './project.mjs';
const TAU=Math.PI*2, rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
export const circle=(x,y,r,n=64)=>Array.from({length:n},(_,i)=>[x+r*Math.cos(i*TAU/n),y+r*Math.sin(i*TAU/n)]);
export const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function capsule(length,width){const r=width/2;return [...Array.from({length:25},(_,i)=>[length+r*Math.cos(-Math.PI/2+i*Math.PI/24),r*Math.sin(-Math.PI/2+i*Math.PI/24)]),...Array.from({length:25},(_,i)=>[r*Math.cos(Math.PI/2+i*Math.PI/24),r*Math.sin(Math.PI/2+i*Math.PI/24)])];}
export function partBounds(part){const pts=part.contours[0];const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys);return {x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};}
function fourbar(m,a){const c=[m.radius*Math.cos(a),m.radius*Math.sin(a)],d=[m.ground,0],dx=d[0]-c[0],dy=-c[1],dist=Math.hypot(dx,dy);if(dist===0)return null;const along=(m.coupler**2-m.rocker**2+dist**2)/(2*dist),hh=m.coupler**2-along**2;if(hh<=0)return null;const h=Math.sqrt(hh);return {c,b:[c[0]+along*dx/dist+h*dy/dist,c[1]+along*dy/dist-h*dx/dist],d};}
export function buildProject(input){const validation=validateProject(input),p=validation.project;const model={project:p,parts:[],valid:false,errors:[...validation.errors],warnings:[],checks:{kinematics:{status:'error',text:'Projekt prüfen.'},collision:{status:'warning',text:'Keine räumliche Kollisionsfreigabe.'}},metrics:{stroke:0,swing:0,parts:0},dowels:[],assembly:[]};if(!validation.valid)return model;
 const m=p.mechanism,t=p.material.thickness,a=p.material.axial,d=p.material.dowel,run=d+p.material.running,glue=d+p.material.glue;
 const add=(id,name,contours,layer,kind='mechanism',extra={})=>model.parts.push({id,name,contours,layer,kind,...extra});
 const disk=(id,name,r,holes,layer,extra={})=>add(id,name,[circle(0,0,r),...holes.map(h=>circle(...h))],layer,'mechanism',extra);
 const pin=(id,name,length,quantity=1,glued='Einseitig kleben; Lagerfläche bleibt leimfrei.')=>model.dowels.push({id,name,diameter:d,length:Math.ceil(length*10)/10,quantity,glue:glued});
 const fixed={}; const fix=(id,x,y,rotation=0)=>fixed[id]={id,x,y,rotation};
 // The broad backplate carries dowel bearings; two bottom tenons plug into horizontal feet.
 const boardTop=m.type==='slider'?-m.rodLength-m.radius-140:m.type==='eccentric'?-m.radius-170:-160;
 const board=[[-106,boardTop],[106,boardTop],[106,111],[67,111],[67,111+t],[47,111+t],[47,111],[-47,111],[-47,111+t],[-67,111+t],[-67,111],[-106,111]];
 const boardHoles=[circle(0,0,run/2)];if(m.type==='lever')boardHoles.push(circle(m.ground,0,glue/2));
 add('backplate','Rückwand mit zwei Fußzapfen',[board,...boardHoles],0,'frame');fix('backplate',0,0);
 for(const [id,x]of [['foot-left',-57],['foot-right',57]]){add(id,'Standfuß – liegend montieren',[rectangle(-43,-38,86,76),rectangle(-10,-(t+p.material.glue)/2,20,t+p.material.glue)],-1,'frame',{orientation:'horizontal'});fix(id,x,111,0);}
 disk('rear-crank','Handkurbel hinten',12,[[0,0,glue/2]],-2); // Extension carries the glued hand grip.
 model.parts[model.parts.length-1].contours=[capsule(32,24),circle(0,0,glue/2),circle(32,0,glue/2)];
 pin('drive-axle','Durchgehende Antriebswelle',5*t+2*a,1,'Handkurbel und vordere Kurbel/Exzenter fest mit der Welle verleimen; Rückwand bleibt frei.');
 pin('hand-grip','Handgriff hinten',30+t,1,'Nur in die Handkurbel kleben.');
 for(const [id,layer]of [['drive-collar-back',-1]])disk(id,'Antriebswelle: Stellring',10,[[0,0,glue/2]],layer);
 disk('bearing-cheek-front','Vordere Lagerwange – auf Rückwand leimen',18,[[0,0,run/2]],1);fix('bearing-cheek-front',0,0);
 if(m.type==='eccentric'){
  if(m.eccentricRadius-m.radius<glue/2+4)model.errors.push('Exzenterscheibe: mindestens 4 mm Steg zwischen Wellenloch und Rand nötig.');
  add('eccentric','Exzenterscheibe',[circle(m.radius,0,m.eccentricRadius),circle(0,0,glue/2)],2);
  const rx=m.eccentricRadius+m.radius+p.material.slide,ry=m.eccentricRadius+p.material.slide;
  const outer=[[-rx-10,-ry-10],[-7,-ry-10],[-7,-160],[7,-160],[7,-ry-10],[rx+10,-ry-10],[rx+10,ry+10],[-rx-10,ry+10]];
  add('yoke','Gefangene Exzenterkulisse',[outer,rectangle(-rx,-ry,rx*2,ry*2),circle(0,-150,glue/2)],2);
  model.metrics.stroke=2*m.radius;
 }else{
  if(m.radius<glue+3)model.errors.push('Kurbel: zwischen beiden Leimlöchern sind mindestens 3 mm Materialsteg nötig.');
  add('crank','Antriebskurbel',[capsule(m.radius,Math.max(18,d+10)),circle(0,0,glue/2),circle(m.radius,0,glue/2)],2);
  const length=m.type==='slider'?m.rodLength:m.coupler;
  add('coupler','Koppelstange',[capsule(length,Math.max(16,d+8)),circle(0,0,run/2),circle(length,0,run/2)],4);
  pin('crank-pin','Kurbelzapfen mit Gegenring',4*t+2*a);
  disk('crank-pin-collar','Gegenring Kurbelzapfen',d/2+4,[[0,0,glue/2]],5);
  if(m.type==='slider'){
   if(m.rodLength<=m.radius+10)model.errors.push('Pleuel muss mindestens 10 mm länger als der Kurbelradius sein.');
   add('slider','Schieber mit Figurenstiel',[rectangle(-7,-130,14,142),circle(0,0,glue/2),circle(0,-120,glue/2)],6);
   pin('slider-pin','Schieberzapfen mit Gegenring',4*t+2*a);
   disk('slider-pin-collar','Gegenring Schieberzapfen',d/2+4,[[0,0,glue/2]],3);
   model.metrics.stroke=2*m.radius;
  }else{
   const min=m.ground-m.radius,max=m.ground+m.radius;
   if(min<=Math.abs(m.coupler-m.rocker)+2||max>=m.coupler+m.rocker-2)model.errors.push('Viergelenk erreicht Totlage/ist nicht durchdrehbar: mindestens 2 mm Abstand zu beiden Dreiecksgrenzen nötig.');
   add('rocker','Schwinghebel',[capsule(m.rocker,Math.max(18,d+10)),circle(0,0,run/2),circle(m.rocker,0,glue/2)],6);
   pin('rocker-ground-pin','Fester Schwingenlagerzapfen',8*t+4*a);
   pin('rocker-coupler-pin','Durchgehender Koppel–Schwingen–Figuren-Zapfen',7*t+2*a,1,'Im Schwinghebel, beiden Figurenauflagen und in der Figur verkleben; Koppel frei, Gegenring nur auf Dübel kleben.');
   for(const [id,layer]of [['rocker-ground-collar',7],['rocker-coupler-collar',3]])disk(id,'Schwinge: Gegenring',d/2+4,[[0,0,glue/2]],layer);
   // Five plywood spacers keep the rocker at its own axial level without a screw.
   for(let i=1;i<=5;i++)disk(`rocker-spacer-${i}`,'Abstandsscheibe am festen Schwingenlager',d/2+5,[[0,0,glue/2]],i);
   const angles=[];for(let i=0;i<720;i++){const q=fourbar(m,i*TAU/720);if(q)angles.push(Math.atan2(q.b[1],q.b[0]-m.ground));}
   if(angles.length===720)model.metrics.swing=deg(Math.max(...angles)-Math.min(...angles));
  }
 }
 if(m.type!=='lever'){
  const channelLayer=m.type==='slider'?6:2,guideDepth=Math.ceil(((channelLayer+1)*t+(m.type==='slider'?3:1)*a)/t)+1;
  const lower=m.type==='slider'?-m.rodLength-m.radius-20:-m.radius-m.eccentricRadius-p.material.slide-21;
  const positions=[lower-32,lower];
  positions.forEach((y,j)=>{
   // Full-thickness spacer stacks give a real free channel; no imaginary fractional plywood layer.
   for(let side=-1;side<=1;side+=2)for(let k=1;k<guideDepth;k++){
    const id=`guide-${j}-${side}-${k}`;add(id,'Führung: Abstandsklotz',[rectangle(-5,-9,10,18)],k,'frame');fix(id,side*(12+p.material.slide),y);
   }
   const id=`guide-cap-${j}`;add(id,'Führung: Decksteg',[rectangle(-22-p.material.slide,-9,44+2*p.material.slide,18)],guideDepth,'frame');fix(id,0,y);
  });
  const stopLayer=m.type==='slider'?6:2;
  const stopPositions=m.type==='slider'?[-m.rodLength-m.radius-130-.5-3,-m.rodLength+m.radius+12+.5+3]:[-m.radius-160-.5-3,m.radius+m.eccentricRadius+p.material.slide+10+.5+3];
  stopPositions.forEach((y,j)=>{
   for(let k=1;k<stopLayer;k++)for(const side of [-1,1]){const id=`stop-support-${j}-${side}-${k}`;add(id,'Hubanschlag: verleimter Stützklotz',[rectangle(-5,-3,10,6)],k,'frame');fix(id,side*20,y);}
   for(let k=stopLayer;k<guideDepth;k++){const id=`stop-${j}-${k}`;add(id,j?'Unterer Hubanschlag':'Oberer Hubanschlag',[rectangle(-25,-3,50,6)],k,'frame');fix(id,0,y);}
  });
 }
 // Two broad glued pads transfer figure torque without relying on a single round pin.
 const figureBase=m.type==='eccentric'?2:6;
 for(let i=0;i<2;i++)disk(`figure-pad-${i}`,'Figur: Klebeauflage',6,[[0,0,glue/2]],figureBase+1+i);
 const figure=p.figure,fig=figure.points.map(q=>[(q[0]-figure.anchor[0])*figure.width/100,(q[1]-figure.anchor[1])*figure.height/100]);
 add('figure','Figur',[fig,circle(0,0,glue/2)],figureBase+3,'figure');
 if(m.type!=='lever')pin('figure-pin','Figur: verleimter Verbindungsstift',4*t,1,'Stiel/Schwinge, beide Auflagen und Figur flächig verleimen; hier kein Drehgelenk.');
 const couponOuter=rectangle(0,0,142,66),couponHoles=[];
 const offsets=[-.2,0,.2,.4,.6],runningSizes=offsets.map(v=>Math.round((d+p.material.running+v)*100)/100),glueSizes=offsets.map(v=>Math.round((d+p.material.glue+v)*100)/100);
 runningSizes.forEach((size,i)=>couponHoles.push(circle(13+i*25,15,size/2)));
 glueSizes.forEach((size,i)=>couponHoles.push(circle(13+i*25,48,size/2)));
 add('fit-coupon','Passprobe: oben Lauf '+runningSizes.join(' / ')+' mm; unten Leim '+glueSizes.join(' / ')+' mm',[couponOuter,...couponHoles],0,'coupon',{holeDiameters:[...runningSizes,...glueSizes],runningSizes,glueSizes});
 add('gap-gauge','Messhilfe 20 mm – keine 0,3-mm-Dickenlehre',[rectangle(0,0,50,18),rectangle(5,5,20,8)],0,'coupon');
 model.fixed=fixed;
 const hostZ=m.type==='eccentric'?2*t+a:6*t+3*a;
 for(const part of model.parts){part.z=part.layer*t;
  if(part.id==='rear-crank')part.z=-2*t-a;
  else if(part.id==='drive-collar-back')part.z=-t-a;
  else if(['crank','eccentric','yoke'].includes(part.id))part.z=2*t+a;
  else if(part.id==='coupler')part.z=4*t+2*a;
  else if(['slider','rocker'].includes(part.id))part.z=6*t+3*a;
  else if(part.id==='crank-pin-collar')part.z=5*t+3*a;
  else if(['slider-pin-collar','rocker-coupler-collar'].includes(part.id))part.z=3*t+a;
  else if(part.id==='rocker-ground-collar')part.z=7*t+4*a;
  else if(part.id==='figure-pad-0')part.z=hostZ+t;
  else if(part.id==='figure-pad-1')part.z=hostZ+2*t;
  else if(part.id==='figure')part.z=hostZ+3*t;
 }
 model.metrics.parts=model.parts.length;
 model.warnings.push('Passprobe mit derselben Platte und denselben Lasereinstellungen schneiden. Lochwerte sind fertige Sollmaße; Kerf-Kompensation erfolgt ausschließlich im Laserprogramm.');
 model.warnings.push('Axialspiel mit gemessenen temporären Papier-/Folienstreifen einstellen und diese nach dem Verleimen entfernen. Die ausgeschnittene Messhilfe prüft nur 20 mm Länge, keine Materialdicke.');
 model.warnings.push('Standfüße werden rechtwinklig zur Rückwand eingeleimt. Die 2D-Vorschau zeigt sie zur Zuordnung in der Plattenebene.');
 if(m.type==='eccentric')model.warnings.push('Exzenterscheibe gleitet in der Kulisse: Kanten fein schleifen, ggf. mit Wachs trocken schmieren. Kein reines Rollkontaktmodell.');
 model.checks.kinematics=model.errors.length?{status:'error',text:model.errors.join(' ')}:{status:'pass',text:m.type==='lever'?'Dreiecksgrenzen über den gesamten Kurbelumlauf geprüft; oberer Montagezweig.':'Hub und Eingriff analytisch für 360° geprüft.'};
 model.checks.collision={status:'warning',text:'Axiale Ebenen und Führungsspiel sind konstruiert; keine vollständige 3D-Kollisionsprüfung. Figur, Leimstellen und Stand im Handversuch über 360° prüfen.'};
 model.assembly=[
  '1. Passprobe schneiden. Leimloch muss den Dübel ohne Aufplatzen fest halten, Laufloch muss frei drehen. Materialdicke und Dübel messen; Projektwerte danach anpassen und alle Teile neu exportieren.',
  `2. Zwei liegende Standfüße mit den 20-mm-Zapfen der Rückwand verbinden und rechtwinklig verleimen. Die Rückwand steht senkrecht; Füße zeigen nach vorn und hinten. Klebeflächen trocknen lassen.`,
  `3. Axiale Ebenen: Rückwand 0, vordere Kurbel 2, Koppel 4, Schieber/Schwinge 6, Figurenauflagen 7/8, Figur 9; Geklebte Abstandsklötze liegen ohne Spalt aufeinander. Bewegte Kurbel beginnt bei 2 × Dicke + Axialspiel, Koppel bei 4 × Dicke + 2 × Axialspiel, Schieber/Schwinge bei 6 × Dicke + 3 × Axialspiel. Figurenauflagen und Figur werden ohne Spalt aufeinandergeklebt. Beim Exzenter liegen Scheibe und Kulisse beide in Ebene 2, die Figurenauflagen in 3/4 und die Figur in 5. Die Handkurbel beginnt hinten bei −2 × Dicke − Axialspiel. Die vordere zweite Lagerwange liegt direkt auf der Rückwand. Der hintere Stellring hält ein Axialspiel Abstand zur Rückwand; die vordere Kurbel hält ein Axialspiel Abstand zur vorderen Wange.`,
  `4. Antriebswelle durch das Laufloch der Rückwand stecken. Zuerst vordere Lagerwange flächig auf die Rückwand kleben (Laufbohrungen fluchten lassen). Handkurbel, vordere Kurbel/Exzenter und hinteren Stellring fest auf die Welle kleben. Zwischen hinterem Ring und Rückwand sowie zwischen vorderer Wange und Kurbel ${a} mm freies Spiel mit gemessener, entfernbarer Papier-/Folienlehre einstellen. Keinen Leim in die Rückwandlagerung bringen. Handgriff hinten einkleben.`,
  m.type==='lever'?`5. Festen Schwingenlagerzapfen in die Rückwand kleben, fünf Abstandsscheiben aufkleben. Schwinge frei aufsetzen und äußeren Ring nur auf den Dübel kleben. Koppel am Kurbelzapfen und Schwingenzapfen frei lagern; Zapfen jeweils nur im tragenden Teil einkleben. Viergelenk im oberen Montagezweig aufbauen (Figur oberhalb des Lagers).`:`5. Führungsklötze für beide seitlichen Schieberführungen lagenweise auf die Rückwand kleben, Deckstege zunächst nur lose zuordnen und erst nach dem Einlegen des bewegten Teils aufkleben. Der ${m.type==='slider'?'Schieber':'Kulissenstiel'} liegt frei im Kanal. Die oberen und unteren Anschlagbrücken samt Stützklötzen lagenweise verleimen. Sie begrenzen Überhub mit 0,5 mm Abstand zum berechneten Normalhub und halten den Stiel in beiden Führungen.`,
  m.type==='slider'?`6. Kurbelzapfen in die Kurbel, Schieberzapfen in den Schieber kleben. Koppel dazwischen frei aufsetzen. Gegenringe nur auf die Zapfen kleben; erst danach Führungsdeckstege schließen. Je Lager ${a} mm axialen Freigang einstellen.`:m.type==='eccentric'?`6. Kulisse zuerst um die Exzenterscheibe legen, danach den zweiten Führungsdecksteg schließen. Der Schlitz umschließt die Scheibe oben und unten mit ${p.material.slide} mm Spiel. Kulisse bleibt unverleimt beweglich.`:`6. Koppel und Schwinge dürfen sich nur an ihren gemeinsamen Lagern überdecken. Gegenringe auf die Zapfen kleben, Lagerflächen leimfrei halten; überall ${a} mm axialen Freigang lassen.`,
  '7. Figurenstift (beim Viergelenk derselbe durchgehende Koppel–Schwingen-Zapfen), beide Klebeauflagen und Figur flächig auf dem Stiel bzw. Schwingenende verleimen. Bei der Schwinge dreht die Figur mit dem Hebel. Kleber vollständig aushärten lassen.',
  '8. Temporäre Lehren entfernen. Langsam per Hand eine volle Umdrehung durchfahren; Lager, Führungen, Figur, Kanten und Stand prüfen. Bei Klemmen stoppen, Spiel nacharbeiten; erst nach erfolgreicher Handprobe verwenden. Der Rechner bestätigt keine fertige Maschine.'
 ];
 model.valid=model.errors.length===0;
 if(model.valid){
  const collisions=sampleGuideCollisions(model);
  model.checks.collision={status:collisions.length?'error':'warning',text:collisions.length?`Materialkollision in 2°-Stichprobe: ${collisions.join(', ')}.`:'180 Stellungen (2°) gegen Schnittteile und Dübel mit überlappender realer Z-Höhe geprüft: kein Materialüberschnitt. Axiale Ebenen und Exzentereingriff konstruiert. Keine vollständige 3D- oder Dauerversuchsfreigabe; Handprobe über 360° erforderlich.'};
  if(collisions.length){model.errors.push(model.checks.collision.text);model.valid=false;}
 }
 return model;
}
export function poseProject(model,angleDegrees){if(!model?.project||!model.valid)return {entries:[],joints:[],bounds:{x:-120,y:-210,width:280,height:360}};const p=model.project,m=p.mechanism,a=rad(Number.isFinite(angleDegrees)?angleDegrees:0),c=[m.radius*Math.cos(a),m.radius*Math.sin(a)];const entries=Object.values(model.fixed||{}).map(clone),joints=[[0,0],c]; const put=(id,x,y,rotation=0)=>{if(model.parts.some(q=>q.id===id))entries.push({id,x,y,rotation});};
 for(const id of ['rear-crank','drive-collar-back'])put(id,0,0,deg(a));let anchor,rotation=0;
 if(m.type==='eccentric'){put('eccentric',0,0,deg(a));put('yoke',0,c[1]);joints.push([0,c[1]]);anchor=[0,c[1]-150];}
 else {put('crank',0,0,deg(a));put('crank-pin-collar',...c);let b;
  if(m.type==='slider'){b=[0,c[1]-Math.sqrt(m.rodLength**2-c[0]**2)];put('slider',...b);put('slider-pin-collar',...b);anchor=[0,b[1]-120];}
  else{const q=fourbar(m,a);if(!q)return {entries:[],joints:[],bounds:{x:-120,y:-210,width:280,height:360}};b=q.b;const r=deg(Math.atan2(b[1],b[0]-m.ground));put('rocker',m.ground,0,r);put('rocker-ground-collar',m.ground,0);put('rocker-coupler-collar',...b);for(let i=1;i<=5;i++)put(`rocker-spacer-${i}`,m.ground,0);anchor=b;rotation=r+90;}
  put('coupler',...c,deg(Math.atan2(b[1]-c[1],b[0]-c[0])));joints.push(b);if(m.type==='lever')joints.push([m.ground,0]);
 }
 for(const id of ['figure-pad-0','figure-pad-1','figure'])put(id,...anchor,rotation);
 const points=[];for(const entry of entries){const q=model.parts.find(v=>v.id===entry.id),r=rad(entry.rotation);for(const [x,y]of q.contours[0])points.push([entry.x+x*Math.cos(r)-y*Math.sin(r),entry.y+x*Math.sin(r)+y*Math.cos(r)]);}
 const xs=points.map(q=>q[0]),ys=points.map(q=>q[1]),x=Math.min(...xs)-10,y=Math.min(...ys)-10;return {entries,joints,bounds:{x,y,width:Math.max(...xs)-x+10,height:Math.max(...ys)-y+10}};
}

function transformed(part,e){const r=rad(e.rotation);return part.contours.map(c=>c.map(([x,y])=>[e.x+x*Math.cos(r)-y*Math.sin(r),e.y+x*Math.sin(r)+y*Math.cos(r)]));}
function materialContains(q,contours){return inside(q,contours[0])&&!contours.slice(1).some(c=>inside(q,c));}
function materialOverlap(a,b){
 const bounds=c=>{const xs=c[0].map(q=>q[0]),ys=c[0].map(q=>q[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];};
 const aa=bounds(a),bb=bounds(b);if(aa[2]<=bb[0]+1e-6||bb[2]<=aa[0]+1e-6||aa[3]<=bb[1]+1e-6||bb[3]<=aa[1]+1e-6)return false;
 if(a[0].some(q=>materialContains(q,b))||b[0].some(q=>materialContains(q,a)))return true;
 const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 for(const ac of a)for(const bc of b)for(let i=0;i<ac.length;i++)for(let j=0;j<bc.length;j++){const p=ac[i],q=ac[(i+1)%ac.length],r=bc[j],s=bc[(j+1)%bc.length];if(cross(p,q,r)*cross(p,q,s)<-1e-8&&cross(r,s,p)*cross(r,s,q)<-1e-8)return true;}
 return false;
}
function sampleGuideCollisions(model){
 const found=new Set(),t=model.project.material.thickness,d=model.project.material.dowel,a=model.project.material.axial,m=model.project.mechanism;
 for(let angle=0;angle<360;angle+=2){const pose=poseProject(model,angle),items=pose.entries.filter(e=>{const p=model.parts.find(p=>p.id===e.id);return p.orientation!=='horizontal';}).map(e=>{const p=model.parts.find(p=>p.id===e.id);return {id:p.id,name:p.name,z:p.z,contours:transformed(p,e),static:Boolean(model.fixed[p.id])};});
  const pin=(id,name,at,z,length,mates)=>items.push({id,name,z,depth:length,contours:[circle(...at,d/2,24)],mates:new Set(mates),static:false});
  pin('drive-axle','Antriebswelle',[0,0],-2*t-a,5*t+2*a,['rear-crank','drive-collar-back','backplate','bearing-cheek-front','crank','eccentric']);
  if(m.type!=='eccentric')pin('crank-pin','Kurbelzapfen',pose.joints[1],2*t+a,4*t+2*a,['crank','coupler','crank-pin-collar']);
  if(m.type==='slider')pin('slider-pin','Schieberzapfen',pose.joints[2],3*t+a,4*t+2*a,['slider','coupler','slider-pin-collar']);
  if(m.type==='lever'){
   pin('rocker-ground-pin','Fester Schwingenlagerzapfen',[m.ground,0],0,8*t+4*a,['backplate','rocker','rocker-ground-collar',...Array.from({length:5},(_,i)=>`rocker-spacer-${i+1}`)]);
   pin('rocker-coupler-pin','Koppel–Schwingen–Figuren-Zapfen',pose.joints[2],3*t+a,7*t+2*a,['coupler','rocker','rocker-coupler-collar','figure-pad-0','figure-pad-1','figure']);
  }else{
   const entry=pose.entries.find(p=>p.id==='figure');const z=m.type==='slider'?6*t+3*a:2*t+a;
   pin('figure-pin','Figurenstift',[entry.x,entry.y],z,4*t,[m.type==='slider'?'slider':'yoke','figure-pad-0','figure-pad-1','figure']);
  }
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
   const x=items[i],y=items[j];if(x.static&&y.static||x.mates?.has(y.id)||y.mates?.has(x.id))continue;
   if(x.z+(x.depth??t)<=y.z+1e-6||y.z+(y.depth??t)<=x.z+1e-6)continue;
   if(materialOverlap(x.contours,y.contours))found.add(`${x.name} / ${y.name}`);
  }
 }
 return [...found];
}
