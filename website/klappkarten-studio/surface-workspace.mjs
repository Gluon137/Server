import {SurfaceEditor} from './surface-editor.mjs';
import {newSurface} from './surface.mjs';
const $=id=>document.getElementById(id);
const svgNode=(name,attributes={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;};

/** Coordinates the spatial design transaction and its live fabrication drawing. */
export class SurfaceWorkspace {
  constructor({getProject,getResult,edit,run,setView,status,onDraftChange}) {
    Object.assign(this,{getProject,getResult,edit,run,setView,status,onDraftChange});
    this.selectedId=null;this.flushing=false;this.frame=0;this.angle=90;this.direction=-1;
    const action=fn=>run(fn);
    const netId=event=>event.target.closest?.('[data-surface]')?.dataset.surface;
    const selectNet=id=>action(async()=>{await this.finishDraft();this.select(id);});
    // Property blur may rebuild the SVG between press and release. Keep the
    // surface identity on the stable host so that selection still completes.
    $('surfaceNet').addEventListener('pointerdown',event=>{if(event.button===0)this.netPressed=netId(event);});
    $('surfaceNet').addEventListener('pointerup',event=>{const id=netId(event);if(event.button===0&&id&&id===this.netPressed)selectNet(id);this.netPressed=null;});
    $('surfaceNet').addEventListener('pointercancel',()=>{this.netPressed=null;});
    $('surfaceNet').addEventListener('keydown',event=>{const id=netId(event);if(id&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectNet(id);}});
    $('surfaceNet').addEventListener('click',event=>{const id=netId(event);if(id&&event.detail===0)selectNet(id);});
    for(const button of document.querySelectorAll('[data-surface-tool]'))button.addEventListener('click',()=>action(async()=>{
      await this.finishDraft();this.stop();this.setAngle(90);this.editor?.setTool(button.dataset.surfaceTool);this.syncTools();
    }));
    const plane=()=>{const orientation=$('surfaceOrientation').value,offset=Number($('surfaceOffset').value);return action(async()=>{await this.finishDraft();this.stop();this.setAngle(90);this.editor?.setPlane(orientation,offset);this.syncPlane();});};
    $('surfaceOrientation').addEventListener('change',plane);$('surfaceOffset').addEventListener('change',plane);
    $('surfacePlaneSlider').addEventListener('input',()=>{$('surfaceOffset').value=$('surfacePlaneSlider').value;plane();});
    $('surfaceGrid').addEventListener('change',()=>{this.editor?.setGrid(Number($('surfaceGrid').value));});
    $('surfaceFinish').addEventListener('click',()=>action(()=>this.finishDraft()));
    $('surfaceCancel').addEventListener('click',()=>{if(!this.editor?.busy)this.editor?.cancel();});
    $('surfaceFit').addEventListener('click',()=>this.editor?.fit());
    $('surfaceList').addEventListener('change',()=>{const id=$('surfaceList').value;return action(async()=>{await this.finishDraft();this.select(id);});});
    for(const[id,key]of Object.entries({surfaceName:'name',surfaceSelectedOffset:'offset',surfaceSupportWidth:'supportWidth',surfaceColor:'color'}))$(id).addEventListener('change',()=>action(async()=>{
      const targetId=this.selectedId;
      const value=['offset','supportWidth'].includes(key)?Number($(id).value):$(id).value;
      await edit(p=>{const shape=p.surface?.shapes.find(item=>item.id===targetId);if(shape)shape[key]=value;});
      this.select(targetId);
    }));
    $('surfaceDelete').addEventListener('click',()=>action(()=>{const targetId=this.selectedId;return edit(p=>{p.surface.shapes=p.surface.shapes.filter(item=>item.id!==targetId);});}));
    $('surfaceDuplicate').addEventListener('click',()=>action(async()=>{
      const targetId=this.selectedId;let id;await edit(p=>{const source=p.surface.shapes.find(item=>item.id===targetId);if(!source)return;const copy=newSurface({...structuredClone(source),id:crypto.randomUUID(),name:source.name+' Kopie',contours:source.contours.map(ring=>ring.map(([x,q])=>[x+10,q]))});id=copy.id;p.surface.shapes.push(copy);});this.select(id);
    }));
    for(const[id,delta]of [['surfaceEarlier',-1],['surfaceLater',1]])$(id).addEventListener('click',()=>action(()=>{const targetId=this.selectedId;return edit(p=>{
      const list=p.surface.shapes,index=list.findIndex(item=>item.id===targetId),other=index+delta;
      if(index>=0&&other>=0&&other<list.length)[list[index],list[other]]=[list[other],list[index]];
    });}));
    $('startSurface').addEventListener('click',()=>action(async()=>{
      await edit(p=>{p.surface={active:true,shapes:[]};});this.selectedId=null;await setView('surface');this.setAngle(90);this.editor?.setTool('polygon');this.syncTools();status('Auf der Zeichenebene die Eckpunkte setzen und mit Fertig übernehmen.');
    }));
    $('resumeSurface').addEventListener('click',()=>action(async()=>{await edit(p=>{if(p.surface)p.surface.active=true;});await setView('surface');this.setAngle(90);}));
    $('surfaceLegacy').addEventListener('click',()=>action(async()=>{
      await edit(p=>{if(p.surface)p.surface.active=false;});await setView(this.getProject().drawing?.active?'card':this.getProject().structures?.length?'kirigami':'design');
    }));
    $('surfaceAngle').addEventListener('input',()=>action(async()=>{const angle=Number($('surfaceAngle').value);await this.finishDraft();this.stop();this.setAngle(angle);}));
    $('surfaceEditPose').addEventListener('click',()=>{this.stop();this.setAngle(90);});
    $('surfacePlay').addEventListener('click',()=>action(async()=>{
      await this.finishDraft();if(this.frame){this.stop();return;}
      let previous=0;const step=time=>{const dt=previous?Math.min(.06,(time-previous)/1000):0;previous=time;let value=this.angle+this.direction*dt*45;if(value<=0){value=0;this.direction=1;}if(value>=180){value=180;this.direction=-1;}this.setAngle(value);this.frame=requestAnimationFrame(step);};
      $('surfacePlay').textContent='Ⅱ Pause';this.frame=requestAnimationFrame(step);
    }));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
  }
  get active(){return !!this.getProject().surface?.active;}
  get draft(){return this.editor?.draft;}
  get busy(){return this.editor?.busy;}
  async finishDraft() {
    if(this.flushing||!this.editor?.draft||this.editor.busy)return;
    this.flushing=true;
    try{if(!await this.editor.finish()||this.editor.draft)throw new Error('Die offene Fläche bitte vervollständigen oder mit Abbrechen verwerfen.');}
    finally{this.flushing=false;}
  }
  cancel(){this.editor?.cancel();}
  stop(){cancelAnimationFrame(this.frame);this.frame=0;$('surfacePlay').textContent='▶ Aufklappen';}
  show() {
    if(!this.editor)try{
      this.editor=new SurfaceEditor($('surfaceCanvas'),{
        onChange:shape=>{
          const change=()=>this.edit(p=>{if(!p.surface?.active)throw new Error('Zuerst einen Flächenentwurf beginnen.');const index=p.surface.shapes.findIndex(item=>item.id===shape.id);if(index<0)p.surface.shapes.push(shape);else p.surface.shapes[index]=shape;});
          return this.flushing?change():this.run(change,true);
        },
        onSelect:id=>{this.selectedId=id;this.syncProperties();this.net();this.syncPlane();},onStatus:message=>this.status(message),onDraftChange:active=>this.onDraftChange(active)
      });
      this.editor.setPlane($('surfaceOrientation').value,Number($('surfaceOffset').value));this.editor.setGrid(Number($('surfaceGrid').value));
    }catch(error){$('surfaceCanvas').textContent='Die räumliche Gestaltung benötigt WebGL: '+error.message;this.status(error.message,true);return;}
    this.editor.update(this.getProject(),this.getResult(),this.selectedId);this.editor.view.setVisible(true);this.editor.view.resize();this.syncTools();this.syncPlane();
  }
  select(id) {
    this.stop();this.selectedId=id||null;this.setAngle(90);this.editor?.setSelection(id);this.syncProperties();this.net();this.syncPlane();
  }
  setAngle(value) {
    const next=Math.max(0,Math.min(180,value));if(this.editor?.setAngle(next)===false)return;
    this.angle=next;$('surfaceAngle').value=String(Math.round(next));$('surfaceAngleValue').textContent=Math.round(next)+'°';this.syncTools();
  }
  syncPlane() {
    const orientation=this.editor?.orientation||$('surfaceOrientation').value,offset=this.editor?.offset??Number($('surfaceOffset').value);
    $('surfaceOrientation').value=orientation;$('surfaceOffset').value=offset;$('surfacePlaneSlider').value=offset;
    $('surfaceOffsetLabel').textContent=orientation==='vertical'?'Abstand zur Rückwand':'Höhe über Kartenboden';
  }
  syncTools() {
    for(const button of document.querySelectorAll('[data-surface-tool]')){button.disabled=!this.active;button.setAttribute('aria-pressed',String(this.editor?.tool===button.dataset.surfaceTool));}
    $('surfaceFinish').disabled=!this.active||!this.draft;$('surfaceCancel').disabled=!this.draft;
    $('surfaceHelp').textContent=Math.abs(this.angle-90)>.01?'Zum Bearbeiten „90° · Zeichnen“ wählen. Rechts ziehen dreht die Ansicht.':'Links: zeichnen oder Eckpunkte verschieben · Rechts ziehen: drehen · Mausrad: zoomen · Enter: übernehmen · Escape: abbrechen';
  }
  syncProperties() {
    const shapes=this.getProject().surface?.shapes||[];if(!shapes.some(item=>item.id===this.selectedId))this.selectedId=null;
    const shape=shapes.find(item=>item.id===this.selectedId);
    $('surfaceList').replaceChildren(...[...shapes].reverse().map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;return option;}));$('surfaceList').value=this.selectedId||'';
    $('surfaceSelectionStatus').textContent=shape?`${shape.orientation==='vertical'?'Senkrechte':'Waagerechte'} Fläche · ${shape.contours.reduce((n,r)=>n+r.length,0)} Eckpunkte`:'Fläche im Raum oder im Schnittbogen auswählen.';
    for(const[id,key]of Object.entries({surfaceName:'name',surfaceSelectedOffset:'offset',surfaceSupportWidth:'supportWidth',surfaceColor:'color'})){$(id).disabled=!shape||!this.active;$(id).value=shape?.[key]??(key==='color'?'#b3c49d':'');}
    $('surfaceSelectedOffsetLabel').textContent=shape?.orientation==='horizontal'?'Höhe über Boden':'Abstand zur Rückwand';
    for(const id of ['surfaceDuplicate','surfaceDelete','surfaceEarlier','surfaceLater'])$(id).disabled=!shape||!this.active;
    const index=shapes.findIndex(item=>item.id===this.selectedId);$('surfaceEarlier').disabled||=index<=0;$('surfaceLater').disabled||=index>=shapes.length-1;
  }
  sync(view) {
    const project=this.getProject(),show=view==='surface'||this.active;
    document.body.classList.toggle('surface-mode',show);$('surfaceSettings').hidden=!show;$('surfaceTools').hidden=!show;
    $('surfaceReadOnly').hidden=this.active;$('surfaceLegacy').hidden=!this.active&&!(view==='surface'&&(project.figures.length||project.structures.length||project.drawing));
    $('resumeSurface').hidden=this.active||!project.surface;
    const max=Math.max(1,project.card.half-3);for(const id of ['surfaceOffset','surfacePlaneSlider','surfaceSelectedOffset'])$(id).max=max;
    this.syncProperties();this.syncTools();
    if(this.editor){this.editor.update(project,this.getResult(),this.selectedId);this.editor.view.setVisible(view==='surface');}
    if(show)this.net();
  }
  net() {
    const result=this.getResult(),host=$('surfaceNet');host.replaceChildren();if(!result)return;
    const project=this.getProject(),part=result.parts[0];if(!part)return;
    const svg=svgNode('svg',{viewBox:`-3 -3 ${part.width+6} ${part.height+6}`,role:'img','aria-label':'Schnittbogen der räumlichen Flächen'});
    const colors={CUT:project.colors.cut,FOLD_MOUNTAIN:project.colors.mountain,FOLD_VALLEY:project.colors.valley,ENGRAVE:project.colors.engrave};
    const link=(node,id)=>{node.dataset.surface=id;node.dataset.selected=String(id===this.selectedId);node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label','Zugehörige Fläche auswählen');};
    for(const face of result.surface?.panels||[]){
      const d=face.source.flat().map(ring=>'M'+ring.map(([x,t])=>`${x} ${t+project.card.half}`).join('L')+'Z').join('');
      const fill=svgNode('path',{d,fill:face.color,'fill-opacity':face.surfaceId===this.selectedId ? .55 : .2,'fill-rule':'evenodd',stroke:'none','data-surface-fill':'true',style:'pointer-events:fill'});link(fill,face.surfaceId);svg.append(fill);
    }
    for(const item of part.paths){
      const path=svgNode('path',{d:item.d,fill:'none',stroke:colors[item.operation],'stroke-width':.3,'data-operation':item.operation});
      if(item.surfaceId)link(path,item.surfaceId);
      svg.append(path);
    }
    host.append(svg);$('surfaceNetStatus').textContent=result.errors.length?'Geometriefehler: Die betroffenen Flächen korrigieren. Export gesperrt.':this.active?'Schnitte, Falze und Papierverbindungen stammen aus demselben Modell.':'Bestehender Entwurf · zum Zeichnen einen Flächenentwurf beginnen.';
  }
}
