import {defaults,clone,validateProject,exampleProject,newFigure,newStructure,newSpiral,newDrawing} from './project.mjs';
import {buildProject} from './geometry.mjs';
import {exportSVG,exportProject} from './export.mjs';
import {normalizeSVG} from './svg.mjs';
import {MotifEditor} from './editor.mjs';
import {CardScene} from './scene.mjs';
import {CardLineEditor} from './card-editor.mjs';
import {SurfaceWorkspace} from './surface-workspace.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'klappkarten-studio-project-v2';
const oldStorageKey = 'klappkarten-studio-project-v1';
const format = n => new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n);
let project = exampleProject('surface-architecture'), selected = project.figures[0]?.id;
let result, editor, scene, view = 'surface', history = [], future = [];
let editorDirty = false, loadingEditor = false, transientInvalid = false, corruptSave = false;
let autoTimer = 0, motionFrame = 0, motionLast = 0, direction = -1, queue = Promise.resolve();
let legacyProject = null;
let cardEditor, cardScene, cardSelection={lineId:null,nodeIndex:0}, wasDrawing=false;
let flushingDrawing=false;
const surfaceActive=()=>!!project.surface?.active;
const drawingActive=()=>!surfaceActive()&&!!project.drawing?.active;
let selectedStructure, structureActive = false, hadFigures;
const currentStructure = () => (project.structures||[]).find(s=>s.id===selectedStructure);
const activeElement = () => surfaceActive()?surfaceWorkspace.selectedId:drawingActive()?cardSelection.lineId:structureActive ? selectedStructure : selected;
const spiralFields={spiralTurns:'turns',spiralRibbonWidth:'ribbonWidth',spiralInnerRadius:'innerRadius',spiralHeight:'height',spiralLevels:'levels',spiralRotation:'rotation',spiralDirection:'direction'};

let surfaceWorkspace=null,pendingActions=0,lastAttemptedImport=null;
window.WorkshopReports?.register({
 capture:()=>({document:project,response:result||null,ui:{selected,selectedStructure,structureActive,view,cardSelection,surfaceSelection:surfaceWorkspace?.selectedId,cameras:{motion:scene?.captureReport()||null,card:cardScene?.captureReport()||null,surface:surfaceWorkspace?.editor?.view.captureReport()||null},cardViewport:cardEditor?.view||null},drafts:{lastAttemptedImport,motif:editor?.captureReport()||null,card:cardEditor?{draft:cardEditor.draft,gesture:cardEditor.gesture,tool:cardEditor.tool,operation:cardEditor.operation,selection:cardEditor.selection}:null,surface:surfaceWorkspace?.editor?{draft:surfaceWorkspace.draft,gesture:surfaceWorkspace.editor.gesture,tool:surfaceWorkspace.editor.tool,orientation:surfaceWorkspace.editor.orientation,offset:surfaceWorkspace.editor.offset}:null},pending:{pendingActions,editorDirty,loadingEditor,transientInvalid,corruptSave,flushingDrawing,surfaceBusy:surfaceWorkspace?.busy||false,animating:!!motionFrame},history:{undo:history.length,redo:future.length}}),
 preview:()=>{if(view==='surface')return surfaceWorkspace?.editor?.view.reportPreview()||null;if(view==='motion')return scene?.reportPreview()||null;if(view==='card')return cardEditor?.svg||null;if(view==='design')return editor?.reportPreview()||null;return document.querySelector(`[data-panel="${view}"] svg`)||null;}
});
surfaceWorkspace=new SurfaceWorkspace({
  getProject:()=>project,getResult:()=>result,edit,run,setView,status,
  onDraftChange:active=>{updateDownloads();surfaceWorkspace.syncTools();if(active)$('saveStatus').textContent='Fläche noch offen · mit Fertig übernehmen';else if(!surfaceWorkspace.busy)saveLocal();}
});
const finishSurfaceDraft=()=>surfaceWorkspace.finishDraft();

function status(message, error = false) {
  if(error)window.WorkshopReports?.record('error',message,{phase:'studio'});
  $('status').textContent = message;
  $('status').style.color = error ? '#913d26' : '';
}
function run(action,propagate=false) {
  pendingActions++;
  const pending=queue.then(action).finally(()=>pendingActions--);
  queue = pending.catch(error => {
    status(error.message || 'Die Aktion konnte nicht ausgeführt werden.', true);
    updateDownloads();
  });
  return propagate?pending:queue;
}
function stopMotion() {
  surfaceWorkspace.stop();
  cancelAnimationFrame(motionFrame); motionFrame = 0; motionLast = 0;
  $('playMotion').textContent = '▶ Abspielen';
}
function saveLocal() {
  if(corruptSave) { $('saveStatus').textContent = 'Alte Sicherung erhalten · bitte als Datei speichern'; return; }
  try {
    localStorage.setItem(storageKey, JSON.stringify(project));
    $('saveStatus').textContent = 'Auf diesem Gerät gespeichert';
  } catch { $('saveStatus').textContent = 'Bitte Projekt als Datei speichern'; }
}
function currentFigure() { return project.figures.find(f => f.id === selected); }
function updateDownloads() {
  $('downloadSVG').disabled = !result || result.errors.length > 0 || transientInvalid || editorDirty || !!cardEditor?.draft || !!surfaceWorkspace.draft;
  $('undo').disabled = !history.length && !editorDirty && !cardEditor?.draft && !surfaceWorkspace.draft;
  $('redo').disabled = !future.length;
}
function notice(id, items) {
  const host = $(id); host.replaceChildren(); host.hidden = !items.length;
  if (!items.length) return;
  const list = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li'); li.textContent = item.message || item;
    if(item.surfaceId || item.figureId || item.structureId || item.lineId) {
      li.tabIndex = 0; li.title = 'Betroffene Figur auswählen';
      const select = () => run(async() => {if(item.surfaceId){await setView('surface');surfaceWorkspace.select(item.surfaceId);}else if(item.lineId){await setView('card');cardEditor?.setSelection(item.lineId);}else if(item.structureId)await selectStructure(item.structureId);else await selectFigure(item.figureId);});
      li.addEventListener('click', select);
      li.addEventListener('keydown', e => { if(e.key==='Enter') select(); });
    }
    list.append(li);
  }
  host.append(list);
}
function sync() {
  $('cardWidth').value = project.card.width;
  $('cardHalf').value = project.card.half;
  $('sheetWidth').value = project.layout.width;
  $('sheetHeight').value = project.layout.height;
  $('sheetGap').value = project.layout.gap;
  for (const key of ['cut','mountain','valley','engrave']) $(key+'Color').value=project.colors[key];
  $('figureList').replaceChildren(...project.figures.map(f => {
    const option = document.createElement('option'); option.value=f.id; option.textContent=f.name;
    return option;
  }));
  if (!currentFigure()) selected = project.figures[0]?.id;
  $('figureList').value = selected || '';
  const f = currentFigure();
  const fields = {figureName:'name',figureWidth:'width',figureHeight:'height',figureX:'x',figureDepth:'depth',bridgeWidth:'bridgeWidth',bridgeOffset:'bridgeOffset',figureColor:'color'};
  for (const [id,key] of Object.entries(fields)) { $(id).disabled = !f; $(id).value = f ? f[key] : id==='figureColor'?'#df925a':''; }
  for (const id of ['duplicateFigure','removeFigure','svgFile']) $(id).disabled = !f;
  for (const id of ['applyMotif','discardMotif','addText','editorOperation']) $(id).disabled = !f || view!=='design';
  document.querySelectorAll('[data-editor]').forEach(el => el.disabled = !f || view!=='design');
  syncStructures();
  syncDrawing();
  surfaceWorkspace.sync(view);
  $('metricFigures').textContent = surfaceActive()?project.surface.shapes.length:drawingActive()?project.drawing.lines.length:project.figures.length + (project.structures||[]).length;
  $('metricItemsLabel').textContent=surfaceActive()?'Flächen':drawingActive()?'Linien':'Elemente';
  $('metricParts').textContent = result?.parts.length || 0;
  $('metricSize').textContent = `${format(project.card.width)} × ${format(project.card.half*2)}`;
  if(wasDrawing!==drawingActive()){$('angle').value=drawingActive()?$('cardProgress').value:'90';wasDrawing=drawingActive();}
  $('angle').max = drawingActive()?100:180;
  $('motionAngleLabel').textContent=drawingActive()?'Faltfortschritt':'Öffnungswinkel';
  $('motionNote').textContent=drawingActive()?'Ziehen zum Drehen · Scrollen zum Zoomen. 0 % flach · 100 % eingestellte Zielwinkel. Freie Konstruktionen werden auf starre Gelenkverbindungen geprüft.':'Ziehen zum Drehen · Scrollen zum Zoomen. 0° geschlossen · 90° aufgestellt · 180° flacher Bogen. Die Vorschau zeigt die ideale Bewegung ohne Materialstärke.';
  angleLabel();
  $('legacyNotice').hidden = !legacyProject;
  for (const [className,key] of [['cut-line','cut'],['mountain-line','mountain'],['valley-line','valley'],['engrave-line','engrave']]) document.querySelector('.'+className).style.borderColor=project.colors[key];
  updateDownloads();
}
function syncDrawing() {
  const active=drawingActive();
  $('mechanismLabel').textContent=surfaceActive()?'Einbogen · Flächen im Raum':active?'Einbogen · Freie Kartenlinien':'Einbogen · Stufenfaltung';
  $('mechanismHint').textContent=surfaceActive()?'Zeichne Flächen auf verschiebbaren Ebenen. Schnitte, Falze und Papierstege entstehen gemeinsam.':active?'Zeichne Schnitte und gerade Falze. Der Faltfortschritt führt von der flachen Karte zu deinen Zielwinkeln.':'Motive und Stufen bleiben mit der Karte verbunden. Bei 90° stehen sie auf; bei 180° liegt der Schnittbogen flach.';
  $('figureSettings').hidden=active;$('structureSettings').hidden=active;
  $('useParametric').hidden=!active;$('resumeDrawing').hidden=active||!project.drawing;
  $('convertToDrawing').disabled=active;
  $('drawingModeStatus').textContent=active?'Freie Kartenlinien sind aktiv. Die Vorschau verwendet die direkt gezeichneten Papierflächen.':'Eigene Schnitt- und Falzlinien auf dem ganzen Kartenbogen zeichnen.';
  $('cardReadOnly').hidden=active;
  for(const id of ['tab-design','tab-kirigami'])$(id).disabled=active;
  for(const button of document.querySelectorAll('[data-card-tool]'))button.disabled=!active;
  for(const id of ['cardDrawOperation','finishCardPath'])$(id).disabled=!active;
  $('cardTools').hidden=view!=='card'&&!(active&&view==='motion');
  if(view==='card'||active)$('motifTools').hidden=true;
  if(view==='card'||active)$('spiralControls').hidden=true;
  cardEditor?.update(project,result);
  syncCardSelection();
}
function syncCardSelection(selection=cardSelection) {
  cardSelection=selection||{lineId:null,nodeIndex:0};
  const line=project.drawing?.lines.find(l=>l.id===cardSelection.lineId),active=drawingActive();
  const fold=line?.operation.startsWith('FOLD_'),node=line?.points[cardSelection.nodeIndex||0];
  $('cardSelectionStatus').textContent=line?`${line.points.length} Punkte · Punkt ${(cardSelection.nodeIndex||0)+1} ausgewählt`:'Eine Linie oder einen Punkt auf der Karte auswählen.';
  $('cardSelectedOperation').value=line?.operation||'CUT';$('cardSelectedOperation').disabled=!active||!line;
  $('cardFoldAngle').value=line?.angle??90;$('cardFoldAngle').disabled=!active||!fold;
  for(const [id,index,max] of [['cardNodeX',0,project.card.width],['cardNodeY',1,2*project.card.half]]){$(id).value=node?.[index]??'';$(id).disabled=!active||!node;$(id).min=0;$(id).max=max;}
  for(const id of ['cardDelete','cardDuplicate'])$(id).disabled=!active||!line;
  $('cardAddNode').disabled=!active||!line||fold;
  $('cardRemoveNode').disabled=!active||!line||fold||line.points.length<=(line.closed?3:2);
  $('cardClosePath').disabled=!active||!line||fold||line.points.length<3;
  $('cardClosePath').textContent=line?.closed?'Kontur öffnen':'Kontur schließen';
}
function cardView() {
  if(!cardEditor)cardEditor=new CardLineEditor($('cardCanvas'),{
    onChange:drawing=>flushingDrawing?edit(p=>{p.drawing=drawing;}):run(()=>edit(p=>{p.drawing=drawing;}),true),
    onSelect:selection=>syncCardSelection(selection),onStatus:message=>status(message),
    onDraftChange:active=>{updateDownloads();if(active)$('saveStatus').textContent='Linie noch offen · mit Fertig übernehmen';else if(!cardEditor?.busy)saveLocal();}
  });
  cardEditor.update(project,result);
  $('cardProgress').disabled=!drawingActive();
  if(!cardScene)try{cardScene=new CardScene($('cardPreview'),id=>cardEditor?.setSelection(id));cardScene.update(project,drawingActive()?Number($('cardProgress').value):90);cardScene.resize();cardScene.fit();}catch(error){$('cardPoseStatus').textContent='3D-Vorschau nicht verfügbar: '+error.message;return;}
  cardScene.setVisible(true);updateCardPose();
}
function updateCardPose() {
  $('cardProgressValue').textContent=$('cardProgress').value+' %';
  if(!cardScene)return;
  if(!drawingActive()){cardScene.update(project,90);$('cardPoseStatus').textContent='Parameterentwurf. Für freie Änderungen links den Schnittbogen übernehmen.';return;}
  const posed=cardScene.update(project,Number($('cardProgress').value),cardSelection.lineId);
  const errors=posed.errors||[];
  $('cardPoseStatus').textContent=errors.length?'Keine passende starre Faltung für diese Linien und Winkel. Die Karte wird flach gezeigt. Bitte die markierten Linien prüfen.':'Die Flächen bleiben starr und an den Falzkanten verbunden.';
  $('cardPoseStatus').classList.toggle('pose-error',errors.length>0);
}
async function finishCardDraft() {
  if(flushingDrawing||!cardEditor?.draft||cardEditor.busy)return;
  flushingDrawing=true;
  try{const finished=await cardEditor.finish();if(finished===false||cardEditor.draft)throw new Error('Die offene Linie konnte noch nicht übernommen werden. Bitte bearbeiten oder mit Escape abbrechen.');}
  finally{flushingDrawing=false;}
}
function linesFromBuild(build) {
  if(build.errors.length)throw new Error('Schnittbogen zuerst korrigieren: '+build.errors[0].message);
  const lines=[];
  for(const part of build.parts)for(const item of part.paths) {
    // The frame stays implicit and uneditable; the first CUT is the original card frame.
    if(item===part.paths[0]&&item.operation==='CUT')continue;
    const numbers=item.d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)||[];
    const points=[];for(let i=0;i<numbers.length;i+=2)points.push([numbers[i],numbers[i+1]]);
    if(points.length<2)continue;
    lines.push({id:crypto.randomUUID(),operation:item.operation,points,closed:/Z\s*$/i.test(item.d),...(item.operation.startsWith('FOLD_')?{angle:90}:{})});
  }
  return lines;
}
function syncStructures() {
  const hasFigures=project.figures.length>0||!(project.structures||[]).length;
  if(hadFigures!==hasFigures){$('figureSettings').open=hasFigures;hadFigures=hasFigures;}
  const structures=project.structures||[];
  if(!currentStructure())selectedStructure=structures[0]?.id;
  if(!structures.length)structureActive=false;
  $('structureList').replaceChildren(...structures.map(s=>{
    const option=document.createElement('option');option.value=s.id;option.textContent=s.type==='spiral'?`${s.name} · ${format(s.turns)} Windungen`:`${s.name} · ${s.steps.length} Stufen`;return option;
  }));
  $('structureList').value=selectedStructure||'';
  const s=currentStructure();
  const spiral=s?.type==='spiral';
  $('structureWidthLabel').textContent=spiral?'Außendurchmesser':'Bandbreite';
  $('structureWidth').min=spiral?'10':'2';
  $('spiralControls').hidden=!(spiral&&structureActive);
  $('motifTools').hidden=spiral&&structureActive;
  for(const [id,key] of Object.entries(spiralFields)){$(id).disabled=!spiral;$(id).value=spiral?s[key]:'';}
  for(const [id,key] of Object.entries({structureName:'name',structureWidth:'width',structureX:'x',structureColor:'color'})) {
    $(id).disabled=!s;$(id).value=s?s[key]:id==='structureColor'?'#adc49a':'';
  }
  for(const id of ['duplicateStructure','removeStructure','editStructure'])$(id).disabled=!s;
  $('addStructure').disabled=structures.length>=20;
  $('addSpiral').disabled=structures.length>=20||structures.filter(s=>s.type==='spiral').length>=6;
}
function svgNode(tag,attributes={},text) {
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))el.setAttribute(key,value);
  if(text!==undefined)el.textContent=text;return el;
}
function kirigami() {
  const s=currentStructure(), host=$('profileHost'), rows=$('structureSteps');host.replaceChildren();rows.replaceChildren();
  const spiral=s?.type==='spiral';
  $('kirigamiCaption').textContent=spiral?'Spiralschnitte und ungeschnittene Scharniere':'Zusammenhängende Stufen gestalten';
  $('kirigamiViewLabel').textContent=spiral?'Schnittnetz · Millimeter':'Seitenprofil · Millimeter';
  $('addStep').hidden=spiral;$('stepTableWrap').hidden=spiral;
  $('addStep').disabled=!s||spiral||s.steps.length>=12;$('previewStructure').disabled=!s;
  $('structureTitle').textContent=s?s.name:'Ein Stufenband hinzufügen';
  $('structureSummary').textContent='';
  $('kirigamiIntro').textContent=spiral?'Die Spiralbahn bleibt als zusammenhängendes Papierband erhalten. Hier siehst du die tatsächlichen Schnitte und geraden Falze. Die markierten Ansätze werden nur gefalzt; das innere Ende bleibt frei.':'Von der Rückwand nach vorne: Jede Stufe hat eine waagerechte Tiefe und eine senkrechte Höhe. Gemeinsam bilden sie ein durchgehendes Band aus dem Kartenblatt.';
  if(!s){const p=document.createElement('p');p.textContent='Links ein Band hinzufügen oder oben eine Kirigami-Idee laden.';host.append(p);return;}
  if(spiral){spiralNet(s,host);return;}
  const height=s.steps.reduce((n,v)=>n+v.rise,0),depth=s.steps.reduce((n,v)=>n+v.run,0),maxX=Math.max(depth,1),maxY=Math.max(height,1);
  // An upright profile and its exact unfolded material use the same cumulative dimensions.
  const scale=Math.min(420/maxX,190/maxY),sx=x=>44+x*scale,sy=z=>230-z*scale;
  const svg=svgNode('svg',{viewBox:'0 0 520 310',role:'img','aria-label':`${s.steps.length} Stufen, ${format(height)} mm hoch und ${format(depth)} mm tief`});
  svg.append(svgNode('path',{d:`M44 22V230H490`,fill:'none',stroke:'#a5b09a','stroke-width':1}));
  let D=0,Z=height;const points=[[sx(0),sy(Z)]],flat=[-height];
  s.steps.forEach((step,i)=>{
    const row=document.createElement('tr'),name=document.createElement('th');name.scope='row';name.textContent=i+1;row.append(name);
    for(const [key,label] of [['rise','Höhe'],['run','Tiefe']]) {
      const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='1';input.max='1000';input.step='.5';input.value=step[key];input.dataset.step=i;input.dataset.key=key;input.setAttribute('aria-label',`${label} Stufe ${i+1} in mm`);cell.append(input);row.append(cell);
    }
    const cell=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.dataset.removeStep=i;remove.disabled=s.steps.length===1;remove.setAttribute('aria-label',`Stufe ${i+1} entfernen`);cell.append(remove);row.append(cell);rows.append(row);
    D+=step.run;points.push([sx(D),sy(Z)]);flat.push(D-Z);
    svg.append(svgNode('text',{x:sx(D-step.run/2),y:Math.max(16,sy(Z)-8),'text-anchor':'middle',fill:'#52624c','font-size':10},`${format(step.run)}`));
    Z-=step.rise;points.push([sx(D),sy(Z)]);flat.push(D-Z);
    svg.append(svgNode('text',{x:sx(D)+6,y:sy(Z+step.rise/2)+3,fill:'#52624c','font-size':10},`${format(step.rise)}`));
  });
  svg.append(svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:s.color,'stroke-width':6,'stroke-linejoin':'round'}));
  for(const [x,y] of points)svg.append(svgNode('circle',{cx:x,cy:y,r:3,fill:'#24594b'}));
  svg.append(svgNode('text',{x:44,y:253,fill:'#52624c','font-size':10},'90° · aufgestelltes Seitenprofil'));
  const width=height+depth,flatX=t=>44+(t+height)/width*420;
  svg.append(svgNode('rect',{x:44,y:272,width:420,height:14,fill:'#f0eadb',stroke:'#a5b09a'}));
  flat.slice(1,-1).forEach((t,i)=>svg.append(svgNode('path',{d:`M${flatX(t)} 272V286`,stroke:i%2===0?project.colors.mountain:project.colors.valley,'stroke-width':1.5})));
  svg.append(svgNode('text',{x:44,y:303,fill:'#52624c','font-size':10},`180° · flaches Band · ${format(width)} mm lang · ${format(s.width)} mm breit`));
  host.append(svg);
  $('structureSummary').textContent=`Gesamthöhe ${format(height)} mm · Tiefe ${format(depth)} mm · Schließmaß ${format(width)} / ${format(project.card.half)} mm`;
}
function spiralNet(s,host) {
  const compiled=result?.structures.find(v=>v.structureId===s.id),footprint=compiled?.footprint;
  if(!footprint?.length){const p=document.createElement('p');p.textContent='Die Spiralgeometrie ist noch nicht gültig. Bitte die markierten Einstellungen korrigieren.';host.append(p);return;}
  const w=compiled.window,pad=6;
  const svg=svgNode('svg',{viewBox:`${w.minX-pad} ${w.minY-pad} ${w.maxX-w.minX+2*pad} ${w.maxY-w.minY+2*pad}`,role:'img','aria-label':`Schnittnetz ${s.name} mit ${format(s.turns)} Windungen und ungeschnittenen Scharnieren`,'data-spiral-net':'true'});
  const contour=footprint.flat().map(r=>`M${r.map(q=>q.join(' ')).join('L')}Z`).join(' ');
  svg.append(svgNode('path',{d:contour,fill:s.color,'fill-opacity':.24,'fill-rule':'evenodd'}));
  const draw=(points,stroke,width=0.25,extra={})=>svg.append(svgNode('polyline',{points:points.map(q=>q.join(',')).join(' '),fill:'none',stroke,'stroke-width':width,...extra}));
  for(const cut of compiled.cuts||[])draw(cut,project.colors.cut);
  for(const fold of compiled.folds||[])if(fold.points)draw(fold.points,fold.operation==='FOLD_MOUNTAIN'?project.colors.mountain:project.colors.valley,.3);
  for(const points of [...(compiled.anchors?.back||[]),...(compiled.anchors?.foot||[])])draw(points,'#24594b',.8,{'data-anchor':'true'});
  host.append(svg);
  const legend=document.createElement('p');legend.className='spiral-net-legend';legend.textContent='Dunkelgrün hervorgehoben: ungeschnittene Ansätze zur Karte. Schnitt-, Berg- und Talfalzfarben entsprechen dem Schnittbogen.';host.append(legend);
  $('structureSummary').textContent=`${format(s.turns)} Windungen · ${format(s.ribbonWidth)} mm Band · ${s.levels} Faltstufen · ${format(compiled.A)} mm Höhe · ${format(compiled.A+compiled.B)} / ${format(project.card.half)} mm Schließmaß`;
}
async function selectStructure(id) {
  await commitMotif();selectedStructure=id;structureActive=true;sync();
  if(view==='design'||view==='kirigami')await setView('kirigami');
  scene?.update(project,Number($('angle').value),activeElement());
}
function layout() {
  const host = $('layoutHost'); host.replaceChildren();
  if (result.errors.length) {
    const note = document.createElement('p'); note.textContent='Schnittbogen noch nicht fertig: Bitte die markierten Geometriefehler korrigieren.'; host.append(note); return;
  }
  const doc = new DOMParser().parseFromString(exportSVG(project,result),'image/svg+xml');
  const svg = document.importNode(doc.documentElement,true);
  svg.setAttribute('role','img'); svg.setAttribute('aria-label','Maßhaltiger Schnittbogen mit getrennten Schnitt- und Falzlinien');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.width='100%';
  // Labels only belong to the preview, never to the fabrication SVG.
  for (const part of result.parts) {
    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x',part.placement.x); label.setAttribute('y',Math.max(4,part.placement.y-2));
    label.setAttribute('fill','#52624c'); label.setAttribute('font-size','3');
    label.setAttribute('data-preview-only','true'); label.textContent=part.label;
    svg.append(label);
  }
  host.append(svg);
}
function assembly() {
  const host = $('assemblyHost'); host.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent=surfaceActive()?'Deine Raumflächen entstehen aus einem Blatt':drawingActive()?'Deine Linien werden zu Papierflächen':'Aus einem Bogen wird eine Papierbühne';
  const intro = document.createElement('p'); intro.textContent=surfaceActive()?'Die farbigen Flächen und automatisch ergänzten Stege gehören zum selben Kartenbogen. Nur die roten Linien durchtrennen; an grünen und blauen Falzkanten bleibt das Papier verbunden.':drawingActive()?'Nur Schnittlinien vollständig durchtrennen. Gerade Berg- und Talfalze als Gelenke vorformen. Die gelb markierte feste Fläche bleibt in der Vorschau liegen; abgetrennte Schnittinseln werden als Abfall entfernt.':'Figuren und Haltestege bleiben an der Karte. Nur die markierten Linien falzen; die Rückenfalte ist an den Motiven unterbrochen. Den Bogen nicht vorab durchgehend halbieren. Die ungeschnittenen Ansatzkanten werden nur gefalzt. Bergfalten zeigen zur bedruckten Innenseite, Talfalten von ihr weg.';
  const list = document.createElement('ol');
  for(const step of result.assemblySteps) { const li=document.createElement('li');li.textContent=step;list.append(li); }
  const parts = document.createElement('h3'); parts.textContent='Ein zusammenhängender Kartenbogen';
  const inventory = document.createElement('ul');
  for(const part of result.parts) {const li=document.createElement('li');li.textContent=`${part.label} · ${format(part.width)} × ${format(part.height)} mm`;inventory.append(li);}
  const limit = document.createElement('p'); limit.textContent=surfaceActive()?'Die Vorschau zeigt die gemeinsam berechnete Bewegung aller Flächen: 0° geschlossen, 90° aufgestellt und 180° flach. Die Konstruktion wird auf Papierverbindungen und geschlossene Kartenmaße geprüft. Papierstärke und zusätzliche Bewegungsfreiheit erfordern einen Probeschnitt und geführtes Vorfalzen.':drawingActive()?'Der Faltfortschritt führt von 0 % flach bis zu 100 % der eingestellten Zielwinkel. Widersprüchliche Gelenkwinkel werden markiert und sperren den Fertigungsexport. Kollisionen, Materialstärke und vollständiges Schließen sind in der freien Vorschau nicht nachgewiesen. Die Faltung an einem Papierprototyp prüfen.':'Die Figuren richten sich bei etwa 90° auf. Bei 180° liegt der Bogen wieder flach. Kirigami-Stufen einzeln vorfalzen und beim ersten Schließen führen; ihre Bewegung ist geometrisch möglich, aber nicht mechanisch erzwungen. Überlappende Schnittbereiche werden gesperrt. Papierstärke und Biegesteifigkeit werden nicht simuliert; die Faltung zuerst an einem Papierprototyp prüfen.';
  host.append(heading,intro,list,parts,inventory,limit);
}
function rebuild(computed) {
  result = computed || buildProject(project);
  notice('errors',result.errors); notice('warnings',result.warnings);
  sync();
  if(view==='layout') layout();
  if(view==='assembly') assembly();
  if(view==='kirigami') kirigami();
  if(view==='card')cardView();
  if(view==='surface')surfaceWorkspace.show();
  if(scene) scene.update(project,Number($('angle').value),activeElement());
  status(result.errors.length ? `${result.errors.length} Geometriefehler · Schnittdatei gesperrt.` : surfaceActive()?'Flächen im Raum · Schnittbogen und Papierverbindungen berechnet.':drawingActive()?'Freie Kartenlinien · Papierflächen und Gelenke berechnet.':'Ein Kartenbogen · Motive und Stufen bleiben verbunden · Schnittbereiche geprüft.' , !!result.errors.length);
}
function record(next) {
  const valid = validateProject(next);
  if(JSON.stringify(valid)===JSON.stringify(project)) { transientInvalid=false;rebuild();return; }
  const computed = buildProject(valid);
  history.push(clone(project)); if(history.length>80)history.shift(); future=[];
  project=valid; transientInvalid=false; stopMotion(); rebuild(computed); saveLocal();
}
async function commitMotif() {
  clearTimeout(autoTimer);
  if(!editorDirty || !currentFigure() || !editor) return;
  const data = await editor.commit();
  const next = clone(project), f = next.figures.find(f=>f.id===selected);
  Object.assign(f,{svg:data.svg,contours:data.contours,engravings:data.engravings,sourceTexts:data.sourceTexts});
  if(data.physicalWidth>0&&data.physicalHeight>0) {f.width=+data.physicalWidth.toFixed(6);f.height=+data.physicalHeight.toFixed(6);}
  editorDirty=false;
  try { record(next); } catch(error) { editorDirty=true; throw error; }
  updateDownloads();
  if(data.warnings.length) status(data.warnings.join(' '));
}
async function loadEditor() {
  clearTimeout(autoTimer); editorDirty=false;
  // SVG-Edit calculates its canvas from the visible viewport; hidden frames have no size.
  if(view!=='design'||drawingActive()) {updateDownloads();return;}
  const f=currentFigure();
  if(!f) { editor.frame.hidden=true; return; }
  editor.frame.hidden=false; loadingEditor=true;
  try { await editor.load(f); } finally {loadingEditor=false;}
  updateDownloads();
}
async function selectFigure(id) {
  await commitMotif(); selected=id; structureActive=false; sync(); await loadEditor();
  if(scene)scene.update(project,Number($('angle').value),activeElement());
}
async function edit(action) {
  await finishSurfaceDraft();await finishCardDraft();
  await commitMotif();
  const next=clone(project); action(next);
  try {
    for(const f of next.figures){const before=project.figures.find(old=>old.id===f.id);if(!before||before.svg!==f.svg||before.width!==f.width||before.height!==f.height){const data=await normalizeSVG(f.svg,{width:f.width,height:f.height});Object.assign(f,{svg:data.svg,contours:data.contours,engravings:data.engravings});}}
    record(next);
  } catch(error) {transientInvalid=true;updateDownloads();throw error;}
}
async function normalizedProject(input) {
  const next=validateProject(input);
  if(next.figures.reduce((n,f)=>n+f.svg.length,0)>4*1024*1024) throw new Error('Das Projekt ist zu groß (maximal 4 MB Vektordaten).');
  for(const f of next.figures) {
    const data=await normalizeSVG(f.svg,{width:f.width,height:f.height});
    f.svg=data.svg; f.contours=data.contours; f.engravings=data.engravings;
    if(data.sourceTexts.length)f.sourceTexts=data.sourceTexts;
  }
  const valid=validateProject(next);buildProject(valid);return valid;
}
function download(name,source,type) {
  const url=URL.createObjectURL(new Blob([source],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function legacyHash(raw) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function showLegacy(raw,source) {
  if(raw.length>5*1024*1024)throw new Error('Das alte Projekt ist zu groß. Bitte einzelne SVG-Motive importieren.');
  let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('Das alte Projekt enthält ungültiges JSON und bleibt erhalten.');}
  if(parsed?.version!==1||!Array.isArray(parsed.figures)||parsed.figures.length>50)throw new Error('Das alte Projektformat ist unvollständig; es wurde nichts ersetzt.');
  legacyProject={raw,source,parsed};
  $('legacyText').textContent=`${source}: Dieser Entwurf verwendet die frühere Klebebauweise. Das Original bleibt erhalten. Du kannst seine Motive ausdrücklich in einen neuen Einbogen-Entwurf übernehmen; Befestigungen und Faltung werden neu berechnet. Danach Schnittbereiche prüfen.`;
  $('legacyNotice').hidden=false;
  status('Altes Klebeprojekt erkannt. Der aktuelle Einbogen-Entwurf bleibt erhalten.');
}
function legacyNumber(value,fallback,label) {
  if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Altes Projekt: ${label} ist keine gültige Zahl.`);
  return value;
}
$('legacyDownload').addEventListener('click',()=>{if(legacyProject)download('klappkarte-original-v1.json',legacyProject.raw,'application/json');});
$('legacyConvert').addEventListener('click',()=>run(async()=>{
  if(!legacyProject)return;
  const source=legacyProject,next=clone(defaults),old=source.parsed;
  next.card.width=legacyNumber(old.card?.width,next.card.width,'Kartenbreite');
  next.card.half=legacyNumber(old.card?.half,next.card.half,'Kartenhälfte');
  for(const key of ['width','height','gap'])next.layout[key]=legacyNumber(old.layout?.[key],next.layout[key],key);
  next.figures=old.figures.map(f=>{
    if(!f||typeof f.svg!=='string')throw new Error('Altes Projekt: Ein SVG-Motiv fehlt.');
    const item=newFigure();
    Object.assign(item,{id:typeof f.id==='string'?f.id:item.id,name:typeof f.name==='string'?f.name:item.name,svg:f.svg,width:legacyNumber(f.width,item.width,'Motivbreite'),height:legacyNumber(f.height,item.height,'Motivhöhe'),x:legacyNumber(f.x,item.x,'Position'),depth:legacyNumber(f.depth,item.depth,'Tiefe'),bridgeWidth:3,bridgeOffset:0,color:typeof f.color==='string'?f.color:item.color});
    if(Array.isArray(f.sourceTexts))item.sourceTexts=f.sourceTexts;
    return item;
  });
  const converted=await normalizedProject(next);
  converted.legacySourceHash=await legacyHash(source.raw);
  await commitMotif();corruptSave=false;record(converted);
  selected=project.figures[0]?.id;legacyProject=null;$('angle').value=90;await setView('design');
  status('Motive übernommen. Einbogen-Falze und Haltestege wurden neu berechnet; das Original bleibt erhalten.');
}));
async function setView(next) {
  await finishSurfaceDraft();await finishCardDraft();
  if(surfaceActive()&&['design','kirigami','card'].includes(next))next='surface';
  if(drawingActive()&&['design','kirigami'].includes(next))next='card';
  await commitMotif(); stopMotion(); view=next;
  if(view==='design')structureActive=false;
  else if(view==='kirigami'&&currentStructure())structureActive=true;
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==view);
  document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===view;el.setAttribute('aria-selected',String(active));el.classList.toggle('active',active);});
  sync();
  if(view==='design')await loadEditor();
  if(view==='motion') {
    if(!scene) {
      try {scene=new CardScene($('sceneHost'),id=>run(()=>surfaceActive()?surfaceWorkspace.select(id):drawingActive()?cardEditor?.setSelection(id):project.figures.some(f=>f.id===id)?selectFigure(id):selectStructure(id)));scene.update(project,Number($('angle').value),activeElement());scene.resize();scene.fit();}
      catch(error) { $('sceneHost').textContent='Die 3D-Vorschau benötigt WebGL. Zeicheneditor und SVG-Export bleiben verfügbar.';status('3D-Vorschau nicht verfügbar: '+error.message,true); }
    }
  }
  surfaceWorkspace.editor?.setVisible(view==='surface');
  scene?.setVisible(view==='motion');
  cardScene?.setVisible(view==='card'&&drawingActive());
  if(view==='layout')layout();
  if(view==='assembly')assembly();
  if(view==='kirigami')kirigami();
  if(view==='card')cardView();
  if(view==='surface')surfaceWorkspace.show();
}

for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>run(()=>setView(el.dataset.view)));
$('openCardEditor').addEventListener('click',()=>run(()=>setView('card')));
$('startBlankDrawing').addEventListener('click',()=>run(async()=>{await edit(p=>{p.drawing=newDrawing(p.card);});await setView('card');cardEditor.fit();}));
$('convertToDrawing').addEventListener('click',()=>run(async()=>{
  const original=clone(project);original.drawing=null;
  const lines=linesFromBuild(buildProject(original));
  await edit(p=>{p.drawing=newDrawing(p.card,{lines});});await setView('card');cardEditor.fit();
}));
$('resumeDrawing').addEventListener('click',()=>run(async()=>{await edit(p=>{if(p.drawing)p.drawing.active=true;});await setView('card');}));
$('useParametric').addEventListener('click',()=>run(async()=>{await edit(p=>{if(p.drawing)p.drawing.active=false;});await setView(project.structures.length?'kirigami':'design');}));
for(const button of document.querySelectorAll('[data-card-tool]'))button.addEventListener('click',()=>{
  cardEditor?.setTool(button.dataset.cardTool);
  syncCardTool();
});
function syncCardTool(){document.querySelectorAll('[data-card-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cardTool===cardEditor?.tool)));}
$('cardDrawOperation').addEventListener('change',e=>{cardEditor?.setOperation(e.target.value);syncCardTool();});
$('cardGrid').addEventListener('change',e=>cardEditor?.setGrid(Number(e.target.value)));
for(const [id,method] of [['finishCardPath','finish'],['cardFit','fit'],['cardDelete','deleteSelected'],['cardDuplicate','duplicateSelected'],['cardAddNode','addNode'],['cardRemoveNode','removeNode'],['cardClosePath','closeSelected']])$(id).addEventListener('click',()=>cardEditor?.[method]());
$('cardZoomIn').addEventListener('click',()=>cardEditor?.zoom(1.3));$('cardZoomOut').addEventListener('click',()=>cardEditor?.zoom(1/1.3));
$('cardFitCamera').addEventListener('click',()=>cardScene?.fit());
$('cardProgress').addEventListener('input',()=>{stopMotion();if(drawingActive()){$('angle').value=$('cardProgress').value;angleLabel();}updateCardPose();});
function editCardLine(action) {
  const id=cardSelection.lineId,index=cardSelection.nodeIndex||0;
  return run(()=>edit(p=>{const line=p.drawing?.lines.find(l=>l.id===id);if(line)action(line,index,p.drawing);}));
}
$('cardFoldAngle').addEventListener('change',e=>{const value=Number(e.target.value);editCardLine(line=>{line.angle=value;});});
for(const [id,axis] of [['cardNodeX',0],['cardNodeY',1]])$(id).addEventListener('change',e=>{const value=Number(e.target.value);editCardLine((line,index)=>{line.points[index][axis]=value;});});
$('cardSelectedOperation').addEventListener('change',e=>{
  const operation=e.target.value;
  editCardLine((line,index,drawing)=>{
    if(operation.startsWith('FOLD_')&&(line.points.length>2||line.closed)) {
      const points=line.closed?[...line.points,line.points[0]]:line.points,position=drawing.lines.indexOf(line);
      drawing.lines.splice(position,1,...points.slice(1).map((p,i)=>({id:i?crypto.randomUUID():line.id,operation,points:[points[i],p],angle:line.angle??90})));
    } else {line.operation=operation;if(operation.startsWith('FOLD_'))line.angle??=90;}
  });
});
$('structureList').addEventListener('change',e=>{const id=e.target.value;run(()=>selectStructure(id));});
$('editStructure').addEventListener('click',()=>run(async()=>{structureActive=true;await setView('kirigami');}));
$('previewStructure').addEventListener('click',()=>run(()=>setView('motion')));
$('editSpiralNet').addEventListener('click',()=>run(()=>setView('kirigami')));
$('addSpiral').addEventListener('click',()=>run(async()=>{
  let id;await edit(p=>{const s=newSpiral({x:p.card.width/2});id=s.id;p.structures.push(s);});
  await selectStructure(id);await setView('kirigami');
}));
for(const [id,key] of Object.entries(spiralFields))$(id).addEventListener('change',e=>{
  const value=key==='direction'?e.target.value:Number(e.target.value);
  run(()=>edit(p=>{const s=p.structures.find(s=>s.id===selectedStructure);if(s?.type==='spiral')s[key]=value;}));
});
$('addStructure').addEventListener('click',()=>run(async()=>{
  let id;
  await edit(p=>{
    const width=18,windows=[...result.figures,...(result.structures||[])].map(f=>f.window);
    let x=p.card.width/2;
    for(let candidate=2+width/2;candidate<=p.card.width-2-width/2;candidate+=1){
      if(windows.every(w=>candidate+width/2+2<=w.minX||candidate-width/2-2>=w.maxX)){x=candidate;break;}
    }
    const s=newStructure({x,width});id=s.id;p.structures.push(s);
  });await selectStructure(id);
}));
$('duplicateStructure').addEventListener('click',()=>run(async()=>{
  let id;await edit(p=>{const old=p.structures.find(s=>s.id===selectedStructure);if(!old)return;
    const create=old.type==='spiral'?newSpiral:newStructure;
    const s=create({...clone(old),id:crypto.randomUUID(),name:old.name+' Kopie',x:old.x+old.width+2});id=s.id;p.structures.push(s);
  });if(id)await selectStructure(id);
}));
$('removeStructure').addEventListener('click',()=>run(async()=>{await edit(p=>{p.structures=p.structures.filter(s=>s.id!==selectedStructure);});if(view==='kirigami')kirigami();}));
for(const [id,key] of Object.entries({structureName:'name',structureWidth:'width',structureX:'x',structureColor:'color'}))$(id).addEventListener('change',e=>{
  const value=['name','color'].includes(key)?e.target.value:Number(e.target.value);
  run(()=>edit(p=>{const s=p.structures.find(s=>s.id===selectedStructure);if(s)s[key]=value;}));
});
$('structureSteps').addEventListener('change',e=>{
  if(!e.target.matches('input[data-step]'))return;
  const index=Number(e.target.dataset.step),key=e.target.dataset.key,value=Number(e.target.value);
  run(()=>edit(p=>{const s=p.structures.find(s=>s.id===selectedStructure);if(s?.type!=='spiral'&&s?.steps[index])s.steps[index][key]=value;}));
});
$('structureSteps').addEventListener('click',e=>{
  const button=e.target.closest('[data-remove-step]');if(!button)return;const index=Number(button.dataset.removeStep);
  run(()=>edit(p=>{const s=p.structures.find(s=>s.id===selectedStructure);if(s&&s.type!=='spiral'&&s.steps.length>1)s.steps.splice(index,1);}));
});
$('addStep').addEventListener('click',()=>run(()=>edit(p=>{const s=p.structures.find(s=>s.id===selectedStructure);if(s&&s.type!=='spiral'&&s.steps.length<12)s.steps.push({rise:8,run:8});})));
for(const [id,group,key] of [['cardWidth','card','width'],['cardHalf','card','half'],['sheetWidth','layout','width'],['sheetHeight','layout','height'],['sheetGap','layout','gap']]) {
  $(id).addEventListener('change',e=>{const value=Number(e.target.value);run(async()=>{
    await edit(p=>{p[group][key]=value;});
  });});
}
for(const key of ['cut','mountain','valley','engrave'])$(key+'Color').addEventListener('change',e=>{const value=e.target.value;run(()=>edit(p=>p.colors[key]=value));});
const figureFields={figureName:'name',figureWidth:'width',figureHeight:'height',figureX:'x',figureDepth:'depth',bridgeWidth:'bridgeWidth',bridgeOffset:'bridgeOffset',figureColor:'color'};
for(const [id,key] of Object.entries(figureFields))$(id).addEventListener('change',e=>{const value=['name','color'].includes(key)?e.target.value:Number(e.target.value);run(async()=>{await edit(p=>{const f=p.figures.find(f=>f.id===selected);if(f)f[key]=value;});if(['width','height'].includes(key))await loadEditor();});});
$('figureList').addEventListener('change',e=>run(()=>selectFigure(e.target.value)));
$('loadExample').addEventListener('click',()=>run(async()=>{
  await finishSurfaceDraft();await finishCardDraft();await commitMotif();const next=await normalizedProject(exampleProject($('example').value));
  corruptSave=false;record(next);selected=project.figures[0]?.id;selectedStructure=project.structures[0]?.id;structureActive=!!selectedStructure;$('angle').value=90;sync();await loadEditor();if(surfaceActive()){await setView('surface');surfaceWorkspace.setAngle(90);surfaceWorkspace.editor?.fit();}else if(drawingActive()){ $('angle').value=100;await setView('card');cardEditor?.fit();}else if(structureActive)await setView('motion');else if(['kirigami','card','surface'].includes(view))await setView('design');scene?.update(project,Number($('angle').value),activeElement());scene?.fit();
}));
$('addFigure').addEventListener('click',()=>run(async()=>{
  let id;await edit(p=>{const f=newFigure({x:p.card.width/2});id=f.id;p.figures.push(f);});await selectFigure(id);
}));
$('duplicateFigure').addEventListener('click',()=>run(async()=>{
  let id;await edit(p=>{const old=p.figures.find(f=>f.id===selected);const f=newFigure({...clone(old),id:undefined,name:old.name+' Kopie',x:old.x+15});f.id=crypto.randomUUID();id=f.id;p.figures.push(f);});await selectFigure(id);
}));
$('removeFigure').addEventListener('click',()=>run(async()=>{await edit(p=>{p.figures=p.figures.filter(f=>f.id!==selected);});sync();await loadEditor();}));
$('applyMotif').addEventListener('click',()=>run(async()=>{editorDirty=true;await commitMotif();}));
$('discardMotif').addEventListener('click',()=>run(async()=>{await loadEditor();$('saveStatus').textContent='Auf diesem Gerät gespeichert';status('Letzten gespeicherten Motivstand wiederhergestellt.');}));
for(const el of document.querySelectorAll('[data-editor]'))el.addEventListener('click',()=>run(()=>editor.command(el.dataset.editor)));
$('addText').addEventListener('click',()=>run(()=>editor.command('addText',{text:$('textInput').value,size:Number($('textSize').value)})));
$('editorOperation').addEventListener('change',()=>run(()=>editor.command('operation',$('editorOperation').value)));
$('svgFile').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;const importAttempt=lastAttemptedImport={kind:'svg',name:file.name,size:file.size};run(async()=>{
  if(file.size>2*1024*1024)throw new Error('SVG-Dateien dürfen höchstens 2 MB groß sein.');
  const raw=await file.text();importAttempt.text=raw;const data=await normalizeSVG(raw);await commitMotif();
  await edit(p=>{const f=p.figures.find(f=>f.id===selected);Object.assign(f,{name:file.name.replace(/\.svg$/i,''),svg:data.svg,contours:data.contours,engravings:data.engravings,sourceTexts:data.sourceTexts});if(data.aspectRatio>0)f.height=Math.max(.1,Math.min(2000,f.width/data.aspectRatio));});
  await loadEditor();if(data.warnings.length)status(data.warnings.join(' '));
}).finally(()=>e.target.value='');});
$('projectFile').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;const importAttempt=lastAttemptedImport={kind:'project',name:file.name,size:file.size};run(async()=>{
  if(file.size>5*1024*1024)throw new Error('Projektdateien dürfen höchstens 5 MB groß sein.');
  const raw=await file.text();importAttempt.text=raw;let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('Projekt nicht geladen: ungültiges JSON.');}
  if(parsed.version===1){showLegacy(raw,'Datei '+file.name);return;}
  let next;try{next=await normalizedProject(parsed);}catch(error){throw new Error('Projekt nicht geladen: '+error.message);}
  await finishSurfaceDraft();await finishCardDraft();await commitMotif();corruptSave=false;record(next);selectedStructure=project.structures[0]?.id;structureActive=!!selectedStructure;sync();if(surfaceActive())await setView('surface');else if(drawingActive())await setView('card');else if(!project.figures.length&&structureActive&&['design','surface'].includes(view))await setView('kirigami');else if(!project.structures.length&&['kirigami','surface'].includes(view))await setView('design');else {await loadEditor();if(view==='kirigami')kirigami();}status('Projekt geladen.');
}).finally(()=>e.target.value='');});
$('saveProject').addEventListener('click',()=>run(async()=>{await finishSurfaceDraft();await finishCardDraft();await commitMotif();download('klappkarte.json',exportProject(project),'application/json');status('Projektdatei gespeichert.');}));
$('downloadSVG').addEventListener('click',()=>run(async()=>{await finishSurfaceDraft();await finishCardDraft();await commitMotif();if(transientInvalid)throw new Error('Bitte zuerst die ungültige Eingabe korrigieren.');download('klappkarte-schnittbogen.svg',exportSVG(project,result),'image/svg+xml');status('Schnittbogen in Millimetern exportiert.');}));
async function undo(redo=false) {
  if(surfaceWorkspace.draft){surfaceWorkspace.cancel();updateDownloads();return;}
  if(cardEditor?.draft){cardEditor.cancel();updateDownloads();return;}
  await commitMotif(); const source=redo?future:history, target=redo?history:future;
  if(!source.length)return;target.push(clone(project));project=source.pop();transientInvalid=false;
  stopMotion();rebuild();saveLocal();await loadEditor();
  if(surfaceActive()&&!['surface','layout','assembly'].includes(view))await setView('surface');
}
$('undo').addEventListener('click',()=>run(()=>undo()));$('redo').addEventListener('click',()=>run(()=>undo(true)));
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z'||e.target.matches('input,textarea'))return;
  e.preventDefault();run(()=>undo(e.shiftKey));
});
function angleLabel(){const value=Number($('angle').value);$('angleValue').textContent=drawingActive()?value+' %':value+'°'+(value===180?' · flach':value===90?' · aufgestellt':'');}
$('angle').addEventListener('input',()=>{stopMotion();angleLabel();if(drawingActive()){$('cardProgress').value=$('angle').value;updateCardPose();}scene?.update(project,Number($('angle').value),activeElement());});
$('fitCamera').addEventListener('click',()=>scene?.fit());
$('playMotion').addEventListener('click',()=>{
  if(motionFrame){stopMotion();return;}
  $('playMotion').textContent='Ⅱ Pause';let continuousAngle=Number($('angle').value);
  const step=time=>{
    const max=Number($('angle').max),dt=motionLast?Math.min(.06,(time-motionLast)/1000):0;motionLast=time;
    let value=continuousAngle+direction*dt*45;
    if(value<=0){value=0;direction=1;}if(value>=max){value=max;direction=-1;}
    continuousAngle=value;$('angle').value=String(value);angleLabel();if(drawingActive()){$('cardProgress').value=value;updateCardPose();}scene?.update(project,value,activeElement());
    motionFrame=requestAnimationFrame(step);
  };motionFrame=requestAnimationFrame(step);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMotion();});
window.addEventListener('beforeunload',e=>{if(editorDirty||cardEditor?.draft||surfaceWorkspace.draft){e.preventDefault();e.returnValue='';}});

async function start() {
  $('downloadSVG').disabled=true;
  let restored=false;
  try {
    const stored=localStorage.getItem(storageKey);
    if(stored)try{project=await normalizedProject(JSON.parse(stored));restored=true;}catch{corruptSave=true;status('Die lokale Sicherung ist beschädigt und bleibt erhalten. Startbeispiel geöffnet.',true);}
  }catch{/* File downloads remain available when local storage is unavailable. */}
  if(!restored)project=await normalizedProject(project);
  try{
    const old=localStorage.getItem(oldStorageKey);
    if(old&&project.legacySourceHash!==await legacyHash(old))showLegacy(old,'Frühere lokale Sicherung');
  }catch(error){status(error.message,true);}
  selected=project.figures[0]?.id;selectedStructure=project.structures[0]?.id;structureActive=!!selectedStructure;rebuild();
  editor=new MotifEditor($('editorHost'),{
    onStatus:message=>{if(view==='design')status(message);},
    onChange:()=>{
      if(loadingEditor)return;
      editorDirty=true;updateDownloads();$('saveStatus').textContent='Motiv wird geprüft …';
      clearTimeout(autoTimer);autoTimer=setTimeout(()=>run(commitMotif),1000);
    }
  });
  await editor.init();if(surfaceActive())await setView('surface');else if(drawingActive())await setView('card');else if(!project.figures.length&&project.structures.length)await setView('kirigami');else await setView('design');saveLocal();updateDownloads();document.body.dataset.ready='true';
  if(corruptSave)status('Beschädigte Sicherung erhalten. Projekt als Datei speichern oder ein Beispiel laden.',true);
}
run(start);
