/** Planar cut/crease arrangement and exact rigid-panel folding. No elastic-paper simulation. */
const EPS=1e-7, SNAP=1e7, LIMIT_SEGMENTS=2400, LIMIT_SPLIT=3000, LIMIT_FACES=300;
const pointKey=p=>p.map(n=>Math.round(n*SNAP)).join(',');
const snap=p=>p.map(n=>Math.round(n*SNAP)/SNAP);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const dist=(a,b)=>Math.hypot(...sub(a,b));
const signedArea=r=>r.reduce((s,a,i)=>s+cross(a,r[(i+1)%r.length]),0)/2;
const path=(points,closed=false)=>`M${points.map(p=>p.map(n=>+n.toFixed(7)).join(' ')).join('L')}${closed?'Z':''}`;
const isFold=operation=>operation==='FOLD_MOUNTAIN'||operation==='FOLD_VALLEY';
function inside(p,r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const insideFace=(p,f)=>inside(p,f.contours[0])&&!f.contours.slice(1).some(r=>inside(p,r));
const on=(p,a,b)=>Math.abs(cross(sub(b,a),sub(p,a)))<=EPS*Math.max(1,dist(a,b))&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
const parameter=(p,s)=>{const u=sub(s.b,s.a),i=Math.abs(u[0])>=Math.abs(u[1])?0:1;return(p[i]-s.a[i])/u[i];};
function intersections(a,b){
 const u=sub(a.b,a.a),v=sub(b.b,b.a),w=sub(b.a,a.a),den=cross(u,v),scale=Math.max(1,dist(a.a,a.b)*dist(b.a,b.b));
 if(Math.abs(den)>EPS*scale){const t=cross(w,v)/den,s=cross(w,u)/den;return t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS?{points:[[Math.max(0,Math.min(1,t)),Math.max(0,Math.min(1,s))]],overlap:false}:null;}
 if(Math.abs(cross(w,u))>EPS*Math.max(1,dist(a.a,a.b)))return null;
 const points=[];for(const p of [a.a,a.b,b.a,b.b])if(on(p,a.a,a.b)&&on(p,b.a,b.b))points.push([Math.max(0,Math.min(1,parameter(p,a))),Math.max(0,Math.min(1,parameter(p,b)))]);
 const unique=points.filter((p,i)=>points.findIndex(q=>Math.abs(q[0]-p[0])<EPS)===i);return unique.length?{points:unique,overlap:unique.length>1&&dist(lerp(a.a,a.b,unique[0][0]),lerp(a.a,a.b,unique[1][0]))>EPS}:null;
}
const identity=()=>({r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]});
const mulV=(r,p)=>[0,1,2].map(i=>r[3*i]*p[0]+r[3*i+1]*p[1]+r[3*i+2]*p[2]);
const mulR=(a,b)=>Array.from({length:9},(_,i)=>{const row=Math.floor(i/3),col=i%3;return a[3*row]*b[col]+a[3*row+1]*b[3+col]+a[3*row+2]*b[6+col];});
const apply=(T,p)=>mulV(T.r,p).map((n,i)=>n+T.t[i]);
function hinged(T,h,angle){
 const u=sub(h.b,h.a),length=Math.hypot(...u),x=u[0]/length,y=u[1]/length,c=Math.cos(angle),s=Math.sin(angle),v=1-c;
 const r=[c+x*x*v,x*y*v,y*s,x*y*v,c+y*y*v,-x*s,-y*s,x*s,c],a=[...h.a,0],ra=mulV(r,a),offset=mulV(T.r,sub(a,ra));
 return{r:mulR(T.r,r),t:T.t.map((n,i)=>n+offset[i])};
}
const transformError=(a,b)=>({position:dist(a.t,b.t),rotation:Math.max(...a.r.map((v,i)=>Math.abs(v-b.r[i])))});
const operations=new Set(['CUT','FOLD_MOUNTAIN','FOLD_VALLEY','ENGRAVE']);
export function newDrawing(card={width:148,half:105},overrides={}){if(!Number.isFinite(card?.width)||!Number.isFinite(card?.half)){overrides=card;card={width:148,half:105};}return{active:true,anchor:[card.width-5,2*card.half-5],lines:[{id:'drawing-spine',operation:'FOLD_VALLEY',points:[[0,card.half],[card.width,card.half]],angle:90}],...overrides};}
export function validateDrawing(p,number){
 if(p.drawing===undefined||p.drawing===null)return;
 const d=p.drawing;if(!d||typeof d!=='object'||Array.isArray(d)||typeof d.active!=='boolean'||!Array.isArray(d.anchor)||d.anchor.length!==2||!Array.isArray(d.lines)||d.lines.length>1200)throw new Error('Ungültige freie Kartenzeichnung (höchstens 1200 Linien).');
 d.anchor.forEach(n=>number(n,'Feste Kartenfläche',-10000,10000));let count=0;const ids=new Set();
 for(const l of d.lines){if(!l||typeof l!=='object'||typeof l.id!=='string'||!l.id||l.id.length>200||ids.has(l.id)||!operations.has(l.operation)||!Array.isArray(l.points)||l.points.length<2||l.points.length>2400)throw new Error('Ungültige Schnitt- oder Falzlinie.');ids.add(l.id);if(l.closed!==undefined&&typeof l.closed!=='boolean')throw new Error('Ungültiger Linienschluss.');
  if(isFold(l.operation)&&(l.points.length!==2||l.closed))throw new Error('Eine Falzlinie braucht genau zwei Punkte und eine gerade Achse.');
  if(l.angle===undefined&&isFold(l.operation))l.angle=90;if(l.angle!==undefined)number(l.angle,'Faltwinkel',0,180);
  for(const q of l.points){if(!Array.isArray(q)||q.length!==2)throw new Error('Ungültiger Linienpunkt.');q.forEach(n=>number(n,'Linienpunkt',-10000,10000));}
  count+=l.points.length;if(count>2400)throw new Error('Freie Zeichnung: höchstens 2400 Linienpunkte.');
 }
}
const cache=new Map();
export function compileDrawing(project,triangulate){
 const key=JSON.stringify([project.card,project.drawing]);if(cache.has(key))return cache.get(key);
 const W=project.card.width,H=project.card.half*2,d=project.drawing,errors=[],warnings=[],segments=[],engravings=[];
 const fail=(message,lineId)=>{if(!errors.some(e=>e.message===message&&e.lineId===lineId))errors.push({message,...(lineId?{lineId}:{})});};
 const inCard=q=>q[0]>=-EPS&&q[0]<=W+EPS&&q[1]>=-EPS&&q[1]<=H+EPS;
 for(const line of d.lines){const points=line.points.map(snap);if(points.some(q=>!inCard(q))){fail('Die Linie liegt außerhalb der Karte.',line.id);continue;}
  const pairs=points.slice(1).map((b,i)=>[points[i],b]);if(line.closed&&dist(points[0],points.at(-1))>EPS)pairs.push([points.at(-1),points[0]]);
  for(const[a,b]of pairs){if(dist(a,b)<EPS){fail('Die Linie enthält ein Segment ohne Länge.',line.id);continue;}const s={a,b,operation:line.operation,lineId:line.id,angle:line.angle??90,ts:[0,1]};(line.operation==='ENGRAVE'?engravings:segments).push(s);}
 }
 const frame=[[0,0],[W,0],[W,H],[0,H]];for(let i=0;i<4;i++)segments.push({a:frame[i],b:frame[(i+1)%4],operation:'CUT',frame:true,ts:[0,1]});
 if(segments.length>LIMIT_SEGMENTS)throw new Error(`Freie Zeichnung: höchstens ${LIMIT_SEGMENTS} gerade Segmente.`);
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
  const a=segments[i],b=segments[j];if(Math.max(a.a[0],a.b[0])<Math.min(b.a[0],b.b[0])-EPS||Math.max(b.a[0],b.b[0])<Math.min(a.a[0],a.b[0])-EPS||Math.max(a.a[1],a.b[1])<Math.min(b.a[1],b.b[1])-EPS||Math.max(b.a[1],b.b[1])<Math.min(a.a[1],a.b[1])-EPS)continue;
  const hit=intersections(a,b);if(!hit)continue;for(const[t,s]of hit.points){a.ts.push(t);b.ts.push(s);}
  if(hit.overlap&&(a.operation!==b.operation||isFold(a.operation)&&Math.abs(a.angle-b.angle)>EPS)){fail('Überlagerte Schnitt-/Falzlinien oder unterschiedliche Faltwinkel widersprechen sich.',a.lineId||b.lineId);if(b.lineId&&a.lineId!==b.lineId)fail('Überlagerte Schnitt-/Falzlinien oder unterschiedliche Faltwinkel widersprechen sich.',b.lineId);}
 }
 // Exported procedural coordinates are rounded to 1e-7 mm. Weld intersection
 // endpoints within 1e-5 mm so the two independently evaluated axes share a node.
 const unique=new Map(),nodes=new Map(),buckets=new Map(),weldTolerance=1e-5;
 const weld=p=>{const x=Math.floor(p[0]/weldTolerance),y=Math.floor(p[1]/weldTolerance);for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const q of buckets.get(`${i},${j}`)||[])if(dist(p,q)<weldTolerance)return q;const k=`${x},${y}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);return p;};
 for(const s of segments){const ts=[...new Set(s.ts.map(t=>+t.toFixed(10)))].sort((a,b)=>a-b);for(let i=1;i<ts.length;i++){
  let a=weld(snap(lerp(s.a,s.b,ts[i-1]))),b=weld(snap(lerp(s.a,s.b,ts[i])));if(dist(a,b)<EPS)continue;let ka=pointKey(a),kb=pointKey(b);if(ka>kb){[a,b]=[b,a];[ka,kb]=[kb,ka];}
  if(!nodes.has(ka))nodes.set(ka,{point:a,out:[]});if(!nodes.has(kb))nodes.set(kb,{point:b,out:[]});const k=`${ka}:${kb}`,old=unique.get(k);
  if(old){old.frame=old.frame||s.frame;old.lineIds.add(s.lineId);if(s.operation==='CUT'){old.operation='CUT';old.lineId=s.lineId||old.lineId;}continue;}
  unique.set(k,{...s,a,b,ka,kb,lineIds:new Set(s.lineId?[s.lineId]:[])});
  if(unique.size>LIMIT_SPLIT)throw new Error(`Zu viele Linienkreuzungen: höchstens ${LIMIT_SPLIT} Teilsegmente.`);
 }}
 const edges=[...unique.values()],halves=[];
 for(const edge of edges){const a={from:edge.ka,to:edge.kb,edge,face:-1},b={from:edge.kb,to:edge.ka,edge,face:-1};a.twin=b;b.twin=a;edge.forward=a;halves.push(a,b);nodes.get(a.from).out.push(a);nodes.get(b.from).out.push(b);}
 for(const node of nodes.values())node.out.sort((a,b)=>{const p=nodes.get(a.to).point,q=nodes.get(b.to).point;return Math.atan2(p[1]-node.point[1],p[0]-node.point[0])-Math.atan2(q[1]-node.point[1],q[0]-node.point[0]);});
 for(const h of halves){const out=nodes.get(h.to).out;h.next=out[(out.indexOf(h.twin)-1+out.length)%out.length];}
 const cycles=[];for(const start of halves){if(start.visited)continue;const hs=[];let h=start;do{if(h.visited){fail('Die Linienanordnung konnte nicht geschlossen werden.');break;}h.visited=true;hs.push(h);h=h.next;}while(h!==start&&hs.length<=2*LIMIT_SPLIT);if(h===start){const contour=hs.map(e=>nodes.get(e.from).point);cycles.push({hs,contour,area:signedArea(contour)});}}
 const faces=[];for(const c of cycles)if(c.area>EPS){const face={id:`drawing-face-${faces.length}`,index:faces.length,contours:[c.contour],area:c.area,kept:false};faces.push(face);for(const h of c.hs)h.face=face.index;}
 if(faces.length>LIMIT_FACES)throw new Error(`Freie Zeichnung: höchstens ${LIMIT_FACES} Faltflächen.`);
 for(const c of cycles)if(c.area<=EPS){
  let owner=null;for(const h of c.hs){const a=nodes.get(h.from).point,b=nodes.get(h.to).point,u=sub(b,a),length=Math.hypot(...u);if(length<EPS)continue;const offset=Math.min(1e-4,length*1e-4),q=[(a[0]+b[0])/2-u[1]/length*offset,(a[1]+b[1])/2+u[0]/length*offset];const candidates=faces.filter(f=>inside(q,f.contours[0])).sort((a,b)=>a.area-b.area);owner=candidates[0];break;}
  if(owner){for(const h of c.hs)h.face=owner.index;if(c.area< -EPS){owner.contours.push(c.contour);owner.area+=c.area;}}
 }
 const hinges=[];for(const edge of edges)if(isFold(edge.operation)){
  const left=edge.forward.face,right=edge.forward.twin.face;if(left<0||right<0||left===right){fail('Diese Falz trennt keine zwei starren Flächen. Bis zu Schnitt-, Falz- oder Kartenrändern weiterführen.',edge.lineId);continue;}
  hinges.push({id:`drawing-hinge-${hinges.length}`,lineId:edge.lineId,lineIds:[...edge.lineIds],operation:edge.operation,a:edge.a,b:edge.b,left,right,angle:edge.angle});
 }
 const anchor=d.anchor;let root=faces.find(f=>insideFace(anchor,f));
 if(!inCard(anchor)||!root||edges.some(e=>on(anchor,e.a,e.b))){fail('Der Fixpunkt muss innerhalb einer Kartenfläche liegen, mit Abstand zu Schnitt- und Falzlinien.');root=faces.reduce((best,f)=>!best||f.area>best.area?f:best,null);}
 const adjacency=faces.map(()=>[]);for(const h of hinges){adjacency[h.left].push({h,other:h.right,sign:-1});adjacency[h.right].push({h,other:h.left,sign:1});}
 const kept=new Set(root?[root.index]:[]),queue=root?[root.index]:[];for(let i=0;i<queue.length;i++)for(const e of adjacency[queue[i]])if(!kept.has(e.other)){kept.add(e.other);queue.push(e.other);}
 let triangleCount=0;for(const f of faces){f.kept=kept.has(f.index);f.triangles=triangulate(f.contours);triangleCount+=f.triangles.length;if(triangleCount>60000)throw new Error('Freie Zeichnung: höchstens 60.000 Materialdreiecke. Konturen vereinfachen.');}
 const waste=faces.filter(f=>!f.kept).map(f=>f.contours),wasteArea=faces.filter(f=>!f.kept).reduce((n,f)=>n+f.area,0),retained=faces.filter(f=>f.kept),retainedHinges=hinges.filter(h=>kept.has(h.left)&&kept.has(h.right));
 if(waste.length)warnings.push({message:`${waste.length} vollständig abgetrennte Fläche${waste.length===1?' wird':'n werden'} als Schnittabfall entfernt (${wasteArea.toFixed(1)} mm²).`});
 const paths=[{d:path(frame,true),operation:'CUT'}],previewEdges=[];for(const edge of edges){const owners=[...new Set([edge.forward.face,edge.forward.twin.face])].filter(i=>kept.has(i));if(isFold(edge.operation)&&(!kept.has(edge.forward.face)||!kept.has(edge.forward.twin.face)||edge.forward.face===edge.forward.twin.face))continue;if(owners.length)previewEdges.push({a:edge.a,b:edge.b,owners,operation:edge.operation,lineId:edge.lineId});if(!edge.frame)paths.push({d:path([edge.a,edge.b]),operation:edge.operation,lineId:edge.lineId});}
 for(const s of engravings){const ts=[0,1];for(const edge of edges){const hit=intersections(s,edge);if(hit)for(const[t]of hit.points)ts.push(t);}const sorted=[...new Set(ts)].sort((a,b)=>a-b);for(let i=1;i<sorted.length;i++){const lo=sorted[i-1],hi=sorted[i];if(hi-lo<EPS)continue;const mid=lerp(s.a,s.b,(lo+hi)/2),owner=retained.find(f=>insideFace(mid,f)||f.contours.some(r=>r.some((a,j)=>on(mid,a,r[(j+1)%r.length]))));if(owner){const a=lerp(s.a,s.b,lo),b=lerp(s.a,s.b,hi);paths.push({d:path([a,b]),operation:'ENGRAVE',lineId:s.lineId});previewEdges.push({a,b,owners:[owner.index],operation:'ENGRAVE',lineId:s.lineId});}}}
 const solve=progress=>{const transforms=new Map(),poseErrors=[];if(root)transforms.set(root.index,identity());const q=root?[root.index]:[];for(let i=0;i<q.length;i++){const parent=q[i];for(const e of adjacency[parent]){if(!kept.has(e.other))continue;const angle=e.sign*(e.h.operation==='FOLD_MOUNTAIN'?-1:1)*e.h.angle*Math.PI/180*progress/100,candidate=hinged(transforms.get(parent),e.h,angle);
   if(!transforms.has(e.other)){transforms.set(e.other,candidate);q.push(e.other);}else{const residual=transformError(candidate,transforms.get(e.other));if(residual.position>1e-5||residual.rotation>1e-6)if(!poseErrors.some(a=>a.lineId===e.h.lineId))poseErrors.push({lineId:e.h.lineId,message:`Für diese Winkel keine widerspruchsfreie starre Vorschau: Faltzyklus bei ${progress}%, Gelenkabweichung ${residual.position.toFixed(3)} mm. Andere Faltwinkel oder eine andere Faltbewegung können möglich sein.`,progress,residual});}
  }}return{transforms,errors:poseErrors};};
 for(const progress of [25,50,75,100]){const state=solve(progress);if(state.errors.length){for(const e of state.errors)if(!errors.some(a=>a.lineId===e.lineId&&a.progress))errors.push(e);break;}}
 warnings.push({message:'Starre Flächen und Gelenke werden geometrisch geprüft. Papierdicke, Kollisionen und vollständiges Schließen sind in der freien Faltvorschau nicht nachgewiesen; mit einem Papiermodell prüfen.'});
 const material={base:retained.map(f=>f.contours),fixed:root?[root.contours]:[],moving:retained.filter(f=>f!==root).map(f=>f.contours),extracted:waste,waste,areas:{blank:W*H,base:retained.reduce((n,f)=>n+f.area,0),front:0,roof:0,waste:wasteArea}};
 const result={faces,hinges:retainedHinges,paths,waste,errors,warnings,material,rootFaceId:root?.id,graph:{vertices:retained.length,edges:retainedHinges.length,components:root?1:0,discardedFaces:waste.length},pose(progress=0){
  if(typeof progress!=='number'||!Number.isFinite(progress))throw new Error('Ungültiger Faltfortschritt.');
  const amount=Math.max(0,Math.min(100,progress)),state=solve(amount),invalid=errors.length>0||state.errors.length>0;
  const panels=retained.map(f=>{const T=invalid?identity():state.transforms.get(f.index)||identity(),world=q=>{const p=apply(T,[...q,0]);return[p[0],p[1]-H/2,p[2]];},sourcePolygons=f.contours.map(r=>r.map(([x,y])=>[x,y-H/2])),sourceTriangles=f.triangles.map(t=>t.map(([x,y])=>[x,y-H/2])),polygons=f.contours.map(r=>r.map(world));return{id:f.id,role:'drawing',color:f===root?'#eee8db':'#cdb58c',sourcePolygons,sourceTriangles,polygons,vertices:polygons.flat(),triangles:f.triangles.map(t=>t.map(world)),faceId:f.id};});
  const lines=previewEdges.flatMap(edge=>{const owners=edge.operation==='CUT'?edge.owners:edge.owners.slice(0,1);return owners.map(owner=>{const T=invalid?identity():state.transforms.get(owner)||identity();return{lineId:edge.lineId,operation:edge.operation,points:[edge.a,edge.b].map(q=>{const p=apply(T,[...q,0]);return[p[0],p[1]-H/2,p[2]];})};});});
  return{panels,lines,angle:amount,progress:amount,flatFallback:invalid,valid:!invalid,errors:[...errors,...state.errors.filter(e=>!errors.some(a=>a.lineId===e.lineId&&a.progress===e.progress))],warnings,hinges:retainedHinges};
 }};
 while(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
