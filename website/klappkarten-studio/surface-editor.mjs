import * as THREE from '../baustein-studio/vendor/three.module.js';
import {CardScene} from './scene.mjs';

const clone=value=>structuredClone(value);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

/** Draw original design faces at their 90-degree construction position. */
export class SurfaceEditor {
  constructor(host,{onChange=()=>{},onSelect=()=>{},onStatus=()=>{},onDraftChange=()=>{}}={}) {
    this.host=host;this.onChange=onChange;this.onSelect=onSelect;this.onStatus=onStatus;this.onDraftChange=onDraftChange;
    this.tool='select';this.orientation='vertical';this.offset=20;this.grid=5;this.angle=90;this.selectedId=null;this.shapes=[];this._draft=null;this.gesture=null;this.busy=false;this.visible=true;
    this.view=new CardScene(host);this.canvas=this.view.renderer.domElement;
    this.canvas.dataset.surfaceEditor='true';this.canvas.setAttribute('aria-label','Flächen im Raum zeichnen. Linke Maustaste zeichnet oder wählt aus, rechte Maustaste dreht. Enter übernimmt, Escape bricht ab.');
    this.canvas.style.touchAction='none';
    this.view.controls.mouseButtons.LEFT=null;
    this.view.controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
    this.view.controls.mouseButtons.MIDDLE=THREE.MOUSE.DOLLY;
    this.overlay=new THREE.Group();this.view.scene.add(this.overlay);
    this.raycaster=new THREE.Raycaster();this.abort=new AbortController();const options={signal:this.abort.signal,capture:true};
    this.canvas.addEventListener('pointerdown',event=>this.pointerDown(event),options);
    this.canvas.addEventListener('pointermove',event=>this.pointerMove(event),options);
    this.canvas.addEventListener('pointerup',event=>this.pointerUp(event),options);
    this.canvas.addEventListener('pointercancel',event=>{if(event.button===0||this.gesture){this.gesture=null;this.renderOverlay();}},options);
    this.canvas.addEventListener('keydown',event=>this.keyDown(event),{signal:this.abort.signal});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault(),{signal:this.abort.signal});
    host.__surfaceEditor=this;
    this.view.setVisible(this.visible);this.renderOverlay();
  }
  get draft(){return this._draft;}
  get selection(){return this.selectedId;}
  update(project,result,selectedId=this.selectedId) {
    this.project=project;this.result=result;this.shapes=clone(project.surface?.shapes||[]);
    this.selectedId=this.shapes.some(shape=>shape.id===selectedId)?selectedId:null;
    this.view.update(project,this.angle,this.selectedId);
    this.view.setVisible(this.visible);this.renderOverlay();
    if(!this.fitted){this.fit();this.fitted=true;}
  }
  setPlane(orientation,offset) {
    if(!['vertical','horizontal'].includes(orientation)||!Number.isFinite(Number(offset))||Number(offset)<=0)return false;
    if(this._draft&&(orientation!==this.orientation||Number(offset)!==this.offset)) {
      this.onStatus('Die offene Fläche zuerst mit Fertig übernehmen oder mit Escape abbrechen.');return false;
    }
    this.orientation=orientation;this.offset=Number(offset);this.renderOverlay();return true;
  }
  setTool(tool) {
    if(!['select','polygon','rectangle'].includes(tool))return false;
    if(this._draft&&tool!==this.tool){this.onStatus('Die offene Fläche zuerst mit Fertig übernehmen oder mit Escape abbrechen.');return false;}
    this.tool=tool;this.renderOverlay();return true;
  }
  setGrid(mm){this.grid=Number.isFinite(Number(mm))&&Number(mm)>0?Number(mm):0;this.renderOverlay();}
  setAngle(degrees) {
    if(!Number.isFinite(Number(degrees)))return;
    if(this._draft&&Number(degrees)!==90){this.onStatus('Die offene Fläche zuerst übernehmen oder abbrechen.');return false;}
    this.angle=Math.max(0,Math.min(180,Number(degrees)));
    if(this.project)this.view.update(this.project,this.angle,this.selectedId);
    this.renderOverlay();return true;
  }
  setSelection(id) {
    const shape=this.shapes.find(item=>item.id===id);
    this.selectedId=shape?.id||null;
    if(shape&&!this._draft){this.orientation=shape.orientation;this.offset=shape.offset;}
    if(this.project)this.view.update(this.project,this.angle,this.selectedId);
    this.renderOverlay();this.onSelect(this.selectedId);
  }
  fit(){this.view.resize();this.view.fit();this.view.camera.updateMatrixWorld();this.renderOverlay();}
  setVisible(value){this.visible=!!value;this.view.setVisible(this.visible);if(value)this.renderOverlay();}
  world(point,orientation=this.orientation,offset=this.offset) {
    return new THREE.Vector3(point[0],orientation==='vertical'?offset:point[1],orientation==='vertical'?point[1]:offset);
  }
  projectPoint(point) {
    this.view.camera.updateMatrixWorld();
    const position=this.world(point).project(this.view.camera),rect=this.canvas.getBoundingClientRect();
    return {x:rect.left+(position.x+1)*rect.width/2,y:rect.top+(1-position.y)*rect.height/2};
  }
  ray(event) {
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
    this.view.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),this.view.camera);
    return this.raycaster;
  }
  point(event,orientation=this.orientation,offset=this.offset) {
    const raycaster=this.ray(event);if(!raycaster)return null;
    const normal=orientation==='vertical'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
    if(Math.abs(raycaster.ray.direction.dot(normal))<1e-5)return null;
    const intersection=raycaster.ray.intersectPlane(new THREE.Plane(normal,-offset),new THREE.Vector3());
    if(!intersection||!Number.isFinite(intersection.x+intersection.y+intersection.z))return null;
    const maximum=this.project?.card||{width:148,half:105};
    return [intersection.x,orientation==='vertical'?intersection.z:intersection.y].map((value,index)=>{
      const snapped=this.grid?Math.round(value/this.grid)*this.grid:value;
      return +Math.max(0,Math.min(index?maximum.half:maximum.width,snapped)).toFixed(6);
    });
  }
  setDraft(draft) {
    const changed=!!this._draft!==!!draft;this._draft=draft;
    if(changed)this.onDraftChange(!!draft);this.renderOverlay();
  }
  editable() {
    if(this.busy)return false;
    if(!this.project?.surface?.active){this.onStatus('Zuerst einen Flächenentwurf beginnen.');return false;}
    if(Math.abs(this.angle-90)>.001){this.onStatus('Zum Zeichnen die Karte auf 90° aufstellen.');return false;}
    return true;
  }
  async finish() {
    if(!this._draft)return true;if(!this.editable())return false;
    const draft=clone(this._draft);let shape;
    if(draft.kind==='edit')shape=draft.shape;
    else {
      let points=draft.points.filter((point,index,array)=>!index||distance(point,array[index-1])>1e-6);
      if(draft.type==='rectangle') {
        if(points.length<2){this.onStatus('Die gegenüberliegende Ecke des Rechtecks setzen.');return false;}
        const [a,b]=points;points=[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]];
      }
      if(points.length>2&&distance(points[0],points.at(-1))<1e-6)points.pop();
      const area=Math.abs(points.reduce((sum,p,index)=>{const q=points[(index+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
      if(points.length<3||area<.01){this.onStatus('Eine Fläche mit mindestens drei nicht auf einer Geraden liegenden Punkten zeichnen.');return false;}
      this._draft.id??=`surface-${crypto.randomUUID()}`;
      shape={id:this._draft.id,name:`Fläche ${this.shapes.length+1}`,orientation:draft.orientation,offset:draft.offset,contours:[points],supportWidth:3,color:'#aec594'};
    }
    this.busy=true;
    try {
      await this.onChange(clone(shape));
      this.setDraft(null);this.selectedId=shape.id;
      if(this.project)this.view.update(this.project,this.angle,this.selectedId);
      this.onSelect(shape.id);return true;
    } catch(error) {
      this.onStatus(error?.message||'Die Fläche konnte noch nicht übernommen werden. Die Zeichnung bleibt erhalten.');return false;
    } finally {this.busy=false;this.renderOverlay();}
  }
  cancel(){this.gesture=null;this.setDraft(null);}
  pointerDown(event) {
    if(event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();this.canvas.focus({preventScroll:true});
    if(!this.editable())return;
    this.canvas.setPointerCapture(event.pointerId);
    if(this.tool==='select') {
      if(this._draft){this.onStatus('Die offene Änderung zuerst übernehmen oder abbrechen.');return;}
      let nearest=null,best=11;
      const shape=this.shapes.find(item=>item.id===this.selectedId);
      if(shape)for(let ring=0;ring<shape.contours.length;ring++)for(let index=0;index<shape.contours[ring].length;index++) {
        const position=this.world(shape.contours[ring][index],shape.orientation,shape.offset).project(this.view.camera),rect=this.canvas.getBoundingClientRect();
        const d=Math.hypot(event.clientX-(rect.left+(position.x+1)*rect.width/2),event.clientY-(rect.top+(1-position.y)*rect.height/2));
        if(d<best){best=d;nearest={ring,index};}
      }
      if(nearest){this.gesture={kind:'vertex',shape:clone(shape),...nearest,start:[event.clientX,event.clientY],moved:false};return;}
      const hit=this.ray(event)?.intersectObjects(this.view.pickables).find(item=>item.object.userData.surfaceId||item.object.userData.sourceSurfaceId);
      this.setSelection(hit?.object.userData.surfaceId||hit?.object.userData.sourceSurfaceId||null);return;
    }
    const point=this.point(event);if(!point){this.onStatus('Die Zeichenebene wird von der Seite gesehen. Die Ansicht etwas drehen.');return;}
    if(!this._draft)this.setDraft({type:this.tool,points:[],orientation:this.orientation,offset:this.offset});
    if(this._draft.kind==='edit')return;
    if(this._draft.points.length>=256){this.onStatus('Maximal 256 Eckpunkte pro gezeichneter Fläche.');return;}
    if(!this._draft.points.length||distance(point,this._draft.points.at(-1))>1e-6)this._draft.points.push(point);
    this._draft.cursor=point;
    if(this.tool==='rectangle')this.gesture={kind:'rectangle',start:[event.clientX,event.clientY],second:this._draft.points.length>=2};
    this.renderOverlay();
  }
  pointerMove(event) {
    if(this.busy)return;
    if(this.gesture?.kind==='vertex') {
      event.stopImmediatePropagation();const gesture=this.gesture;
      const point=this.point(event,gesture.shape.orientation,gesture.shape.offset);if(!point)return;
      gesture.shape.contours[gesture.ring][gesture.index]=point;
      gesture.moved=Math.hypot(event.clientX-gesture.start[0],event.clientY-gesture.start[1])>2;
      this.renderOverlay();return;
    }
    if(this._draft&&!this._draft.kind) {
      const point=this.point(event,this._draft.orientation,this._draft.offset);if(point){this._draft.cursor=point;this.renderOverlay();}
    }
  }
  pointerUp(event) {
    if(event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
    const gesture=this.gesture;this.gesture=null;
    if(gesture?.kind==='vertex'&&gesture.moved){this.setDraft({kind:'edit',shape:gesture.shape});void this.finish();}
    else if(gesture?.kind==='rectangle'&&this._draft) {
      if(gesture.second){void this.finish();return;}
      if(Math.hypot(event.clientX-gesture.start[0],event.clientY-gesture.start[1])>4) {
        const point=this.point(event,this._draft.orientation,this._draft.offset);
        if(point){this._draft.points.push(point);void this.finish();}
      }
    }
    this.renderOverlay();
  }
  keyDown(event) {
    if(event.target!==this.canvas)return;
    if(event.key==='Escape'){event.preventDefault();if(!this.busy)this.cancel();}
    else if(event.key==='Enter'){event.preventDefault();void this.finish();}
    else if(event.key==='Backspace'&&this._draft&&!this._draft.kind){event.preventDefault();this._draft.points.pop();this.renderOverlay();}
  }
  clearOverlay() {
    for(const object of [...this.overlay.children]){object.geometry?.dispose();object.material?.dispose();this.overlay.remove(object);}
  }
  line(points,color,opacity=1,closed=false,orientation=this.orientation,offset=this.offset) {
    if(points.length<2)return;
    const vertices=(closed?[...points,points[0]]:points).map(point=>this.world(point,orientation,offset));
    const object=new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false}));
    object.renderOrder=5;this.overlay.add(object);
  }
  renderOverlay() {
    if(!this.overlay)return;this.clearOverlay();
    this.canvas.style.cursor=this.tool==='select'?'default':'crosshair';
    this.overlay.visible=Math.abs(this.angle-90)<.001;if(!this.overlay.visible)return;
    const {width,half}=this.project?.card||{width:148,half:105};
    const corners=[[0,0],[width,0],[width,half],[0,half]],points=corners.map(point=>this.world(point));
    const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([points[0],points[1],points[2],points[0],points[2],points[3]].flatMap(point=>point.toArray()),3));
    const plane=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#6b9b8b',transparent:true,opacity:.08,side:THREE.DoubleSide,depthWrite:false}));this.overlay.add(plane);
    this.line(corners,'#347765',.65,true);
    const step=Math.max(this.grid||10,Math.max(width,half)/100);
    for(let x=step;x<width;x+=step)this.line([[x,0],[x,half]],'#65958b',.22);
    for(let value=step;value<half;value+=step)this.line([[0,value],[width,value]],'#65958b',.22);
    const selected=this.gesture?.kind==='vertex'?this.gesture.shape:this._draft?.kind==='edit'?this._draft.shape:this.shapes.find(shape=>shape.id===this.selectedId);
    if(selected)for(const ring of selected.contours) {
      this.line(ring,'#174f42',1,true,selected.orientation,selected.offset);
      for(const point of ring) {
        const world=this.world(point,selected.orientation,selected.offset),distance=this.view.camera.position.distanceTo(world);
        const size=Math.max(.6,distance*Math.tan(this.view.camera.fov*Math.PI/360)*8/Math.max(200,this.host.clientHeight));
        const handle=new THREE.Mesh(new THREE.SphereGeometry(size,8,6),new THREE.MeshBasicMaterial({color:'#24594b',depthTest:false}));handle.position.copy(world);handle.renderOrder=10;this.overlay.add(handle);
      }
    }
    const draft=this._draft;if(draft&&!draft.kind) {
      let ring=draft.points;
      if(draft.type==='rectangle'&&ring.length) {
        const a=ring[0],b=ring[1]||draft.cursor||a;ring=[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]];
      } else if(draft.cursor)ring=[...ring,draft.cursor];
      this.line(ring,'#c77e22',1,ring.length>2,draft.orientation,draft.offset);
    }
  }
  destroy(){this.abort.abort();this.clearOverlay();this.view.scene.remove(this.overlay);this.view.destroy();if(this.host.__surfaceEditor===this)delete this.host.__surfaceEditor;}
}
