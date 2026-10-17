import {CardLineEditor} from '../card-editor.mjs';

export async function runCardEditorTests(){
 const assert=(condition,message)=>{if(!condition)throw new Error(message);},host=document.createElement('div');
 Object.assign(host.style,{position:'fixed',inset:'0',width:'800px',height:'700px',background:'white',zIndex:'99999'});document.body.append(host);
 const project={card:{width:148,half:105},drawing:{active:true,anchor:[140,200],custom:'preserved',lines:[]}},changes=[];
 const draftStates=[],editor=new CardLineEditor(host,{onChange:async drawing=>{changes.push(structuredClone(drawing));project.drawing=drawing;},onStatus:()=>{},onDraftChange:active=>draftStates.push(active)});
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 const pointer=(type,point,target=editor.svg)=>{const p=editor.svg.createSVGPoint();[p.x,p.y]=point;const q=p.matrixTransform(editor.svg.getScreenCTM());target.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:q.x,clientY:q.y,pointerId:1,button:0}));};
 // Synthetic pointer events have no active browser pointer capture.
 editor.svg.setPointerCapture=()=>{};
 try{
  editor.update(project,{parts:[{paths:[]}]});editor.setTool('line');
  pointer('pointerdown',[20,20]);pointer('pointerup',[20,20]);pointer('pointerdown',[60,20]);pointer('pointerup',[60,20]);await flush();
  assert(changes.length===1&&project.drawing.lines.length===1,'click-click line commits once');assert(project.drawing.custom==='preserved','drawing metadata retained');
  const first=project.drawing.lines[0];assert(first.points[0][0]===20&&first.points[1][0]===60,'millimetre coordinates');
  editor.setOperation('FOLD_MOUNTAIN');editor.setTool('freehand');assert(editor.tool==='line','folds stay straight');
  pointer('pointerdown',[30,30]);pointer('pointermove',[80,30]);pointer('pointerup',[80,30]);await flush();
  assert(project.drawing.lines[1].operation==='FOLD_MOUNTAIN'&&project.drawing.lines[1].angle===90,'fold target angle retained');
  editor.setTool('select');editor.setSelection(first.id,0);await editor.duplicateSelected();assert(project.drawing.lines.length===3,'duplicate selected');await editor.deleteSelected();assert(project.drawing.lines.length===2,'delete selected');
  editor.setSelection(first.id,0);await editor.addNode();assert(editor.selectedLine().points.length===3,'add midpoint');await editor.closeSelected();assert(editor.selectedLine().closed,'close cut contour');await editor.closeSelected();await editor.removeNode();assert(editor.selectedLine().points.length===2,'remove selected node');
  editor.zoom(2);editor.setTool('line');editor.setOperation('ENGRAVE');pointer('pointerdown',[100,50]);pointer('pointermove',[120,70]);pointer('pointerup',[120,70]);await flush();
  assert(project.drawing.lines.at(-1).points[0][0]===100&&project.drawing.lines.at(-1).points[1][1]===70,'zoom preserves physical coordinates');
  editor.setTool('polyline');for(const p of [[20,80],[40,80],[40,90]]){pointer('pointerdown',p);pointer('pointerup',p);}await editor.finish();assert(project.drawing.lines.at(-1).points.length===3,'polyline completes');
  const count=changes.length;editor.setTool('line');pointer('pointerdown',[50,100]);pointer('pointerup',[50,100]);
  const draft=JSON.stringify(editor.draft);project.colors={cut:'#f01234'};editor.update(project,{parts:[{paths:[]}]});assert(JSON.stringify(editor.draft)===draft,'unrelated update preserves draft');assert(editor.colors.CUT==='#f01234','configured operation colors');assert(await editor.finish()===false&&editor.draft,'one-point draft cannot be silently saved');
  editor.draft.points.push([60,100]);const successfulChange=editor.onChange;editor.onChange=async()=>{throw new Error('Expected failure');};assert(await editor.finish()===false&&editor.draft.points.length===2,'failed finish retains draft');editor.onChange=successfulChange;editor.cancel();assert(changes.length===count,'cancel does not commit');assert(draftStates.includes(true)&&draftStates.at(-1)===false,'draft notifications');
  editor.setGrid(0);assert(editor.snap([.1,130])[0]===0&&editor.snap([147.9,130])[0]===148,'frame snapping without grid');editor.setGrid(1);
  editor.setTool('anchor');pointer('pointerdown',[130,190]);await flush();assert(project.drawing.anchor[0]===130&&project.drawing.anchor[1]===190,'anchor selection');
  editor.setTool('select');editor.setSelection(first.id,0);const before=JSON.stringify(editor.drawing),callback=editor.onChange;editor.onChange=async()=>{throw new Error('Expected failure');};await editor.deleteSelected();assert(JSON.stringify(editor.drawing)===before,'failed action restores previous data');editor.onChange=callback;
  editor.update({...project,drawing:{...project.drawing,active:false}},{parts:[{paths:[{d:'M0 105H148',operation:'FOLD_VALLEY'}]}]});pointer('pointerdown',[50,50]);assert(changes.length===count+1,'generated context remains read-only');
  return {passed:true,checks:['click and drag drawing','straight folds','metadata preservation','selection operations','zoom millimetres','polyline completion','draft preservation','failed finish retention','draft callbacks','custom operation colors','frame snapping','cancel','anchor','failed-change rollback','read-only context']};
 } finally {editor.destroy();host.remove();}
}
