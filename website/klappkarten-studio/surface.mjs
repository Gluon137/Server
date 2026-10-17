import polygon from './vendor/polygon-clipping.mjs';

// Every panel is a rigid constant-D front or constant-Z roof. Both share the
// source parameter t=D-Z, hence one analytic motion and one manufacturing net.
const EPS=1e-7, LIMIT_POINTS=1600;
let serial=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const open=r=>r.length>1&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<EPS?r.slice(0,-1):r;
const close=r=>[...open(r),open(r)[0]];
const rect=(x0,y0,x1,y1)=>x1-x0>EPS&&y1-y0>EPS?[[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]]:[];
const signed=r=>r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2;
const area=m=>m.reduce((a,p)=>a+Math.abs(signed(open(p[0])))-p.slice(1).reduce((a,r)=>a+Math.abs(signed(open(r))),0),0);
const union=(...m)=>m.filter(x=>x.length).length?polygon.union(...m.filter(x=>x.length)):[];
const difference=(a,b)=>a.length&&b.length?polygon.difference(a,b):a;
const intersection=(a,b)=>a.length&&b.length?polygon.intersection(a,b):[];
const filled=m=>m.map(p=>[p[0]]);
const bounds=m=>{const pts=m.flat(2);return{minX:Math.min(...pts.map(p=>p[0])),maxX:Math.max(...pts.map(p=>p[0])),minY:Math.min(...pts.map(p=>p[1])),maxY:Math.max(...pts.map(p=>p[1]))};};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(p,a,b)=>Math.abs(cross(a,b,p))<EPS*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
const inRing=(p,r)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
const inside=(p,m)=>m.some(q=>inRing(p,q[0])&&!q.slice(1).some(r=>inRing(p,r)));
const key=p=>p.map(v=>Math.round(v*1e6)).join(',');
const length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function invalidContours(contours){
 const edges=[];
 for(let k=0;k<contours.length;k++){
  const r=open(contours[k]);if(r.length<3||Math.abs(signed(r))<EPS)return true;
  for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];if(length(a,b)<EPS)return true;edges.push({a,b,k,i,n:r.length});}
 }
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
  const a=edges[i],b=edges[j];if(a.k===b.k&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.n-1)){
   // Consecutive edges may share their endpoint, but may not double back over
   // positive-length material. Merely skipping adjacent pairs accepts spikes.
   if(Math.abs(cross(a.a,a.b,b.a))<EPS&&Math.abs(cross(a.a,a.b,b.b))<EPS){const axis=Math.abs(a.b[0]-a.a[0])>=Math.abs(a.b[1]-a.a[1])?0:1;const overlap=Math.min(Math.max(a.a[axis],a.b[axis]),Math.max(b.a[axis],b.b[axis]))-Math.max(Math.min(a.a[axis],a.b[axis]),Math.min(b.a[axis],b.b[axis]));if(overlap>EPS)return true;}
   continue;
  }
  if(on(a.a,b.a,b.b)||on(a.b,b.a,b.b)||on(b.a,a.a,a.b)||on(b.b,a.a,a.b)||cross(a.a,a.b,b.a)*cross(a.a,a.b,b.b)<0&&cross(b.a,b.b,a.a)*cross(b.a,b.b,a.b)<0)return true;
 }
 return false;
}
function material(contours){
 const rs=contours.map(open),depth=rs.map((r,i)=>rs.reduce((n,s,j)=>n+(j!==i&&inRing(r[0],s)?1:0),0));
 return rs.flatMap((r,i)=>depth[i]%2?[]:[[close(r),...rs.filter((s,j)=>depth[j]===depth[i]+1&&inRing(s[0],r)).map(close)]]);
}
export function newSurface(overrides={}){return{id:`surface-${Date.now().toString(36)}-${++serial}`,name:'Neue Fläche',orientation:'vertical',offset:24,color:'#a78968',contours:[[[48,0],[92,0],[92,35],[48,35]]],supportWidth:3,...overrides};}
export function validateSurfaces(project,number,ids=new Set()){
 if(project.surface===undefined||project.surface===null)return;
 const s=project.surface;if(!s||typeof s!=='object'||typeof s.active!=='boolean'||!Array.isArray(s.shapes)||s.shapes.length>30)throw new Error('Ungültiger Flächenentwurf (höchstens 30 Flächen).');
 let points=0;
 for(const f of s.shapes){
  if(!f||typeof f!=='object'||typeof f.id!=='string'||!f.id||f.id.length>200||ids.has(f.id))throw new Error('Flächen benötigen eindeutige IDs.');ids.add(f.id);
  if(typeof f.name!=='string'||f.name.length>200||!['vertical','horizontal'].includes(f.orientation)||!/^#[0-9a-f]{6}$/i.test(f.color))throw new Error('Ungültige Fläche.');
  number(f.offset,'Zeichenebene',.1,2000);if(f.supportWidth===undefined)f.supportWidth=3;number(f.supportWidth,'Materialsteg',1,100);
  if(!Array.isArray(f.contours)||!f.contours.length||f.contours.length>40)throw new Error('Eine Fläche braucht geschlossene Konturen.');
  for(const r of f.contours){if(!Array.isArray(r)||r.length<3||r.length>400)throw new Error('Flächenkontur: 3 bis 400 Punkte.');points+=r.length;for(const p of r){if(!Array.isArray(p)||p.length!==2)throw new Error('Ungültiger Flächenpunkt.');p.forEach(v=>number(v,'Flächenpunkt',-2000,4000));}}
 }
 if(points>LIMIT_POINTS)throw new Error('Flächenentwurf: höchstens 1600 Konturpunkte.');
}
function scaffold(shape,poly,occupied){
 const vertical=shape.orientation==='vertical',offset=shape.offset,P=[poly],box=bounds(P),extent=box.maxY;
 const mapped=P.map(p=>p.map(r=>r.map(([x,q])=>[x,vertical?offset-q:q-offset])));
 const holes=mapped.flatMap(p=>p.slice(1).map(r=>[r]));
 const width=Math.min(shape.supportWidth,box.maxX-box.minX),left=box.minX,right=box.maxX-width;
 const xs=[(left+right)/2,left,right,...poly[0].map(p=>Math.max(left,Math.min(right,p[0]-width/2)))];
 for(let i=1;i<12;i++)xs.push(left+(right-left)*i/12);
 let best=null;
 for(const x of [...new Set(xs)]){
  const bridge=vertical?rect(x,offset-extent,x+width,offset):rect(x,-offset,x+width,extent-offset);
  const requested=difference(union(mapped,bridge),holes);
  const companion=vertical?rect(x,-extent,x+width,offset-extent):rect(x,extent-offset,x+width,extent);
  const footprint=union(filled(requested),companion);
  // Prefer a bridge that leaves the original polygon connected and that avoids
  // paper already reserved by a higher-priority face.
  const score=area(intersection(footprint,occupied))*1e6+(requested.length!==1?1e10:0)+area(difference(bridge,mapped));
  if(!best||score<best.score)best={requested,companion,footprint,score};
 }
 return{...best,extent};
}
const num=v=>+v.toFixed(7);
function makeEdges(nodes){
 const raw=[],vertices=[];
 for(const [owner,n]of nodes.entries())for(const poly of n.source)for(const ring of poly){const r=open(ring);for(let i=0;i<r.length;i++){raw.push({a:r[i],b:r[(i+1)%r.length],owner});vertices.push(r[i]);}}
 if(raw.length>6500)throw new Error('Flächenentwurf erzeugt zu viele Kanten. Bitte Konturen vereinfachen.');
 const edges=new Map();
 for(const e of raw){const u=[e.b[0]-e.a[0],e.b[1]-e.a[1]],axis=Math.abs(u[0])>=Math.abs(u[1])?0:1;
  const ts=[0,1];for(const q of vertices)if(on(q,e.a,e.b)){const t=(q[axis]-e.a[axis])/u[axis];if(t>EPS&&t<1-EPS)ts.push(t);}
  const sorted=[...new Set(ts.map(t=>+t.toFixed(10)))].sort((a,b)=>a-b);
  for(let i=1;i<sorted.length;i++){if(sorted[i]-sorted[i-1]<EPS)continue;let a=e.a.map((v,j)=>num(v+u[j]*sorted[i-1])),b=e.a.map((v,j)=>num(v+u[j]*sorted[i]));let ka=key(a),kb=key(b);if(ka>kb){[a,b]=[b,a];[ka,kb]=[kb,ka];}const k=`${ka}:${kb}`;if(!edges.has(k))edges.set(k,{a,b,owners:new Set()});edges.get(k).owners.add(e.owner);}
 }
 return[...edges.values()];
}
export function compileSurfaces(project,triangulate){
 const W=project.card.width,H=project.card.half,blank=rect(0,-H,W,H),errors=[],warnings=[],panels=[],claims=[];
 const fail=(message,surfaceId)=>errors.push({message,...(surfaceId?{surfaceId}:{})});
 let occupied=[];
 for(const shape of [...(project.surface?.shapes||[])].reverse()){
  if(invalidContours(shape.contours)){fail(`${shape.name}: Konturen überkreuzen oder berühren sich oder besitzen keine Fläche.`,shape.id);continue;}
  const polys=material(shape.contours),box=bounds(polys),vertical=shape.orientation==='vertical';
  if(box.minY< -EPS){fail(`${shape.name}: Höhe und Tiefe müssen innerhalb der geöffneten Karte liegen.`,shape.id);continue;}
  if(box.maxX-box.minX<1-EPS)fail(`${shape.name}: Eine Fläche benötigt mindestens 1 mm Breite für einen tragenden Materialsteg.`,shape.id);
  if(shape.offset+box.maxY>H+EPS)fail(`${shape.name}: Höhe und Tiefe zusammen ragen aus der geschlossenen Karte.`,shape.id);
  let trimmed=0;
  for(const poly of polys){
   const s=scaffold(shape,poly,occupied),a=vertical?s.extent:shape.offset,b=vertical?shape.offset:s.extent;
   if(!s.footprint.length)continue;
   const box=bounds(s.footprint);if(box.minX<2-EPS||box.maxX>W-2+EPS||box.minY< -H+2-EPS||box.maxY>H-2+EPS)fail(`${shape.name}: Fläche und Materialstege benötigen 2 mm Abstand zum Kartenrand.`,shape.id);
   const requested=difference(s.requested,occupied),companion=difference(s.companion,occupied),claim=difference(s.footprint,occupied);
   trimmed+=area(s.requested)-area(requested);
   const front=vertical?requested:companion,roof=vertical?companion:requested;
   for(const [kind,source,constant]of[['front',front,b],['roof',roof,a]])for(const poly of source)if(area([poly])>EPS)panels.push({id:`surface-panel-${panels.length}`,surfaceId:shape.id,kind,color:shape.color,[kind==='front'?'D':'Z']:constant,source:[poly],requested:vertical?kind==='front':kind==='roof'});
   claims.push(claim);occupied=union(occupied,claim);
  }
  if(trimmed>EPS)warnings.push({surfaceId:shape.id,message:`${shape.name}: ${num(trimmed)} mm² wurden durch höher priorisierte Flächen ausgespart.`});
 }
 const extracted=union(...claims),base=difference(blank,extracted),fixed=intersection(base,rect(0,0,W,H)),moving=intersection(base,rect(0,-H,W,0));
 const nodes=[...fixed.map((p,i)=>({id:`surface-fixed-${i}`,kind:'roof',Z:0,source:[p],base:true})),...moving.map((p,i)=>({id:`surface-moving-${i}`,kind:'front',D:0,source:[p],base:true})),...panels];
 const welded=nodes.map((_,i)=>i),rootOf=i=>{while(welded[i]!==i){welded[i]=welded[welded[i]];i=welded[i];}return i;};
 const paths=[],hinges=[],adj=nodes.map(()=>new Set()),add=(a,b,operation,surfaceId)=>paths.push({operation,d:`M${a.map((v,i)=>num(v+(i?H:0))).join(' ')}L${b.map((v,i)=>num(v+(i?H:0))).join(' ')}`,...(surfaceId?{surfaceId}:{})});
 for(const edge of makeEdges(nodes)){
  const owners=[...edge.owners],a=nodes[owners[0]],b=nodes[owners[1]],mid=[(edge.a[0]+edge.b[0])/2,(edge.a[1]+edge.b[1])/2];let operation='CUT',connected=false;
  if(owners.length===2){
   if(a.kind===b.kind&&Math.abs((a.D??a.Z)-(b.D??b.Z))<EPS){connected=true;operation=null;welded[rootOf(owners[0])]=rootOf(owners[1]);}
   else if(a.kind!==b.kind){const front=a.kind==='front'?a:b,roof=a.kind==='roof'?a:b;
    if(Math.abs(edge.a[1]-edge.b[1])<EPS&&Math.abs(mid[1]-(front.D-roof.Z))<1e-5){connected=true;const upper=inside([mid[0],mid[1]+Math.min(1e-4,length(edge.a,edge.b)*1e-4)],front.source);operation=upper?'FOLD_MOUNTAIN':'FOLD_VALLEY';hinges.push({a:edge.a,b:edge.b,owners,operation,surfaceId:front.surfaceId||roof.surfaceId});}
   }
  }
  if(connected){adj[owners[0]].add(owners[1]);adj[owners[1]].add(owners[0]);}
  if(operation)add(edge.a,edge.b,operation,a.surfaceId||b?.surfaceId);
 }
 // Arrangement vertices may split one physical hinge into several tiny
 // segments. Measure contiguous spans between welded rigid faces, rather than
 // rejecting each exported segment individually.
 const hingeGroups=new Map(),hingeSpans=[];
 for(const h of hinges){const owners=h.owners.map(rootOf).sort((a,b)=>a-b),k=`${owners.join(':')}:${Math.round(h.a[1]*1e6)}:${h.operation}`;if(!hingeGroups.has(k))hingeGroups.set(k,[]);hingeGroups.get(k).push({...h,left:Math.min(h.a[0],h.b[0]),right:Math.max(h.a[0],h.b[0])});}
 for(const group of hingeGroups.values()){
  group.sort((a,b)=>a.left-b.left);let span=null;
  for(const h of group){if(span&&h.left<=span.right+EPS)span.right=Math.max(span.right,h.right);else{span={left:h.left,right:h.right,y:h.a[1],surfaceId:h.surfaceId};hingeSpans.push(span);}}
 }
 for(const span of hingeSpans)if(span.right-span.left<1-EPS)fail('Nach der Flächenbereinigung bleibt eine Falzverbindung unter 1 mm Breite. Fläche verschieben oder Priorität ändern.',span.surfaceId);
 const root=nodes.findIndex(n=>n.base&&n.kind==='roof');const reached=new Set(root<0?[]:[root]),queue=[...reached];
 for(let j=0;j<queue.length;j++)for(const n of adj[queue[j]])if(!reached.has(n)){reached.add(n);queue.push(n);}
 const disconnected=new Set();for(let i=0;i<nodes.length;i++)if(!reached.has(i)){const n=nodes[i];if(n.surfaceId)disconnected.add(n.surfaceId);else fail('Die Konstruktion trennt einen Teil des Kartenrohlings vollständig ab.');}
 for(const id of disconnected)fail('Eine Fläche hat nach der Prioritätsbereinigung keine durchgehende Verbindung über endliche Falzkanten zur Karte. Fläche verschieben oder Priorität ändern.',id);
 // A panel attached to just one card half is an unconstrained flap. The
 // analytic display must not pretend it is driven by opening the card. Follow
 // panel-only components and use base faces only as terminal anchor labels.
 const checkedPanels=new Set(),unconstrained=new Set();
 for(let start=0;start<nodes.length;start++)if(!nodes[start].base&&!checkedPanels.has(start)){
  const component=[start],anchors=new Set();checkedPanels.add(start);
  for(let j=0;j<component.length;j++)for(const next of adj[component[j]]){
   if(nodes[next].base)anchors.add(nodes[next].kind);
   else if(!checkedPanels.has(next)){checkedPanels.add(next);component.push(next);}
  }
  if(!anchors.has('front')||!anchors.has('roof'))for(const i of component)if(nodes[i].surfaceId)unconstrained.add(nodes[i].surfaceId);
 }
 for(const id of unconstrained)if(!disconnected.has(id))fail('Nach der Flächenbereinigung fehlt die Verbindung zu beiden Kartenhälften. Eine einseitig befestigte Fläche wird beim Öffnen nicht automatisch aufgestellt. Fläche verschieben oder Priorität ändern.',id);
 const surfaceMaterial=union(...panels.map(p=>p.source)),waste=difference(extracted,surfaceMaterial);
 for(const p of panels)p.triangles=triangulate(p.source.flat().map(open));
 const fixedTriangles=triangulate(fixed.flat().map(open)),movingTriangles=triangulate(moving.flat().map(open));
 if(panels.reduce((sum,p)=>sum+p.triangles.length,0)+fixedTriangles.length+movingTriangles.length>60000)throw new Error('Flächenentwurf: höchstens 60.000 Materialdreiecke.');
 const areas={blank:W*2*H,base:area(base),front:panels.filter(p=>p.kind==='front').reduce((a,p)=>a+area(p.source),0),roof:panels.filter(p=>p.kind==='roof').reduce((a,p)=>a+area(p.source),0),waste:area(waste)};
 if(Math.abs(areas.blank-areas.base-areas.front-areas.roof-areas.waste)>1e-3)fail('Die Materialaufteilung ist nicht eindeutig. Schnittdatei bleibt gesperrt.');
 warnings.push({message:'Die Konstruktion verwendet starre Flächen und integrale Papierstege. Papierdicke und Faltfestigkeit am Probeschnitt prüfen.'});
 return{panels,paths,hinges,hingeSpans,errors,warnings,material:{base,fixed,moving,extracted,waste,areas},fixedTriangles,movingTriangles,connectivity:{nodes:clone(nodes.map(({source,triangles,...n})=>n)),reached:[...reached]}};
}
