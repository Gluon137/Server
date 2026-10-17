const NS='http://www.w3.org/2000/svg';
const clone=value=>structuredClone(value);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const colors={CUT:'#b33131',FOLD_MOUNTAIN:'#2865a4',FOLD_VALLEY:'#287a4e',ENGRAVE:'#966622'};
const folded=operation=>operation==='FOLD_MOUNTAIN'||operation==='FOLD_VALLEY';
const pathData=(points,closed=false)=>points.length?`M${points.map(p=>p.join(' ')).join('L')}${closed?'Z':''}`:'';
function svgElement(tag,attributes={}){const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
function simplify(points,tolerance=.1){
 if(points.length<3)return points;
 const first=points[0],last=points.at(-1),dx=last[0]-first[0],dy=last[1]-first[1],length=dx*dx+dy*dy;
 let maximum=0,index=0;
 for(let i=1;i<points.length-1;i++){const p=points[i],t=length?Math.max(0,Math.min(1,((p[0]-first[0])*dx+(p[1]-first[1])*dy)/length)):0,d=distance(p,[first[0]+t*dx,first[1]+t*dy]);if(d>maximum){maximum=d;index=i;}}
 return maximum>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[first,last];
}

/** Direct card coordinates are millimetres, independent of the viewport zoom. */
export class CardLineEditor{
 constructor(host,{onChange=()=>{},onSelect=()=>{},onStatus=()=>{},onDraftChange=()=>{}}={}){
  this.host=host;this.onChange=onChange;this.onSelect=onSelect;this.onStatus=onStatus;this.onDraftChange=onDraftChange;this.colors={...colors};
  this.tool='select';this.operation='CUT';this.grid=1;this._selection=null;this.width=148;this.height=210;this.drawing={active:false,anchor:[10,200],lines:[]};this.view=null;this.draft=null;this.gesture=null;this.busy=false;
  this.svg=svgElement('svg',{'data-card-editor':'true',role:'img','aria-label':'Kartenzeichnung: Schnittlinien, Bergfalten, Talfalten und Gravur','preserveAspectRatio':'xMidYMid meet',tabindex:'0'});
  Object.assign(this.svg.style,{width:'100%',height:'100%',display:'block',touchAction:'none',userSelect:'none',minHeight:'360px'});
  this.host.replaceChildren(this.svg);this.abort=new AbortController();const options={signal:this.abort.signal};
  this.svg.addEventListener('pointerdown',event=>this.pointerDown(event),options);
  this.svg.addEventListener('pointermove',event=>this.pointerMove(event),options);
  this.svg.addEventListener('pointerup',event=>this.pointerUp(event),options);
  this.svg.addEventListener('pointercancel',()=>this.cancel(),options);
  this.svg.addEventListener('dblclick',event=>{event.preventDefault();if(this.tool==='polyline')this.finish();},options);
  this.svg.addEventListener('keydown',event=>this.keyDown(event),options);
  this.svg.addEventListener('keyup',event=>{if(event.code==='Space'){this.space=false;event.preventDefault();}},options);
  this.svg.addEventListener('blur',()=>{this.space=false;},options);
  this.svg.addEventListener('wheel',event=>{event.preventDefault();this.zoom(Math.exp(-Math.max(-120,Math.min(120,event.deltaY))*.002));},{...options,passive:false});
  this.fit();
 }
 get selection(){return this._selection?{...this._selection}:null;}
 update(project,result){
  const resized=this.width!==project.card.width||this.height!==2*project.card.half;
  const drawing=project.drawing||{active:false,anchor:[10,2*project.card.half-10],lines:[]},sourceKey=JSON.stringify([project.card.width,project.card.half,drawing]),changed=sourceKey!==this.sourceKey;
  this.sourceKey=sourceKey;this.width=project.card.width;this.height=2*project.card.half;this.drawing=clone(drawing);this.result=result;
  this.colors={CUT:project.colors?.cut||colors.CUT,FOLD_MOUNTAIN:project.colors?.mountain||colors.FOLD_MOUNTAIN,FOLD_VALLEY:project.colors?.valley||colors.FOLD_VALLEY,ENGRAVE:project.colors?.engrave||colors.ENGRAVE};
  if(changed){const hadDraft=!!this.draft;this.draft=null;this.gesture=null;if(hadDraft)this.onDraftChange(false);}
  if(this._selection&&!this.drawing.lines.some(line=>line.id===this._selection.lineId))this.setSelection(null);
  else if(this._selection){const line=this.selectedLine();this._selection.nodeIndex=Math.min(this._selection.nodeIndex,line.points.length-1);}
  if(resized)this.fit();else this.render();
 }
 setTool(tool){if(!['select','line','polyline','freehand','anchor'].includes(tool))return;this.cancel();this.tool=tool;this.ensureStraightFold();this.render();}
 setOperation(operation){if(!colors[operation])return;this.operation=operation;this.ensureStraightFold();this.render();}
 ensureStraightFold(){if(folded(this.operation)&&['polyline','freehand'].includes(this.tool)){this.tool='line';this.cancel();this.onStatus('Falze benötigen eine gerade Linie mit zwei Endpunkten.');}}
 setGrid(mm=1){this.grid=Number.isFinite(+mm)&&+mm>0?+mm:0;this.render();}
 setSelection(lineId,nodeIndex=0){const line=this.drawing.lines.find(line=>line.id===lineId);this._selection=line?{lineId,nodeIndex:Math.max(0,Math.min(line.points.length-1,nodeIndex))}:null;this.onSelect(this.selection);this.render();}
 selectedLine(){return this.drawing.lines.find(line=>line.id===this._selection?.lineId);}
 fit(){const margin=Math.max(this.width,this.height)*.055;this.view={x:-margin,y:-margin,width:this.width+2*margin,height:this.height+2*margin};this.render();}
 zoom(factor){if(!this.view||!Number.isFinite(factor)||factor<=0)return;const width=Math.max(12,Math.min(this.width*8,this.view.width/factor)),height=width*this.view.height/this.view.width;this.view={x:this.view.x+(this.view.width-width)/2,y:this.view.y+(this.view.height-height)/2,width,height};this.render();}
 point(event){const p=this.svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const ctm=this.svg.getScreenCTM();if(!ctm)return [0,0];const q=p.matrixTransform(ctm.inverse());return [q.x,q.y];}
 screenScale(){const ctm=this.svg.getScreenCTM();return ctm?Math.hypot(ctm.a,ctm.b):1;}
 bounded(point){return point.map((n,i)=>+Math.max(0,Math.min(i?this.height:this.width,n)).toFixed(7));}
 snap(point,excludeLine=null,excludeNode=-1){
  const raw=this.bounded(point),radius=7/this.screenScale();let nearest=null,best=radius;
  for(const line of this.drawing.lines)for(let i=0;i<line.points.length;i++){if(line.id===excludeLine&&(excludeNode===-1||excludeNode===i))continue;const q=line.points[i],d=distance(raw,q);if(d<best){nearest=q;best=d;}}
  if(nearest)return [...nearest];
  // Segment snapping makes a drawn endpoint meet an existing crease exactly.
  for(const line of this.drawing.lines){if(line.id===excludeLine)continue;const count=line.closed?line.points.length:line.points.length-1;for(let i=0;i<count;i++){
   const a=line.points[i],b=line.points[(i+1)%line.points.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;if(!length)continue;const t=Math.max(0,Math.min(1,((raw[0]-a[0])*dx+(raw[1]-a[1])*dy)/length)),q=[a[0]+t*dx,a[1]+t*dy],d=distance(raw,q);if(d<best){nearest=q;best=d;}
  }}
  if(nearest)return this.bounded(nearest);
  return this.bounded(raw.map((n,i)=>{const maximum=i?this.height:this.width;if(n<radius)return 0;if(maximum-n<radius)return maximum;return this.grid?Math.round(n/this.grid)*this.grid:n;}));
 }
 editable(){if(!this.drawing.active){this.onStatus('Zuerst „Leere Karte beginnen“ oder „Schnittbogen in Linien übernehmen“ wählen.');return false;}return !this.busy;}
 async commit(next,selection=this.selection){
  if(this.busy)return false;
  if(next.lines.length>1200||next.lines.reduce((sum,line)=>sum+line.points.length,0)>2400){this.onStatus('Maximal 1.200 Linien und 2.400 Knoten. Bitte die Zeichnung vereinfachen.');this.render();return false;}
  const previous=clone(this.drawing);this.busy=true;
  try{await this.onChange(clone(next));this.drawing=clone(next);this.sourceKey=JSON.stringify([this.width,this.height/2,this.drawing]);this._selection=selection&&next.lines.some(line=>line.id===selection.lineId)?{...selection}:null;this.onSelect(this.selection);return true;}
  catch(error){this.drawing=previous;this.onStatus(error?.message||'Die Änderung konnte nicht übernommen werden.');return false;}
  finally{this.busy=false;this.render();}
 }
 async finish(){
  if(!this.draft)return true;if(!this.editable())return false;
  const draft=clone(this.draft);
  let points=this.draft.points.filter((p,i,all)=>!i||distance(p,all[i-1])>.001);
  if(this.draft.type==='freehand')points=simplify(points);
  if(points.length<2){this.onStatus('Für die Linie noch einen zweiten Punkt setzen oder mit Escape verwerfen.');return false;}
  if(folded(this.operation))points=[points[0],points.at(-1)];
  const line={id:`line-${crypto.randomUUID()}`,operation:this.operation,points,...(folded(this.operation)?{angle:90}:{} )},next=clone(this.drawing);next.lines.push(line);this.gesture=null;const success=await this.commit(next,{lineId:line.id,nodeIndex:points.length-1});
  if(success){if(this.draft){this.draft=null;this.onDraftChange(false);}}else{const hadDraft=!!this.draft;this.draft=draft;if(!hadDraft)this.onDraftChange(true);}
  this.render();return success;
 }
 cancel(){const hadDraft=!!this.draft;this.draft=null;this.gesture=null;if(hadDraft)this.onDraftChange(false);this.render();}
 async deleteSelected(){if(!this.editable()||!this.selectedLine())return;const next=clone(this.drawing);next.lines=next.lines.filter(line=>line.id!==this._selection.lineId);await this.commit(next,null);}
 async duplicateSelected(){
  if(!this.editable()||!this.selectedLine())return;
  const line=clone(this.selectedLine());line.id=`line-${crypto.randomUUID()}`;const maxX=Math.max(...line.points.map(p=>p[0])),maxY=Math.max(...line.points.map(p=>p[1])),minX=Math.min(...line.points.map(p=>p[0])),minY=Math.min(...line.points.map(p=>p[1]));
  const dx=maxX+3<=this.width?3:minX>=3?-3:0,dy=maxY+3<=this.height?3:minY>=3?-3:0;line.points=line.points.map(([x,y])=>[x+dx,y+dy]);const next=clone(this.drawing);next.lines.push(line);await this.commit(next,{lineId:line.id,nodeIndex:0});
 }
 async addNode(){
  if(!this.editable()||!this.selectedLine())return;const next=clone(this.drawing),line=next.lines.find(line=>line.id===this._selection.lineId);if(folded(line.operation)){this.onStatus('Ein gerader Falz hat genau zwei Endpunkte.');return;}
  let index=this._selection.nodeIndex;if(index===line.points.length-1&&!line.closed)index--;const a=line.points[index],b=line.points[(index+1)%line.points.length];line.points.splice(index+1,0,a.map((n,i)=>(n+b[i])/2));await this.commit(next,{lineId:line.id,nodeIndex:index+1});
 }
 async removeNode(){
  if(!this.editable()||!this.selectedLine())return;const next=clone(this.drawing),line=next.lines.find(line=>line.id===this._selection.lineId);if(line.points.length<=(line.closed?3:2)||folded(line.operation)){this.onStatus('Diese Linie benötigt ihre verbleibenden Knoten.');return;}line.points.splice(this._selection.nodeIndex,1);await this.commit(next,{lineId:line.id,nodeIndex:Math.min(line.points.length-1,this._selection.nodeIndex)});
 }
 async closeSelected(){if(!this.editable()||!this.selectedLine())return;const next=clone(this.drawing),line=next.lines.find(line=>line.id===this._selection.lineId);if(folded(line.operation)||line.points.length<3){this.onStatus('Zum Schließen mindestens drei Schnitt- oder Gravurknoten zeichnen.');return;}line.closed=!line.closed;await this.commit(next);}
 pointerDown(event){
  if(event.button!==0&&event.button!==1)return;this.svg.focus({preventScroll:true});event.preventDefault();
  const raw=this.point(event);
  if(event.button===1||this.space){this.gesture={kind:'pan',start:raw,view:{...this.view}};this.svg.setPointerCapture(event.pointerId);return;}
  if(!this.editable())return;
  this.svg.setPointerCapture(event.pointerId);
  if(this.tool==='anchor'){const next=clone(this.drawing);next.anchor=this.snap(raw);this.commit(next);return;}
  if(this.tool==='select'){
   const handle=event.target.closest('[data-node-index]'),target=event.target.closest('[data-line-id]');
   if(!target){this.setSelection(null);return;}const line=this.drawing.lines.find(line=>line.id===target.dataset.lineId);if(!line)return;
   const node=handle?+handle.dataset.nodeIndex:line.points.reduce((best,p,i)=>distance(p,raw)<distance(line.points[best],raw)?i:best,0);
   this.setSelection(line.id,node);this.gesture={kind:handle?'node':'move',start:raw,original:clone(line),next:clone(this.drawing),moved:false};return;
  }
  const point=this.snap(raw);
  const hadDraft=!!this.draft;
  if(this.tool==='freehand'){this.draft={type:'freehand',points:[point]};this.gesture={kind:'freehand'};}
  else if(this.tool==='polyline'){if(!this.draft)this.draft={type:'polyline',points:[]};if(this.draft.points.length>=2400){this.onStatus('Maximal 2.400 Knoten. Zeichnung abschließen oder vereinfachen.');return;}if(!this.draft.points.length||distance(point,this.draft.points.at(-1))>.001)this.draft.points.push(point);this.gesture=null;}
  else {const second=!!this.draft;this.draft=this.draft||{type:'line',points:[point]};this.gesture={kind:'line',start:raw,second};}
  if(!hadDraft&&this.draft)this.onDraftChange(true);
  this.render();
 }
 pointerMove(event){
  const raw=this.point(event),gesture=this.gesture;
  if(!gesture){if(this.draft){this.draft.cursor=this.snap(raw);this.render();}return;}
  if(gesture.kind==='pan'){const dx=raw[0]-gesture.start[0],dy=raw[1]-gesture.start[1];this.view.x-=dx;this.view.y-=dy;this.render();return;}
  if(gesture.kind==='line'){this.draft.cursor=this.snap(raw);this.render();return;}
  if(gesture.kind==='freehand'){if(this.draft.points.length<2400&&distance(raw,this.draft.points.at(-1))>.15)this.draft.points.push(this.bounded(raw));this.render();return;}
  const line=gesture.next.lines.find(line=>line.id===gesture.original.id),index=this._selection.nodeIndex;
  if(gesture.kind==='node')line.points[index]=this.snap(raw,line.id,index);
  else {
   const original=gesture.original.points,pivot=original[index],destination=this.snap([pivot[0]+raw[0]-gesture.start[0],pivot[1]+raw[1]-gesture.start[1]],line.id);let delta=destination.map((n,i)=>n-pivot[i]);
   for(let axis=0;axis<2;axis++)delta[axis]=Math.max(-Math.min(...original.map(p=>p[axis])),Math.min((axis?this.height:this.width)-Math.max(...original.map(p=>p[axis])),delta[axis]));
   line.points=original.map(p=>p.map((n,i)=>+(n+delta[i]).toFixed(7)));
  }
  gesture.moved=JSON.stringify(line.points)!==JSON.stringify(gesture.original.points);this.render();
 }
 pointerUp(event){
  const gesture=this.gesture;if(!gesture)return;this.gesture=null;
  if(gesture.kind==='pan')return;
  if(gesture.kind==='node'||gesture.kind==='move'){if(gesture.moved)this.commit(gesture.next);else this.render();return;}
  if(gesture.kind==='freehand'){this.finish();return;}
  if(gesture.kind==='line'){
   const point=this.snap(this.point(event));if(gesture.second||distance(gesture.start,this.point(event))*this.screenScale()>3){this.draft.points=[this.draft.points[0],point];this.finish();}else{this.draft.cursor=point;this.render();}
  }
 }
 keyDown(event){
  if(event.target!==this.svg)return;
  if(event.code==='Space'){this.space=true;event.preventDefault();return;}
  if(event.key==='Escape'){event.preventDefault();this.cancel();return;}
  if(event.key==='Enter'){event.preventDefault();this.finish();return;}
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();this.deleteSelected();return;}
  const movements={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(movements[event.key]&&this.selectedLine()&&this.editable()){
   event.preventDefault();const next=clone(this.drawing),line=next.lines.find(line=>line.id===this._selection.lineId),index=this._selection.nodeIndex,step=(this.grid||.1)*(event.shiftKey?10:1);line.points[index]=this.bounded(line.points[index].map((n,i)=>n+movements[event.key][i]*step));this.commit(next);
  }
 }
 render(){
  if(!this.svg||!this.view)return;const {x,y,width,height}=this.view;this.svg.setAttribute('viewBox',`${x} ${y} ${width} ${height}`);this.svg.style.cursor=this.space?'grab':this.tool==='select'?'default':'crosshair';
  const background=svgElement('g',{'aria-hidden':'true'});background.append(svgElement('rect',{x:0,y:0,width:this.width,height:this.height,fill:'#fffdf5',stroke:'#9a9588','stroke-width':1,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));
  const scale=this.screenScale(),grid=this.grid>=.25?this.grid:0;
  if(grid&&this.width/grid*this.height/grid<100000&&grid*scale>=6){const id=`grid-${this.instanceId||(this.instanceId=crypto.randomUUID())}`,defs=svgElement('defs'),pattern=svgElement('pattern',{id,width:grid,height:grid,patternUnits:'userSpaceOnUse'});pattern.append(svgElement('path',{d:`M${grid} 0H0V${grid}`,fill:'none',stroke:'#cbc6b8','stroke-width':.45,'vector-effect':'non-scaling-stroke'}));defs.append(pattern);background.append(defs,svgElement('rect',{width:this.width,height:this.height,fill:`url(#${id})`,'pointer-events':'none'}));}
  const waste=this.result?.drawing?.waste||[];
  if(Array.isArray(waste))for(const contour of waste){const rings=Array.isArray(contour?.[0]?.[0])?contour:[contour];if(rings.every(r=>Array.isArray(r)&&r.length&&Array.isArray(r[0])))background.append(svgElement('path',{d:rings.map(r=>pathData(r,true)).join(' '),fill:'#f3b576','fill-opacity':.45,'fill-rule':'evenodd',stroke:'none','pointer-events':'none'}));}
  const content=svgElement('g');
  if(!this.drawing.active){for(const line of this.result?.parts?.[0]?.paths||[])content.append(svgElement('path',{d:line.d,fill:'none',stroke:this.colors[line.operation]||'#555','stroke-width':1.3,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));}
  else {
   const displayed=this.gesture?.next?.lines||this.drawing.lines,errors=new Set((this.result?.drawing?.errors||[]).map(error=>error.lineId));
   for(const line of displayed){const selected=line.id===this._selection?.lineId,group=svgElement('g',{'data-line-id':line.id}),d=pathData(line.points,line.closed);
    if(selected||errors.has(line.id))group.append(svgElement('path',{d,fill:'none',stroke:errors.has(line.id)?'#e28a14':'#e7b13d','stroke-width':selected?7:5,'stroke-opacity':.6,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));
    group.append(svgElement('path',{d,fill:'none',stroke:this.colors[line.operation]||'#444','stroke-width':1.8,'stroke-dasharray':folded(line.operation)?'6 3':'none','vector-effect':'non-scaling-stroke','pointer-events':'none'}));
    group.append(svgElement('path',{d,fill:'none',stroke:'transparent','stroke-width':14,'vector-effect':'non-scaling-stroke','pointer-events':'stroke','data-line-id':line.id}));content.append(group);
   }
   const selected=displayed.find(line=>line.id===this._selection?.lineId);if(selected)for(const [i,point] of selected.points.entries())content.append(svgElement('circle',{cx:point[0],cy:point[1],r:5/scale,fill:i===this._selection.nodeIndex?'#285d40':'#fff',stroke:'#285d40','stroke-width':1.5,'vector-effect':'non-scaling-stroke','data-line-id':selected.id,'data-node-index':i,'aria-label':`Knoten ${i+1}`}));
   const anchor=this.drawing.anchor;if(anchor){const group=svgElement('g',{'pointer-events':'none'}),r=6/scale;group.append(svgElement('circle',{cx:anchor[0],cy:anchor[1],r,fill:'#f5df73',stroke:'#6d5822','stroke-width':1.5,'vector-effect':'non-scaling-stroke'}),svgElement('path',{d:`M${anchor[0]-r/2} ${anchor[1]}h${r}M${anchor[0]} ${anchor[1]-r/2}v${r}`,stroke:'#6d5822','stroke-width':1.2,'vector-effect':'non-scaling-stroke'}));content.append(group);}
  }
  if(this.draft){const points=[...this.draft.points];if(this.draft.cursor&&distance(points.at(-1),this.draft.cursor)>.001)points.push(this.draft.cursor);content.append(svgElement('path',{d:pathData(points),fill:'none',stroke:this.colors[this.operation],'stroke-width':2,'stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke','pointer-events':'none'}));for(const p of this.draft.points)content.append(svgElement('circle',{cx:p[0],cy:p[1],r:3/scale,fill:this.colors[this.operation],'pointer-events':'none'}));}
  this.svg.replaceChildren(background,content);
 }
 destroy(){this.abort.abort();this.host.replaceChildren();}
}
