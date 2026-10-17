const NS='http://www.w3.org/2000/svg';
export function svgNode(name,attributes={}){const node=document.createElementNS(NS,name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
export function anchorValue(mode,value,min,max){return mode==='start'?min+value:mode==='end'?max-value:mode==='relative'?min+value*(max-min):(min+max)/2+value;}
export function featureCenter(feature,bounds){return [anchorValue(feature.anchor?.u,feature.x,bounds[0],bounds[2]),anchorValue(feature.anchor?.v,feature.y,bounds[1],bounds[3])];}
export function localFeatureLoops(feature){
 const w=feature.width,h=feature.height,n=48;if(['svg','text'].includes(feature.shape))return feature.contours||[];if(feature.shape==='polygon')return [feature.points||[]];if(feature.shape==='circle')return [Array.from({length:n},(_,i)=>[Math.cos(i/n*Math.PI*2)*w/2,Math.sin(i/n*Math.PI*2)*w/2])];if(feature.shape==='pattern')return Array.from({length:feature.count},(_,j)=>Array.from({length:n},(_,i)=>[(j-(feature.count-1)/2)*feature.pitch+Math.cos(i/n*Math.PI*2)*w/2,Math.sin(i/n*Math.PI*2)*w/2]));if(feature.shape==='slot'){const radius=Math.min(w,h)/2,dx=w/2-radius,dy=h/2-radius;return [Array.from({length:n},(_,i)=>{const angle=i/n*Math.PI*2;return [Math.cos(angle)*radius+Math.sign(Math.cos(angle))*dx,Math.sin(angle)*radius+Math.sign(Math.sin(angle))*dy];})];}return [[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]];
}
export function featureLoops(feature,bounds){const center=featureCenter(feature,bounds),a=(feature.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return localFeatureLoops(feature).map(loop=>loop.map(([x,y])=>[center[0]+x*c-y*s,center[1]+x*s+y*c]));}
export function measureFeature(feature,bounds){
 const points=[...localFeatureLoops(feature),...(feature.lines||[])].flat();
 if(!points.length)return null;
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
 const center=featureCenter(feature,bounds),angle=(feature.angle||0)*Math.PI/180,u=[Math.cos(angle),Math.sin(angle)],v=[-Math.sin(angle),Math.cos(angle)];
 const corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>[center[0]+u[0]*x+v[0]*y,center[1]+u[1]*x+v[1]*y]);
 return {center,u,v,corners,width:x1-x0,height:y1-y0,x:center[0]-bounds[0],y:center[1]-bounds[1]};
}
function pathData(loops,close=true){return loops.filter(l=>l.length).map(l=>'M'+l.map(p=>p.join(',')).join('L')+(close?'Z':'')).join('');}
export class SurfaceEditor{
 constructor(host,{onSelect,onMove,onVertex,onCreate,onContour,onChangeEnd,onCancel,onDraft}){Object.assign(this,{host,onSelect,onMove,onVertex,onCreate,onContour,onChangeEnd,onCancel,onDraft});this.drafts=new Map();this.tool='select';this.draft=[];this.svg=svgNode('svg',{'aria-label':'Fläche in Millimetern bearbeiten',role:'img'});host.append(this.svg);this.svg.addEventListener('pointerdown',e=>this.down(e));this.svg.addEventListener('pointermove',e=>this.move(e));this.svg.addEventListener('pointerup',e=>this.up(e));this.svg.addEventListener('pointercancel',()=>{this.drag=null;this.onCancel?.();});this.resizeObserver=new ResizeObserver(()=>this.render());this.resizeObserver.observe(host);}
 update(part,features,selected,grid=5,snap=true){if(this.part?.id!==part?.id){this.saveDraft();this.part=part;this.draft=this.drafts.get(this.draftKey())||[];this.onDraft?.(this.draft.length);}this.part=part;this.features=features;this.selected=selected;this.grid=Math.max(.1,+grid||5);this.snap=snap;this.render();}
 draftKey(){return (this.part?.id||'')+':'+this.tool;}
 saveDraft(){if(['polygon','contour'].includes(this.tool)){if(this.draft.length)this.drafts.set(this.draftKey(),this.draft);else this.drafts.delete(this.draftKey());}}
 pendingDraft(){this.saveDraft();return [...this.drafts.entries()].find(([,points])=>points.length);}
 cancel(){this.drag=null;this.onCancel?.();this.drafts.delete(this.draftKey());this.draft=[];this.onDraft?.(0);this.render();}
 clearDrafts(){this.drafts.clear();this.draft=[];this.drag=null;}
 setTool(tool){this.saveDraft();this.tool=tool;this.draft=this.drafts.get(this.draftKey())||[];this.onDraft?.(this.draft.length);this.render();}
 point(event){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(this.world.getScreenCTM().inverse()),s=this.snap?this.grid:0;return s?[Math.round(p.x/s)*s,Math.round(p.y/s)*s]:[p.x,p.y];}
 render(){this.svg.replaceChildren();if(!this.part){const text=svgNode('text',{x:20,y:40,fill:'#70767a','font-size':12});text.textContent='Bauteil auswählen. Nach der Berechnung erscheint hier seine Fläche.';this.svg.append(text);return;}
 const b=this.part.bounds,w=b[2]-b[0],h=b[3]-b[1],selected=this.features.find(f=>f.id===this.selected),measurement=selected&&measureFeature(selected,b);
 const display=[...b];for(const p of measurement?.corners||[]){display[0]=Math.min(display[0],p[0]);display[1]=Math.min(display[1],p[1]);display[2]=Math.max(display[2],p[0]);display[3]=Math.max(display[3],p[1]);}
 // Reserve screen space for legible dimension labels, including on narrow screens.
 const unit=Math.max((display[2]-display[0])/Math.max(80,(this.host.clientWidth||800)-88),(display[3]-display[1])/Math.max(80,(this.host.clientHeight||500)-88)),pad=44*unit;
 this.svg.setAttribute('viewBox',`${display[0]-pad} ${-display[3]-pad} ${display[2]-display[0]+pad*2} ${display[3]-display[1]+pad*2}`);const defs=svgNode('defs'),pattern=svgNode('pattern',{id:'surface-grid',width:this.grid,height:this.grid,patternUnits:'userSpaceOnUse'});pattern.append(svgNode('path',{d:`M ${this.grid} 0 L 0 0 0 ${this.grid}`,fill:'none',stroke:'#cfd6c1','stroke-width':'.25'}));defs.append(pattern);this.svg.append(defs);this.world=svgNode('g',{transform:'scale(1,-1)'});this.svg.append(this.world);this.world.append(svgNode('rect',{x:display[0]-pad,y:display[1]-pad,width:display[2]-display[0]+pad*2,height:display[3]-display[1]+pad*2,fill:'url(#surface-grid)'}));this.world.append(svgNode('path',{d:pathData([this.part.nominal,...(this.part.nominalHoles||[])]),'fill-rule':'evenodd',fill:'#eee5c9',stroke:'#7b8968','stroke-width':'.5'}));for(const loop of this.part.protected||[])this.world.append(svgNode('path',{d:pathData([loop]),fill:'#e1b663','fill-opacity':'.22',stroke:'none'}));
 for(const feature of this.features){const chosen=feature.id===this.selected,node=svgNode('path',{d:pathData(featureLoops(feature,b)),fill:feature.operation==='cut'?'#fafbf7':'#7f9463','fill-opacity':feature.operation==='cut'?'.85':'.35',stroke:chosen?'#24594b':feature.operation==='cut'?'#b85d47':'#719052','stroke-width':chosen?'.9':'.5','fill-rule':'evenodd','data-feature':feature.id,class:'feature'});this.world.append(node);if(feature.lines?.length){const center=featureCenter(feature,b),a=(feature.angle||0)*Math.PI/180;this.world.append(svgNode('path',{d:pathData(feature.lines.map(l=>l.map(([x,y])=>[center[0]+x*Math.cos(a)-y*Math.sin(a),center[1]+x*Math.sin(a)+y*Math.cos(a)])),false),fill:'none',stroke:'#719052','stroke-width':'.5','data-feature':feature.id}));}if(chosen&&feature.shape==='polygon'){for(const [index,p] of (featureLoops(feature,b)[0]||[]).entries())this.world.append(svgNode('circle',{cx:p[0],cy:p[1],r:Math.max(1,w/150),fill:'#24594b',stroke:'white','stroke-width':'.4','data-vertex':index,'data-feature':feature.id,class:'vertex'}));}}
 this.renderDimensions(b,display,unit,selected,measurement);
 if(this.draft.length)this.world.append(svgNode('path',{d:pathData([this.draft],false),fill:'none',stroke:'#24594b','stroke-width':'.8','stroke-dasharray':'2 1'}));if(this.drag?.start&&this.drag?.end&&this.tool!=='select'){const a=this.drag.start,c=this.drag.end;this.world.append(svgNode('rect',{x:Math.min(a[0],c[0]),y:Math.min(a[1],c[1]),width:Math.abs(c[0]-a[0]),height:Math.abs(c[1]-a[1]),fill:'#c6d994','fill-opacity':'.4',stroke:'#24594b','stroke-width':'.5'}));}
 }
 renderDimensions(bounds,display,unit,feature,measurement){
  const overlay=svgNode('g',{class:'surface-dimensions',transform:'scale(1,-1)','pointer-events':'none','aria-label':'Bemaßung in Millimetern'});this.world.append(overlay);
  const format=value=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(Math.abs(value)<.000001?0:value),mm=value=>format(value)+' mm';
  const text=(position,label,kind,angle=0)=>{const node=svgNode('text',{transform:`translate(${position[0]} ${-position[1]}) rotate(${-angle})`,'text-anchor':'middle','dominant-baseline':'central','font-family':'system-ui, sans-serif','font-size':12*unit,'font-weight':550,fill:'#24594b',stroke:'#fafbf5','stroke-width':4*unit,'stroke-linejoin':'round','paint-order':'stroke','data-dimension':kind});node.textContent=label;overlay.append(node);};
  const line=(a,b,dashed=false)=>overlay.append(svgNode('path',{d:`M ${a[0]} ${-a[1]} L ${b[0]} ${-b[1]}`,fill:'none',stroke:dashed?'#64879a':'#527262','stroke-width':.8*unit,...(dashed?{'stroke-dasharray':`${3*unit} ${3*unit}`}:{})}));
  const dimension=(a,b,offset,label,kind,dashed=false)=>{
   const p=a.map((n,i)=>n+offset[i]),q=b.map((n,i)=>n+offset[i]),length=Math.hypot(q[0]-p[0],q[1]-p[1]),direction=length>1e-8?[(q[0]-p[0])/length,(q[1]-p[1])/length]:[1,0];
   let normal=Math.hypot(...offset)>1e-8?offset.map(n=>n/Math.hypot(...offset)):[-direction[1],direction[0]];
   if(!dashed){line(a,p.map((n,i)=>n+normal[i]*3*unit));line(b,q.map((n,i)=>n+normal[i]*3*unit));}
   line(p,q,dashed);
   if(length>8*unit)for(const [end,sign]of [[p,1],[q,-1]]){const back=end.map((n,i)=>n+direction[i]*sign*4*unit),wing=[-direction[1]*1.6*unit,direction[0]*1.6*unit];overlay.append(svgNode('path',{d:`M ${end[0]} ${-end[1]} L ${back[0]+wing[0]} ${-back[1]-wing[1]} L ${back[0]-wing[0]} ${-back[1]+wing[1]} Z`,fill:dashed?'#64879a':'#527262'}));}
   let angle=Math.atan2(direction[1],direction[0])*180/Math.PI;if(angle>90)angle-=180;if(angle<-90)angle+=180;
   text([(p[0]+q[0])/2+normal[0]*9*unit,(p[1]+q[1])/2+normal[1]*9*unit],label,kind,angle);
  };
  dimension([bounds[0],bounds[1]],[bounds[2],bounds[1]],[0,display[1]-bounds[1]-17*unit],mm(bounds[2]-bounds[0]),'plate-width');
  dimension([bounds[0],bounds[1]],[bounds[0],bounds[3]],[display[0]-bounds[0]-17*unit,0],mm(bounds[3]-bounds[1]),'plate-height');
  text([(display[0]+display[2])/2,display[3]+23*unit],(this.part.surface?.type==='wrap'?'Abwicklung · ':'')+'Stärke '+mm(this.part.thickness),'thickness');
  if(!measurement)return;
  const {center,corners,u,v,width,height,x,y}=measurement,gap=12*unit;
  dimension([bounds[0],center[1]],center,[0,0],'X '+mm(x),'position-x',true);
  dimension([center[0],bounds[1]],center,[0,0],'Y '+mm(y),'position-y',true);
  dimension(corners[0],corners[1],v.map(n=>-n*gap),(feature.shape==='circle'?'Ø ':'')+mm(width),feature.shape==='circle'?'diameter':'feature-width');
  if(feature.shape!=='circle')dimension(corners[1],corners[2],u.map(n=>n*gap),mm(height),'feature-height');
  if(feature.shape==='pattern')text([(display[0]+display[2])/2,display[3]+36*unit],`${feature.count} × Ø ${mm(feature.width)} · Abstand ${mm(feature.pitch)}`,'pattern');
 }
 down(event){if(!this.part||event.button!==0)return;event.preventDefault();const p=this.point(event);if(this.tool==='polygon'||this.tool==='contour'){this.draft.push(p);this.saveDraft();this.onDraft?.(this.draft.length);this.render();return;}const id=event.target.getAttribute('data-feature');if(this.tool==='select'){if(!id){this.onSelect(null);return;}this.onSelect(id);const feature=this.features.find(f=>f.id===id),vertex=event.target.getAttribute('data-vertex');this.drag={id,start:p,center:featureCenter(feature,this.part.bounds),vertex:vertex===null?null:+vertex};}else this.drag={start:p,end:p};this.svg.setPointerCapture(event.pointerId);}
 move(event){if(!this.drag||!this.part)return;const p=this.point(event);if(this.tool==='select'){if(this.drag.vertex!==null)this.onVertex(this.drag.id,this.drag.vertex,p);else this.onMove(this.drag.id,[this.drag.center[0]+p[0]-this.drag.start[0],this.drag.center[1]+p[1]-this.drag.start[1]]);}else{this.drag.end=p;this.render();}}
 up(event){if(!this.drag)return;const drag=this.drag;this.drag=null;if(this.tool!=='select'){const p=this.point(event),width=Math.abs(p[0]-drag.start[0]),height=Math.abs(p[1]-drag.start[1]);if(width>.05&&height>.05)this.onCreate(this.tool,{x:(p[0]+drag.start[0])/2,y:(p[1]+drag.start[1])/2,width,height});this.render();}this.onChangeEnd?.();}
 finish(){if(this.draft.length<3)throw new Error('Eine Kontur braucht mindestens drei Punkte.');const points=this.draft.map(p=>[...p]),key=this.draftKey(),tool=this.tool;this.draft=[];this.drafts.delete(key);const success=tool==='contour'?this.onContour(points):this.onCreate('polygon',{points});if(success===false){this.tool=tool;this.draft=points;this.drafts.set(key,points);}else{this.drafts.delete(key);this.onDraft?.(0);}this.render();}
}
