import {validateProject} from './project.mjs';
import polygon from './vendor/polygon-clipping.mjs';
import {compileStructure,structurePoint} from './kirigami.mjs';
import {compileDrawing} from './drawing.mjs';
import {compileSurfaces} from './surface.mjs';
export const coordinateConvention='Millimeter. x entlang des Rückens, t=SVG-y minus Kartenhälfte. 0° geschlossen, 90° aufgestellt, 180° identisch zum flachen Schnittbogen. Alle Teile stammen aus einem Blatt.';
const EPS=1e-7, MARGIN=2;
const num=n=>+n.toFixed(7);
const close=r=>r.length&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])>EPS?[...r,r[0]]:r;
const open=r=>r.length>1&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<EPS?r.slice(0,-1):r;
const rectangle=(x0,y0,x1,y1)=>[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]];
const path=(r,closed=true)=>r.length?`M${r.map(p=>p.map(num).join(' ')).join('L')}${closed?'Z':''}`:'';
const rings=multi=>multi.flat().map(open);
const ringArea=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
const area=multi=>multi.reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((a,r)=>a+ringArea(r),0),0);
const union=(...items)=>items.length?polygon.union(...items):[];
const diff=(a,b)=>a.length&&b.length?polygon.difference(a,b):a;
const intersection=(a,b)=>a.length&&b.length?polygon.intersection(a,b):[];
const bbox=multi=>{const q=multi.flat(2);return {minX:Math.min(...q.map(p=>p[0])),maxX:Math.max(...q.map(p=>p[0])),minY:Math.min(...q.map(p=>p[1])),maxY:Math.max(...q.map(p=>p[1]))};};
export function triangulateContours(rings){const ys=[...new Set(rings.flat().map(p=>p[1]))].sort((a,b)=>a-b),tri=[];for(let j=1;j<ys.length;j++){const y0=ys[j-1],y1=ys[j],ym=(y0+y1)/2;if(y1-y0<EPS)continue;const edges=[];for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if((a[1]<ym&&b[1]>ym)||(b[1]<ym&&a[1]>ym)){const at=y=>a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]);edges.push({at,x:at(ym)});}}edges.sort((a,b)=>a.x-b.x);for(let i=0;i+1<edges.length;i+=2){const l=edges[i],r=edges[i+1],a=[l.at(y0),y0],b=[r.at(y0),y0],c=[r.at(y1),y1],d=[l.at(y1),y1];if(Math.abs(area2(a,b,c))>EPS)tri.push([a,b,c]);if(Math.abs(area2(a,c,d))>EPS)tri.push([a,c,d]);if(tri.length>12000)throw new Error('Ressourcenlimit: Eine Kontur erzeugt mehr als 12.000 Dreiecke. Bitte das Motiv vereinfachen.');}}return tri;}
const area2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function insideRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function hasContourIntersections(rings){const edges=[];for(let ring=0;ring<rings.length;ring++){const points=rings[ring].filter((p,i,a)=>i===0||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>=1e-10);if(points.length>1&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-10)points.pop();for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-10)continue;edges.push({a,b,ring,index:i,count:points.length,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])});}}edges.sort((a,b)=>a.minX-b.minX);
 const on=(p,a,b)=>Math.abs(area2(a,b,p))<1e-10&&p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10;
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(b.minX>a.maxX+1e-10)break;if(a.maxY<b.minY-1e-10||b.maxY<a.minY-1e-10)continue;if(a.ring===b.ring&&(Math.abs(a.index-b.index)===1||Math.abs(a.index-b.index)===a.count-1)){if(Math.abs(area2(a.a,a.b,b.a))<1e-10&&Math.abs(area2(a.a,a.b,b.b))<1e-10){const axis=Math.abs(a.a[0]-a.b[0])>=Math.abs(a.a[1]-a.b[1])?0:1;if(Math.min(Math.max(a.a[axis],a.b[axis]),Math.max(b.a[axis],b.b[axis]))-Math.max(Math.min(a.a[axis],a.b[axis]),Math.min(b.a[axis],b.b[axis]))>1e-10)return true;}continue;}
 if(on(a.a,b.a,b.b)||on(a.b,b.a,b.b)||on(b.a,a.a,a.b)||on(b.b,a.a,a.b)||area2(a.a,a.b,b.a)*area2(a.a,a.b,b.b)<0&&area2(b.a,b.b,a.a)*area2(b.a,b.b,a.b)<0)return true;
 }return false;}
function materialContours(input){
 const source=input.map(open),depth=source.map((r,i)=>source.reduce((n,s,j)=>n+(i!==j&&insideRing(r[0],s)?1:0),0));
 return source.flatMap((r,i)=>depth[i]%2?[]:[[close(r),...source.filter((h,j)=>depth[j]===depth[i]+1&&insideRing(h[0],r)).map(close)]]);
}
function inside(p,multi){return multi.some(poly=>insideRing(p,poly[0])&&!poly.slice(1).some(r=>insideRing(p,r)));}
function clipEngraving(line,front){const result=[];for(let i=1;i<line.length;i++){
 const a=line[i-1],b=line[i],u=[b[0]-a[0],b[1]-a[1]],ts=[0,1];
 for(const ring of rings(front))for(let j=0;j<ring.length;j++){
  const c=ring[j],d=ring[(j+1)%ring.length],v=[d[0]-c[0],d[1]-c[1]],den=u[0]*v[1]-u[1]*v[0];if(Math.abs(den)<EPS)continue;
  const w=[c[0]-a[0],c[1]-a[1]],t=(w[0]*v[1]-w[1]*v[0])/den,s=(w[0]*u[1]-w[1]*u[0])/den;if(t>EPS&&t<1-EPS&&s>=-EPS&&s<=1+EPS)ts.push(t);
 }ts.sort((a,b)=>a-b);for(let j=1;j<ts.length;j++){const lo=ts[j-1],hi=ts[j];if(hi-lo<EPS)continue;const at=t=>[a[0]+u[0]*t,a[1]+u[1]*t];if(inside(at((lo+hi)/2),front))result.push([at(lo),at(hi)]);}
 }return result;}
function spineSegments(extracted,width){
 const edges=rings(extracted).flatMap(r=>r.map((a,i)=>[a,r[(i+1)%r.length]])),xs=[0,width];
 for(const [a,b] of edges){
  if(Math.abs(a[1])<EPS&&Math.abs(b[1])<EPS){xs.push(a[0],b[0]);continue;}
  if(Math.min(a[1],b[1])<=0&&Math.max(a[1],b[1])>=0&&Math.abs(a[1]-b[1])>EPS)xs.push(a[0]+(b[0]-a[0])*(-a[1])/(b[1]-a[1]));
 }
 const ordered=[...new Set(xs.map(x=>Math.max(0,Math.min(width,x))))].sort((a,b)=>a-b),segments=[];
 for(let i=1;i<ordered.length;i++){const left=ordered[i-1],right=ordered[i];if(right-left<EPS)continue;const mid=[(left+right)/2,0];
  // A fold needs paper on both sides; the boundary of a cutout is excluded too.
  if(!inside(mid,extracted)&&!edges.some(([a,b])=>onSegment(mid,a,b)))segments.push([[left,0],[right,0]]);
 }
 return segments;
}
const cache=new Map();
const surfaceCache=new Map();
function surfaceGeometry(p){const key=JSON.stringify({card:p.card,surface:p.surface});if(surfaceCache.has(key))return surfaceCache.get(key);const result=compileSurfaces(p,triangulateContours);while(surfaceCache.size>=4)surfaceCache.delete(surfaceCache.keys().next().value);surfaceCache.set(key,result);return result;}
function poseSurfaces(p,angle){
 const opening=Math.max(0,Math.min(180,angle)),theta=opening*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta),g=surfaceGeometry(p);
 const panels=[panel('card-fixed','card','#eee8db',g.material.fixed,g.fixedTriangles,([x,t])=>[x,t,0]),panel('card-moving','card','#f6f0e5',g.material.moving,g.movingTriangles,([x,t])=>[x,-t*cos,-t*sin])];
 for(const face of g.panels){const map=face.kind==='front'?([x,t])=>[x,face.D+(face.D-t)*cos,(face.D-t)*sin]:([x,t])=>[x,face.Z*cos+t+face.Z,face.Z*sin];panels.push(panel(face.id,face.requested?'figure':'carrier',face.color,face.source,face.triangles,map,{surfaceId:face.surfaceId,kind:face.kind}));}
 return {panels,angle:opening,coordinateConvention,errors:g.errors,warnings:g.warnings};
}
function buildSurfaces(p){
 const surface=surfaceGeometry(p),part={id:'card',label:'Einblatt-Karte aus räumlichen Flächen',role:'card',width:p.card.width,height:2*p.card.half,placement:{x:p.layout.gap,y:p.layout.gap},paths:surface.paths},errors=[...surface.errors];
 if(part.width+2*p.layout.gap>p.layout.width+EPS||part.height+2*p.layout.gap>p.layout.height+EPS)errors.push({message:'Kartenrohling: Passt nicht auf den eingestellten Materialbogen.'});
 return {project:p,parts:[part],figures:[],structures:[],surface,material:surface.material,errors,warnings:surface.warnings,coordinateConvention,assemblySteps:['Den Kartenrand und die roten Schnittlinien schneiden. Die automatisch ergänzten Papierstege bleiben Teil des Blattes.','Abgetrennte Schnittabfälle und Fenster entfernen. An den Falzlinien bleibt das Papier verbunden.','Grüne Talfalten und blaue Bergfalten vorsichtig vorformen. Die Rückenfalte nur an den eingezeichneten Abschnitten falzen.','Flächen und Stützen nach innen führen und die Karte bis 90° aufstellen. Sie benötigt keine aufgeklebten Bauteile.','Vollständiges Schließen, Papierfestigkeit und wiederholtes Öffnen mit einem Papierprototyp prüfen.']};
}
function compile(p){const key=JSON.stringify(p);if(cache.has(key))return cache.get(key);
 const errors=[],warnings=[{message:'Die Geometrie nimmt Papier ohne Materialstärke an. Papierfestigkeit, enge Falze und Schnittbreite mit einem Probeschnitt prüfen.'}],figures=[],structures=[],W=p.card.width,H=p.card.half,blank=[rectangle(0,-H,W,H)],fail=(f,message)=>errors.push({...(!f?{}:p.structures.includes(f)?{structureId:f.id}:{figureId:f.id}),message:f?`${f.name}: ${message}`:message});
 for(const f of p.figures){
  if(hasContourIntersections(f.contours)){fail(f,'Konturen überkreuzen oder berühren sich. Im Motiveditor mit Vereinen/Abziehen bereinigen; Schnittdatei bleibt gesperrt.');continue;}
  if(f.contours.some(r=>ringArea(r)<EPS)){fail(f,'Eine Schnittkontur hat keine Materialfläche.');continue;}
  const a=f.height,b=f.depth,c=b-a,x0=f.x+f.bridgeOffset-f.bridgeWidth/2,x1=x0+f.bridgeWidth;
  const map=([u,v])=>[f.x+(Math.max(0,Math.min(1,u))-.5)*f.width,c+Math.max(0,Math.min(1,v))*a],source=materialContours(f.contours.map(r=>r.map(map))),band=[rectangle(x0,c,x1,b)],front=union(source,band),roof=[rectangle(x0,-a,x1,c)];
  // Fill front holes in the extraction footprint: their contents are waste, never floating card islands.
  const footprint=union(front.map(poly=>[poly[0]]),roof),window=bbox(footprint),anchors={back:[[x0,-a],[x1,-a]],ridge:[[x0,c],[x1,c]],foot:[[x0,b],[x1,b]]};
  if(front.length!==1)fail(f,'Eine Materialinsel ist nicht über einen flächigen Steg mit der Karte verbunden. Steg verschieben/verbreitern oder Konturen verbinden.');
  if(f.bridgeWidth<1)fail(f,'Der durchgehende Materialsteg muss mindestens 1 mm breit sein.');else if(f.bridgeWidth<2)warnings.push({figureId:f.id,message:`${f.name}: Materialsteg unter 2 mm; Papierfestigkeit am Probeschnitt prüfen.`});
  if(window.minX<MARGIN-EPS||window.maxX>W-MARGIN+EPS||window.minY< -H+MARGIN-EPS||window.maxY>H-MARGIN+EPS)fail(f,'Motiv und Scharniere benötigen mindestens 2 mm Abstand zum Kartenrand.');
  if(a+b>H+EPS)fail(f,'Höhe und Tiefe zusammen ragen im geschlossenen Zustand aus der Karte.');
  const filledHoles=source.flatMap(poly=>poly.slice(1).map(r=>[r]));if(filledHoles.length&&area(intersection(filledHoles,band))>EPS)warnings.push({figureId:f.id,message:`${f.name}: Der durchgehende Materialsteg füllt einen Teil der Motivlöcher; die Vorschau zeigt das verbleibende Material.`});
  const sourceArea=area(source),waste=diff(footprint,union(front,roof)),engraving=(f.engravings||[]).flatMap(line=>clipEngraving(line.map(map),front));
  figures.push({figureId:f.id,figure:f,front,roof,footprint,anchors,window,sourceArea,waste,wasteArea:area(waste),engravings:engraving,a,b,c});
 }
 for(const s of p.structures){
  const compiled=compileStructure(s),w=compiled.window;
  for(const message of compiled.errors||[])fail(s,message);
  for(const warning of compiled.warnings||[])warnings.push({structureId:s.id,message:`${s.name}: ${warning.message}`});
  if(w.minX<MARGIN-EPS||w.maxX>W-MARGIN+EPS||w.minY< -H+MARGIN-EPS||w.maxY>H-MARGIN+EPS)fail(s,'Kirigami-Band und Scharniere benötigen mindestens 2 mm Abstand zum Kartenrand.');
  if(compiled.A+compiled.B>H+EPS)fail(s,'Gesamthöhe und Gesamttiefe zusammen ragen im geschlossenen Zustand aus der Karte.');
  if(s.width<3)warnings.push({structureId:s.id,message:`${s.name}: Bandbreite unter 3 mm; Papierfestigkeit am Probeschnitt prüfen.`});
  structures.push(compiled);
 }
 const regions=[...figures,...structures];
 for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){const a=regions[i].window,b=regions[j].window;if(a.minX<b.maxX+MARGIN-EPS&&a.maxX>b.minX-MARGIN+EPS&&a.minY<b.maxY+MARGIN-EPS&&a.maxY>b.minY-MARGIN+EPS)fail(regions[j].figure||regions[j].structure,'Schnittbereiche verschiedener Motive und Kirigami-Bänder benötigen mindestens 2 mm Abstand.');}
 const extracted=regions.length?union(...regions.map(f=>f.footprint)):[],base=diff(blank,extracted),frontArea=figures.reduce((s,f)=>s+area(f.front),0)+structures.reduce((n,s)=>n+s.panels.filter(p=>p.kind==='front').reduce((a,p)=>a+area(p.source),0),0),roofArea=figures.reduce((s,f)=>s+area(f.roof),0)+structures.reduce((n,s)=>n+s.panels.filter(p=>p.kind==='roof').reduce((a,p)=>a+area(p.source),0),0),waste=figures.flatMap(f=>f.waste);
 if(base.length!==1)fail(null,'Die Ausschnitte trennen eine Materialinsel vom Kartenrohling. Motive weiter auseinander und vom Rand weg platzieren.');
 const fixed=intersection(base,[rectangle(0,0,W,H)]),moving=intersection(base,[rectangle(0,-H,W,0)]);
 const result={figures,structures,errors,warnings,material:{base,fixed,moving,extracted,waste,areas:{blank:W*2*H,base:area(base),front:frontArea,roof:roofArea,waste:area(waste)}}};
 for(const f of figures){f.frontTriangles=triangulateContours(rings(f.front));f.roofTriangles=triangulateContours(rings(f.roof));}
 for(const s of structures)for(const panel of s.panels)panel.triangles=triangulateContours(rings(panel.source));
 if(structures.reduce((n,s)=>n+(s.faceCount||s.panels.length),0)>1200)fail(null,'Ressourcenlimit: maximal 1200 einzelne Kirigami-Faltflächen im Projekt.');
 result.fixedTriangles=triangulateContours(rings(fixed));result.movingTriangles=triangulateContours(rings(moving));
 if([...figures.flatMap(f=>[...f.frontTriangles,...f.roofTriangles]),...structures.flatMap(s=>s.panels.flatMap(p=>p.triangles)),...result.fixedTriangles,...result.movingTriangles].length>60000)throw new Error('Ressourcenlimit: maximal 60.000 Materialdreiecke. Motive vereinfachen.');
 while(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
function panel(id,role,color,source,sourceTriangles,map,extra={}){const sourcePolygons=rings(source),polygons=sourcePolygons.map(r=>r.map(map));return {id,role,color,sourcePolygons,sourceTriangles,polygons,vertices:polygons.flat(),triangles:sourceTriangles.map(t=>t.map(map)),...extra};}
// At 0<θ<180, y−z·cot(θ/2)=t on every patch: disjoint source material cannot intersect.
export function poseProject(project,angle=90){const p=validateProject(project);if(!Number.isFinite(angle))throw new Error('Öffnungswinkel ist ungültig.');if(p.surface?.active)return poseSurfaces(p,angle);if(p.drawing?.active)return{...compileDrawing(p,triangulateContours).pose(angle),coordinateConvention:'Freie Zeichnung: Millimeter, x entlang des Kartenrückens, y um die Kartenhälfte verschoben. 0% flach, 100% eingestellte Faltwinkel.'};const opening=Math.max(0,Math.min(180,angle)),theta=opening*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta),g=compile(p);
 const panels=[panel('card-fixed','card','#eee8db',g.material.fixed,g.fixedTriangles,([x,t])=>[x,t,0]),panel('card-moving','card','#f6f0e5',g.material.moving,g.movingTriangles,([x,t])=>[x,-t*cos,-t*sin])];
 for(const f of g.figures){panels.push(panel(`${f.figureId}-front`,'figure',f.figure.color,f.front,f.frontTriangles,([x,t])=>[x,f.b+(f.b-t)*cos,(f.b-t)*sin],{figureId:f.figureId}));panels.push(panel(`${f.figureId}-roof`,'carrier','#d7bb8b',f.roof,f.roofTriangles,([x,t])=>[x,f.a*cos+t+f.a,f.a*sin],{figureId:f.figureId}));}
 for(const s of g.structures)for(const [i,face]of s.panels.entries())panels.push(panel(`${s.structureId}-${i}`,face.kind==='front'?'figure':'carrier',s.structure.color,face.source,face.triangles,q=>structurePoint(face,q,cos,sin),{structureId:s.structureId,kind:face.kind}));
 return {panels,coordinateConvention,angle:opening,errors:g.errors,warnings:g.warnings};
}
function onSegment(p,a,b){return Math.abs(area2(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
function cutsExceptHinges(poly,hinges){const output=[];for(const ring of rings(poly))for(let i=0;i<ring.length;i++){
 const a=ring[i],b=ring[(i+1)%ring.length],ts=[0,1],u=[b[0]-a[0],b[1]-a[1]],axis=Math.abs(u[0])>=Math.abs(u[1])?0:1;
 for(const hinge of hinges)if(Math.abs(area2(a,b,hinge[0]))<EPS&&Math.abs(area2(a,b,hinge[1]))<EPS)for(const q of hinge){const t=(q[axis]-a[axis])/u[axis];if(t>EPS&&t<1-EPS)ts.push(t);}
 ts.sort((a,b)=>a-b);for(let j=1;j<ts.length;j++){const lo=ts[j-1],hi=ts[j];if(hi-lo<EPS)continue;const at=t=>a.map((v,k)=>v+u[k]*t),mid=at((lo+hi)/2);if(!hinges.some(([a,b])=>onSegment(mid,a,b)))output.push([at(lo),at(hi)]);}
 }return output;}
export function buildProject(project){const p=validateProject(project);if(p.surface?.active)return buildSurfaces(p);if(p.drawing?.active){const drawing=compileDrawing(p,triangulateContours),part={id:'card',label:'Freier Einblatt-Kartenrohling',role:'card',width:p.card.width,height:2*p.card.half,placement:{x:p.layout.gap,y:p.layout.gap},paths:drawing.paths},errors=[...drawing.errors];if(part.width+2*p.layout.gap>p.layout.width+EPS||part.height+2*p.layout.gap>p.layout.height+EPS)errors.push({message:'Kartenrohling: Passt nicht auf den eingestellten Materialbogen.'});return{project:p,parts:[part],figures:[],structures:[],drawing,material:drawing.material,errors,warnings:drawing.warnings,coordinateConvention:'Freie Schnitt- und Falzlinien direkt auf der Karte in Millimetern.',assemblySteps:['Den Kartenrand und die roten Schnittlinien schneiden. An Falzlinien bleibt das Papier verbunden.','Vollständig abgetrennte Schnittabfälle entfernen; alle dargestellten Faltflächen bleiben über ihre Scharniere verbunden.','Grüne Talfalten und blaue Bergfalten in der eingezeichneten Richtung vorfalzen.','Die freie Vorschau zeigt 0% flach bis 100% der eingestellten Faltwinkel. Automatisches Schließen ist damit nicht nachgewiesen.','Papierdicke, Kollisionen und Faltbarkeit mit einem Papiermodell prüfen.']};}const g=compile(p),paths=[],toSVG=points=>points.map(([x,t])=>[x,t+p.card.half]),add=(points,operation,figureId,closed=false,structureId)=>paths.push({d:path(toSVG(points),closed),operation,...(figureId?{figureId}:{}),...(structureId?{structureId}:{})});
 add([[0,-p.card.half],[p.card.width,-p.card.half],[p.card.width,p.card.half],[0,p.card.half]],'CUT',undefined,true);
 // The main crease only crosses retained base material, including all discarded-hole gaps.
 for(const segment of spineSegments(g.material.extracted,p.card.width))add(segment,'FOLD_VALLEY');
 const seen=new Set();for(const f of g.figures){const retained=union(f.front,f.roof);for(const poly of retained)for(const hole of poly.slice(1))add(open(hole),'CUT',f.figureId,true);for(const cut of cutsExceptHinges(retained.map(poly=>[poly[0]]),[f.anchors.back,f.anchors.foot])){const q=cut.map(p=>p.map(num)),key=q.map(p=>p.join(',')).sort().join(':');if(!seen.has(key)){seen.add(key);add(cut,'CUT',f.figureId);}}
  add(f.anchors.back,'FOLD_VALLEY',f.figureId);add(f.anchors.ridge,'FOLD_MOUNTAIN',f.figureId);add(f.anchors.foot,'FOLD_VALLEY',f.figureId);for(const line of f.engravings)add(line,'ENGRAVE',f.figureId);
 }
 for(const s of g.structures){
  if(s.cuts){for(const points of s.cuts)add(points,'CUT',undefined,false,s.structureId);for(const fold of s.folds)add(fold.points,fold.operation,undefined,false,s.structureId);continue;}
  const {minX:x0,maxX:x1,minY:t0,maxY:t1}=s.window;
  add([[x0,t0],[x0,t1]],'CUT',undefined,false,s.structureId);add([[x1,t0],[x1,t1]],'CUT',undefined,false,s.structureId);
  for(const fold of s.folds)add([[x0,fold.t],[x1,fold.t]],fold.operation,undefined,false,s.structureId);
 }
 const part={id:'card',label:'Einblatt-Kartenrohling',role:'card',width:p.card.width,height:2*p.card.half,placement:{x:p.layout.gap,y:p.layout.gap},paths};
 const errors=[...g.errors];if(part.width+2*p.layout.gap>p.layout.width+EPS||part.height+2*p.layout.gap>p.layout.height+EPS)errors.push({message:'Kartenrohling: Passt nicht auf den eingestellten Materialbogen.'});
 return {project:p,parts:[part],figures:g.figures,structures:g.structures,material:g.material,errors,warnings:g.warnings,coordinateConvention,assemblySteps:['Den Kartenrohling und alle inneren Schnittlinien schneiden. Markierte Materialstege und Scharnierkanten bleiben ungeschnitten.','Lose Flächen und die ausgeschnittenen Motivlöcher entfernen. Alle aufstehenden Motive und Stützen bleiben mit dem Blatt verbunden.','Grüne Linien als Talfalten, blaue Linien als Bergfalten vorfalzen. Die durchgehenden Stege und die Stufen der Kirigami-Bänder vorsichtig nach innen drücken.','Die Karte langsam bis 90° öffnen. Motive und Stützen richten sich aus dem Kartenblatt auf; es wird nichts angeklebt.','Papierstärke und sehr schmale Details mit einem Probeschnitt prüfen. Bei 180° liegt die Karte wieder flach.']};
}
