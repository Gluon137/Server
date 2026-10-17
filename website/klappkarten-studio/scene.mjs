import * as THREE from '../baustein-studio/vendor/three.module.js';
import {OrbitControls} from '../baustein-studio/vendor/OrbitControls.js';
import {poseProject} from './geometry.mjs';

/** A paper preview; all panel positions come from the fabrication geometry. */
export class CardScene {
 captureReport(){return {position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray(),up:this.camera.up.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov,aspect:this.camera.aspect,near:this.camera.near,far:this.camera.far,zoom:this.camera.zoom};}
 reportPreview(){this.renderer.render(this.scene,this.camera);return this.renderer.domElement;}
  constructor(host, onSelect = () => {}) {
    this.host = host;
    this.onSelect = onSelect;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef0e6');
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 20000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-label', 'Räumliche Klappkarte. Mit der Maus drehen und zoomen.');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 8000;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b89d, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(-100, -250, 450);
    this.scene.add(light);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pickables = [];
    this.visible = false;
    this.down = null;
    host.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; });
    host.addEventListener('pointerup', e => {
      if (!this.down || Math.hypot(e.clientX-this.down[0], e.clientY-this.down[1]) > 5) return;
      this.down = null;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1), this.camera);
      const hit = this.raycaster.intersectObjects(this.pickables).find(hit=>hit.object.userData.surfaceId||hit.object.userData.lineId||hit.object.userData.structureId||hit.object.userData.figureId);
      const id=hit?.object.userData.surfaceId||hit?.object.userData.lineId||hit?.object.userData.structureId||hit?.object.userData.figureId;
      if (id) this.onSelect(id);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderLoop = () => {
      if (this.visible && !document.hidden) {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
      this.frame = requestAnimationFrame(this.renderLoop);
    };
    this.renderLoop();
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
  clear() {
    for (const object of [...this.group.children]) {
      object.geometry?.dispose();
      object.material?.dispose();
      this.group.remove(object);
    }
    this.pickables = [];
  }
  update(project, angle, selected) {
    this.project = project;
    this.clear();
    const posed = poseProject(project, angle);
    for (const panel of posed.panels) {
      const triangles = panel.triangles || [];
      if (!triangles.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(2), 3));
      geometry.computeVertexNormals();
      const chosen = (panel.surfaceId||panel.structureId||panel.figureId) === selected;
      const material = new THREE.MeshStandardMaterial({
        color: panel.color || (panel.role === 'card' ? '#faf9f0' : '#c6d6b2'),
        roughness: .9, side: THREE.DoubleSide,
        polygonOffset:true, polygonOffsetFactor: panel.role==='figure' ? -2 : 1,
        polygonOffsetUnits:1, emissive:chosen ? '#182010' : '#000000', emissiveIntensity:.12
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.figureId = panel.figureId;
      mesh.userData.structureId = panel.structureId;
      mesh.userData.surfaceId = panel.surfaceId;
      this.group.add(mesh);
      this.pickables.push(mesh);
      const loops = panel.polygons?.length ? panel.polygons : [panel.vertices];
      for (const loop of loops) {
        if (!Array.isArray(loop) || loop.length < 2 || !Array.isArray(loop[0])) continue;
        // Polygons from the kinematic model are already in world millimetres.
        if (loop[0].length !== 3) continue;
        const edge = new THREE.BufferGeometry().setFromPoints([...loop, loop[0]].map(p => new THREE.Vector3(...p)));
        this.group.add(new THREE.Line(edge, new THREE.LineBasicMaterial({color:chosen ? '#315b30' : '#76846b', transparent:true, opacity:.7})));
      }
    }
    const colors={CUT:project.colors.cut,FOLD_MOUNTAIN:project.colors.mountain,FOLD_VALLEY:project.colors.valley,ENGRAVE:project.colors.engrave};
    for(const line of posed.lines||[]){
      const geometry=new THREE.BufferGeometry().setFromPoints(line.points.map(p=>new THREE.Vector3(...p)));
      const object=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:line.lineId===selected?'#24594b':colors[line.operation],transparent:true,opacity:.85}));
      object.userData.lineId=line.lineId;this.group.add(object);this.pickables.push(object);
    }
    return posed;
  }
  fit() {
    if (!this.project) return;
    const {width,half} = this.project.card;
    const center = new THREE.Vector3(width/2, 0, half*.18);
    const radius = Math.hypot(width/2, half, half*.5);
    const distance = radius / Math.sin(this.camera.fov*Math.PI/360) / Math.min(1,this.camera.aspect) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.set(.8,1.5,1.15).normalize().multiplyScalar(distance).add(center);
    this.controls.update();
  }
  setVisible(value) { this.visible = value; if(value) this.resize(); }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
