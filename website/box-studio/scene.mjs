import * as THREE from 'three';
import {OrbitControls} from '../baustein-studio/vendor/OrbitControls.js';

export function surfacePoint(part,x,y,z=0){
 if(part.surface?.type==='wrap'){
  const samples=part.surface.samples;let i=1;while(i<samples.length-1&&samples[i].s<x)i++;
  const a=samples[i-1],b=samples[i],t=Math.max(0,Math.min(1,(x-a.s)/(b.s-a.s||1)));
  return [a.x+(b.x-a.x)*t+z*(a.nx+(b.nx-a.nx)*t),a.y+(b.y-a.y)*t+z*(a.ny+(b.ny-a.ny)*t),(part.surface.z||0)+y];
 }
 const f=part.frame;return f.origin.map((n,i)=>n+f.u[i]*x+f.v[i]*y+f.normal[i]*z);
}
// Clip triangles into narrow bands in the flat sheet to follow curved segments,
// including the borders of openings, instead of connecting seam endpoints.
export function refineWrapGeometry(geometry,step){
 const source=geometry.index?geometry.toNonIndexed():geometry,positions=source.attributes.position,vertices=[];
 const clip=(polygon,edge,keepAbove)=>{const result=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=keepAbove?a[0]>=edge:a[0]<=edge,insideB=keepAbove?b[0]>=edge:b[0]<=edge;if(insideA)result.push(a);if(insideA!==insideB){const ratio=(edge-a[0])/(b[0]-a[0]);result.push(a.map((n,j)=>n+(b[j]-n)*ratio));}}return result;};
 for(let i=0;i<positions.count;i+=3){const point=n=>[positions.getX(n),positions.getY(n),positions.getZ(n)],triangle=[point(i),point(i+1),point(i+2)],min=Math.min(...triangle.map(p=>p[0])),max=Math.max(...triangle.map(p=>p[0]));for(let strip=Math.floor(min/step);strip<=Math.floor(max/step);strip++){const polygon=clip(clip(triangle,strip*step,true),(strip+1)*step,false);for(let j=1;j<polygon.length-1;j++)vertices.push(...polygon[0],...polygon[j],...polygon[j+1]);}}
 const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(source!==geometry)source.dispose();geometry.dispose();return result;
}
export function surfacePolyline(part,line,depth=0){
 const result=[];for(let i=0;i<line.length-1;i++){const a=line[i],b=line[i+1],count=part.surface?.type==='wrap'?Math.max(1,Math.ceil(Math.abs(b[0]-a[0])/2)):1;for(let j=0;j<count;j++){const t=j/count;result.push(new THREE.Vector3(...surfacePoint(part,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,depth)));}}if(line.length){const p=line.at(-1);result.push(new THREE.Vector3(...surfacePoint(part,p[0],p[1],depth)));}return result;
}
export class BoxScene{
 captureReport(){return {position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray(),up:this.camera.up.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov,aspect:this.camera.aspect,near:this.camera.near,far:this.camera.far,zoom:this.camera.zoom};}
 reportPreview(){this.renderer.render(this.scene,this.camera);return this.renderer.domElement;}
 constructor(host,onSelect){
  this.host=host;this.onSelect=onSelect;this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(36,1,.1,50000);this.camera.up.set(0,0,1);this.camera.position.set(300,-400,300);
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','Kästchen drehen und zoomen; Bauteile anklicken');this.renderer.domElement.tabIndex=0;
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.scene.add(new THREE.HemisphereLight(0xffffff,0x8c997d,2.7));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(-200,-300,500);this.scene.add(light);this.group=new THREE.Group();this.scene.add(this.group);this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.meshes=[];
  this.down=null;host.addEventListener('pointerdown',e=>{this.down={x:e.clientX,y:e.clientY};});host.addEventListener('pointerup',e=>{if(!this.down||Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>5)return;this.down=null;const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hit=this.ray.intersectObjects(this.meshes.filter(m=>m.parent.visible))[0];if(hit)this.onSelect(hit.object.userData.partId);});
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.animate();
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
 animate(){this.controls.update();this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(()=>this.animate());}
 update(project,response,options={}){
  this.project=project;this.response=response;this.options=options;for(const child of [...this.group.children]){child.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.group.remove(child);}this.meshes=[];
  const errors=new Set((response?.errors||[]).flatMap(e=>e.partIds||[]));for(const [index,part] of (response?.parts||[]).entries()){
   if(!part.nominal?.length||!part.frame)continue;
   try{
    const shape=new THREE.Shape(part.nominal.map(p=>new THREE.Vector2(...p)));for(const loop of part.nominalHoles||[])if(loop.length>2)shape.holes.push(new THREE.Path(loop.map(p=>new THREE.Vector2(...p))));
    let geometry=new THREE.ExtrudeGeometry(shape,{depth:part.thickness||project.material.thickness,bevelEnabled:false,curveSegments:1,steps:1});if(part.surface?.type==='wrap')geometry=refineWrapGeometry(geometry,Math.max(1,(part.bounds[2]-part.bounds[0])/220));
    const positions=geometry.attributes.position;for(let i=0;i<positions.count;i++)positions.setXYZ(i,...surfacePoint(part,positions.getX(i),positions.getY(i),positions.getZ(i)));geometry.computeVertexNormals();geometry.computeBoundingBox();
    const group=new THREE.Group();group.userData.part=part;group.userData.center=geometry.boundingBox.getCenter(new THREE.Vector3());this.group.add(group);const material=new THREE.MeshStandardMaterial({color:errors.has(part.id)?0xd88e70:part.id===options.selected?0xc2d894:[0xe5dcbc,0xd8e2c4,0xd7dfc2,0xe8d5b5][index%4],roughness:.85,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);mesh.userData.partId=part.id;group.add(mesh);this.meshes.push(mesh);group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry,30),new THREE.LineBasicMaterial({color:part.id===options.selected?0x24594b:0x7a876b,transparent:true,opacity:.65})));
    for(const line of [...(part.engrave||[]),...(part.flexCuts||[])]){if(line.length<2)continue;const points=surfacePolyline(part,line,(part.thickness||project.material.thickness)+.08);group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x6b6c4b})));}
   }catch(error){console.warn('Bauteilvorschau:',part.id,error.message);}
  }
  const bodyBounds=new THREE.Box3();for(const mesh of this.meshes)if(['bottom','front','back','left','right','wrap','lid'].includes(mesh.userData.partId))bodyBounds.union(mesh.geometry.boundingBox);this.modelCenter=bodyBounds.getCenter(new THREE.Vector3());
  this.pose(options.motion||{});if(!this.hasFitted&&this.meshes.length){this.fit();this.hasFitted=true;}
 }
 pose(values={}){
  const {selected,hidden=new Set(),hideWalls,explode=0}=this.options||{};const joints=this.response?.joints||[];const size=Math.max(this.project?.box.width||200,this.project?.box.depth||140,this.project?.box.height||100);
  for(const group of this.group.children){const part=group.userData.part;group.matrixAutoUpdate=false;group.matrix.identity();for(const joint of joints.filter(j=>j.partIds?.includes(part.id))){const value=values[joint.id]??joint.value??0,axis=new THREE.Vector3(...joint.axis).normalize();let transform;if(joint.type==='slider')transform=new THREE.Matrix4().makeTranslation(...axis.multiplyScalar(value).toArray());else{const p=new THREE.Vector3(...joint.pivot);transform=new THREE.Matrix4().makeTranslation(...p.toArray()).multiply(new THREE.Matrix4().makeRotationAxis(axis,value*Math.PI/180)).multiply(new THREE.Matrix4().makeTranslation(...p.negate().toArray()));}group.matrix.premultiply(transform);}
   if(explode){const n=new THREE.Vector3(...part.frame.normal);if(part.id==='wrap')n.set(1,0,0);n.transformDirection(group.matrix);
    // Material extrusion normals can point inward; explosion must point away from the box.
    const away=group.userData.center.clone().applyMatrix4(group.matrix).sub(this.modelCenter);if(n.dot(away)<0)n.negate();
    group.matrix.premultiply(new THREE.Matrix4().makeTranslation(...n.multiplyScalar(explode/100*size*.65).toArray()));}
   group.visible=!hidden.has(part.id)&&!(hideWalls&&['front','back','left','right','wrap'].includes(part.id));group.matrixWorldNeedsUpdate=true;
  }
 }
 fit(preset='iso'){
  const box=new THREE.Box3().setFromObject(this.group),center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3()),radius=Math.max(40,box.isEmpty()?160:box.getSize(new THREE.Vector3()).length()/2),dir={iso:[1,-1.5,1.1],front:[0,-1,.001],top:[.001,0,1]}[preset]||[1,-1.5,1.1];this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(...dir).normalize().multiplyScalar(radius/Math.sin(Math.min(this.camera.fov*Math.PI/360,Math.atan(Math.tan(this.camera.fov*Math.PI/360)*this.camera.aspect)))*1.12));this.camera.far=Math.max(50000,radius*20);this.camera.updateProjectionMatrix();this.controls.update();
 }
}
