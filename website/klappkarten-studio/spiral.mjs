import polygon from './vendor/polygon-clipping.mjs';

// An original, constant-width Archimedean ribbon. Only straight, parallel hinges
// are added: each horizontal slice is an ordinary rigid origamic-architecture face.
const EPS=1e-7, TOLERANCE=.04, MAX_POINTS=1024;
let serial=0;
export function newSpiral(overrides={}) {
 return {id:`spiral-${Date.now().toString(36)}-${++serial}`,type:'spiral',name:'Spiralband',x:74,width:84,color:'#b18465',turns:2.5,ribbonWidth:4,innerRadius:7,rotation:0,direction:'cw',levels:4,height:36,...overrides};
}
const ringArea=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
const area=m=>m.reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((n,r)=>n+ringArea(r),0),0);
const rectangle=(x0,y0,x1,y1)=>[[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(p,a,b)=>Math.abs(cross(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
const inside=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(on(p,a,b))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const pointDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],v=dx*dx+dy*dy,t=v?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/v)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
function segmentDistance(a,b,c,d){if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b))return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}
const bounds=m=>{const q=m.flat(2);return {minX:Math.min(...q.map(p=>p[0])),maxX:Math.max(...q.map(p=>p[0])),minY:Math.min(...q.map(p=>p[1])),maxY:Math.max(...q.map(p=>p[1]))};};

/** Positive-length horizontal material intervals; boundary caps count as material. */
export function horizontalSections(multi,t){
 const xs=[];
 for(const poly of multi)for(const ring of poly)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i];if(Math.abs(a[1]-t)<EPS)xs.push(a[0]);if(Math.abs(b[1]-t)<EPS)xs.push(b[0]);
  if((a[1]<t&&b[1]>t)||(a[1]>t&&b[1]<t))xs.push(a[0]+(b[0]-a[0])*(t-a[1])/(b[1]-a[1]));
 }
 const ordered=xs.sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>EPS),segments=[];
 for(let i=1;i<ordered.length;i++){const a=ordered[i-1],b=ordered[i],p=[(a+b)/2,t];if(b-a<EPS||!multi.some(poly=>inside(p,poly[0])&&!poly.slice(1).some(r=>inside(p,r))))continue;
  if(segments.length&&Math.abs(segments.at(-1)[1][0]-a)<EPS)segments.at(-1)[1][0]=b;else segments.push([[a,t],[b,t]]);
 }
 return segments;
}
function commonSections(a,b){const out=[];for(const [p,q]of a)for(const [r,s]of b){const lo=Math.max(p[0],r[0]),hi=Math.min(q[0],s[0]);if(hi-lo>EPS)out.push([[lo,p[1]],[hi,p[1]]]);}return out;}
function boundaryCuts(footprint,anchors){const cuts=[];for(const poly of footprint)for(const ring of poly)for(let i=1;i<ring.length;i++){
 const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],axis=Math.abs(dx)>=Math.abs(dy)?0:1,ts=[0,1];
 for(const hinge of anchors)if(Math.abs(cross(a,b,hinge[0]))<EPS&&Math.abs(cross(a,b,hinge[1]))<EPS)for(const p of hinge){const u=(p[axis]-a[axis])/(b[axis]-a[axis]);if(u>EPS&&u<1-EPS)ts.push(u);}
 ts.sort((a,b)=>a-b);for(let j=1;j<ts.length;j++){const lo=ts[j-1],hi=ts[j];if(hi-lo<EPS)continue;const at=u=>[a[0]+u*dx,a[1]+u*dy];if(!anchors.some(([p,q])=>on(at((lo+hi)/2),p,q)))cuts.push([at(lo),at(hi)]);}
 }return cuts;}
function empty(structure,messages){const A=structure.height,B=0,x=structure.x;return {structureId:structure.id,structure,panels:[],folds:[],cuts:[],footprint:[],window:{minX:x,maxX:x,minY:-A,maxY:-A},A,B,anchors:{back:[],foot:[]},steps:[],errors:messages,warnings:[],sourcePointCount:0};}

export function compileSpiral(structure){
 const {turns,ribbonWidth:w,innerRadius:r0,width,height:A,levels}=structure,total=turns*2*Math.PI,R=(width-w)/2,k=(R-r0)/total,messages=[];
 if(w<1)messages.push('Der durchgehende Spiralsteg muss mindestens 1 mm breit sein.');
 if(R<=r0)messages.push('Außendurchmesser muss größer als Innendurchmesser plus Stegbreite sein.');
 if(k>0&&2*Math.PI*k<w+2+2*TOLERANCE)messages.push('Zwischen den Spiralwindungen müssen mindestens 2 mm freier Abstand bleiben. Windungen oder Stegbreite verkleinern.');
 if(k>0&&(r0*r0+k*k)**1.5/(r0*r0+2*k*k)<w/2+.5)messages.push('Der Innenradius ist für diese Stegbreite zu eng. Innenradius vergrößern.');
 if(messages.length)return empty(structure,messages);
 const sign=structure.direction==='cw'?1:-1,rotation=structure.rotation*Math.PI/180;
 const sample=u=>{const phi=rotation+sign*u,r=r0+k*u,co=Math.cos(phi),si=Math.sin(phi),dx=k*co-sign*r*si,dy=k*si+sign*r*co,n=Math.hypot(dx,dy);return {u,left:[r*co-w*dy/(2*n),r*si+w*dx/(2*n)],right:[r*co+w*dy/(2*n),r*si-w*dx/(2*n)]};};
 const samples=[sample(0)];let overflow=false;
 // For p(u)=(r0+ku)(cos u,sin u), |p''|<=hypot(r,2k).
 // The unit normal has |n''|<=6. Therefore the chord error of either
 // offset is <=(hypot(r,2k)+3w)*du²/8, a conservative physical-mm bound.
 function subdivide(a,b,depth=0){if(overflow)return;const m=sample((a.u+b.u)/2),errorBound=(Math.hypot(r0+k*b.u,2*k)+3*w)*(b.u-a.u)**2/8;if(errorBound>TOLERANCE&&depth<16){subdivide(a,m,depth+1);subdivide(m,b,depth+1);}else {samples.push(b);if(2*samples.length+1>MAX_POINTS)overflow=true;}}
 const initial=Math.ceil(total/(Math.PI/8));for(let i=1;i<=initial&&!overflow;i++)subdivide(samples.at(-1),sample(total*i/initial));
 if(overflow)return empty(structure,['Die Spirale überschreitet 1024 Konturpunkte bei 0,05 mm Genauigkeit. Durchmesser oder Windungszahl verkleinern.']);
 const left=samples.map(s=>s.left),right=samples.map(s=>s.right),ring=[...left,...right.reverse(),left[0]],parameters=[...samples.map(s=>s.u),...samples.map(s=>s.u).reverse(),0];
 // Test the actual sampled boundary, not only nominal radial pitch. Neighbouring
 // points on one turn are deliberately excluded from the inter-turn gap test.
 let narrow=false,crossing=false;
 for(let i=1;i<ring.length;i++)for(let j=i+2;j<ring.length;j++){
  if(i===1&&j===ring.length-1)continue;const a=ring[i-1],b=ring[i],c=ring[j-1],d=ring[j],apart=Math.min(Math.abs(parameters[i-1]-parameters[j]),Math.abs(parameters[i]-parameters[j-1]));
  if(Math.min(a[0],b[0])>Math.max(c[0],d[0])+2.1||Math.max(a[0],b[0])+2.1<Math.min(c[0],d[0])||Math.min(a[1],b[1])>Math.max(c[1],d[1])+2.1||Math.max(a[1],b[1])+2.1<Math.min(c[1],d[1]))continue;
  const distance=segmentDistance(a,b,c,d);if(distance<EPS)crossing=true;if(apart>Math.PI&&distance<2+2*TOLERANCE)narrow=true;
 }
 if(crossing||narrow)return empty(structure,[crossing?'Spiralränder überkreuzen sich. Innenradius, Windungszahl oder Stegbreite ändern.':'Zwischen den tatsächlichen Spiralrändern bleiben weniger als 2 mm frei. Windungszahl oder Stegbreite verkleinern.']);
 let footprint=[[ring]],box=bounds(footprint),top=box.minY+w/4,bottom=box.maxY-w/4;
 if(bottom-top<=EPS)return empty(structure,['Die Spirale ist zu flach für zwei endliche Kartenscharniere.']);
 footprint=polygon.intersection(footprint,rectangle(box.minX-1,top,box.maxX+1,bottom));
 if(footprint.length!==1||footprint[0].length!==1)return empty(structure,['Die Spiralbahn oder ihre Scharniere zerfallen in getrennte Materialflächen. Parameter ändern.']);
 const sourcePointCount=footprint[0][0].length;if(sourcePointCount>MAX_POINTS)return empty(structure,['Die zugeschnittene Spirale überschreitet 1024 Konturpunkte. Durchmesser oder Windungszahl verkleinern.']);
 const B=bottom-top-A;
 if(B<=.1)return empty(structure,['Die Aufstellhöhe muss kleiner als die abgewickelte Spiralhöhe sein. Höhe verkleinern.']);
 const shift=-A-top;footprint=footprint.map(p=>p.map(r=>r.map(([x,t])=>[x+structure.x,t+shift])));box=bounds(footprint);
 // A cap can meet more than one turn. Tiny additional intersections are cut,
 // rather than pretending that a sub-millimetre tag is a reliable attachment.
 const anchors={back:horizontalSections(footprint,-A).filter(([a,b])=>b[0]-a[0]>=1),foot:horizontalSections(footprint,B).filter(([a,b])=>b[0]-a[0]>=1)};
 if(!anchors.back.length||!anchors.foot.length)return empty(structure,['Die Kartenscharniere müssen mindestens 1 mm breit sein. Stegbreite vergrößern oder Spirale drehen.']);
 const steps=Array.from({length:levels},()=>({rise:A/levels,run:B/levels})),panels=[],boundaries=[{t:-A,operation:'FOLD_VALLEY'}];let t=-A,D=0,Z=A;
 for(const step of steps){let end=t+step.run;panels.push({kind:'roof',D,Z,t0:t,t1:end});D+=step.run;t=end;boundaries.push({t,operation:'FOLD_MOUNTAIN'});end=t+step.rise;panels.push({kind:'front',D,Z,t0:t,t1:end});Z-=step.rise;t=end;boundaries.push({t,operation:'FOLD_VALLEY'});}
 for(const face of panels)face.source=polygon.intersection(footprint,rectangle(box.minX-1,face.t0,box.maxX+1,face.t1));
 // Each polygon component is a rigid face. Its finite shared intervals, rather
 // than coincident vertices, connect it to neighbouring faces and both leaves.
 const nodes=[],faces=panels.map((face,faceIndex)=>face.source.map(poly=>{const node={poly,faceIndex,edges:[]};nodes.push(node);return node;})),folds=[];
 for(const points of anchors.back)folds.push({t:-A,operation:'FOLD_VALLEY',points});
 for(let i=1;i<panels.length;i++){
  const at=panels[i].t0,segments=[];for(const before of faces[i-1])for(const after of faces[i]){
   const shared=commonSections(horizontalSections([before.poly],at),horizontalSections([after.poly],at));
   if(shared.length){before.edges.push(after);after.edges.push(before);segments.push(...shared);}
  }
  for(const points of segments)folds.push({t:at,operation:boundaries[i].operation,points});
 }
 for(const points of anchors.foot)folds.push({t:B,operation:'FOLD_VALLEY',points});
 const roots=faces[0].filter(n=>commonSections(horizontalSections([n.poly],-A),anchors.back).length).concat(faces.at(-1).filter(n=>commonSections(horizontalSections([n.poly],B),anchors.foot).length)),seen=new Set(roots),queue=[...roots];
 for(let i=0;i<queue.length;i++)for(const next of queue[i].edges)if(!seen.has(next)){seen.add(next);queue.push(next);}
 if(seen.size!==nodes.length)messages.push('Eine Spiralfläche ist nur an einem Punkt oder gar nicht mit den Kartenscharnieren verbunden. Spirale drehen oder Stufenzahl ändern.');
 if(nodes.length>400)messages.push('Die Spirale erzeugt mehr als 400 einzelne Faltflächen. Windungszahl oder Stufenzahl verkleinern.');
 const sum=panels.reduce((n,p)=>n+area(p.source),0);if(Math.abs(sum-area(footprint))>1e-5)messages.push('Die Faltflächen teilen den Kartenbogen nicht eindeutig auf.');
 const cuts=boundaryCuts(footprint,[...anchors.back,...anchors.foot]),warnings=[{message:'Spiralbänder haben mehrere bewegliche Gelenke: die gezeigte koordinierte Faltbewegung sorgfältig vorfalzen und beim ersten Aufstellen führen.'}];
 if(folds.some(f=>f.points[1][0]-f.points[0][0]<1))messages.push('Ein inneres Spiralscharnier ist schmaler als 1 mm. Spirale drehen oder Stufenzahl ändern; Fertigungsexport bleibt gesperrt.');
 else if(w<2)warnings.push({message:'Der Spiralsteg ist schmaler als 2 mm. Papierfestigkeit am Probeschnitt prüfen.'});
 return {structureId:structure.id,structure,panels,folds,cuts,footprint,window:box,A,B,anchors,steps,errors:messages,warnings,sourcePointCount,faceCount:nodes.length,curveTolerance:TOLERANCE,sourceOffset:{x:structure.x,t:shift}};
}
