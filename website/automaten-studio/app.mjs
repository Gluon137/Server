import {createProject, clone, validateProject, motifs, useMotif, parameterRanges} from './project.mjs';
import {buildProject, poseProject} from './geometry.mjs';
import {packSheets, exportSVG, exportPartsList, exportAssemblyHTML} from './export.mjs';

const $ = id => document.getElementById(id);
const KEY = 'automaten-studio-project-v1';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => Number.isFinite(value) ? new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(value) : '—';
let project=createProject(), model, packed, view='motion', angle=0, frame=0, lastTime=0, timer=0, revision=0, moving=[], bounds;
let drawing=null, selected=-1, anchorMode=false, dragging=false, cursor=[50,50];
let startupNotice='';

function checked(input) {
  const result=validateProject(input);
  if(result.valid===false)throw new Error(result.errors.join(' '));
  return result.project || result;
}
try {
  const saved=localStorage.getItem(KEY);
  if(saved)project=checked(JSON.parse(saved));
} catch(error) {startupNotice='Die Browsersicherung wurde nicht geladen: '+error.message+' Das gespeicherte Original bleibt erhalten.';}

function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function showErrors(errors){$('errors').hidden=!errors.length;$('errors').innerHTML=errors.length?'<ul>'+errors.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'';}
function disableExport(disabled){for(const id of ['downloadSVG','downloadParts','downloadAssembly'])$(id).disabled=disabled;}
function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(project));$('saveStatus').textContent='Im Browser gesichert · Projektdatei als zusätzliche Sicherung speichern.';}
  catch{$('saveStatus').textContent='Browsersicherung nicht verfügbar. Bitte das Projekt als Datei speichern.';}
}
function syncFields(){
  for(const input of document.querySelectorAll('[data-path]')){
    const [section,key]=input.dataset.path.split('.');input.value=project[section][key];
    const range=parameterRanges[section]?.[key];if(range){input.min=range[0];input.max=range[1];}
  }
  $('figurePreset').value=Object.hasOwn(motifs,project.figure.motif)?project.figure.motif:'custom';
  updateMechanism();
}
function updateMechanism(){
  const type=$('mechanism').value;
  for(const field of document.querySelectorAll('[data-types]'))field.hidden=!field.dataset.types.split(' ').includes(type);
  $('mechanismDescription').textContent={slider:'Eine Stange verwandelt die Drehung in ein sanftes Auf und Ab.',eccentric:'Die versetzte Scheibe hebt und senkt einen geführten Rahmen.',lever:'Eine Koppelstange bringt den gelagerten Hebel zum Schwingen.'}[type];
}
function readFields(){
  const next=clone(project);
  for(const input of document.querySelectorAll('[data-path]')){
    const [section,key]=input.dataset.path.split('.');
    next[section][key]=input.type==='number'?input.valueAsNumber:input.value;
  }
  return checked(next);
}
function rebuild({save=true}={}){
  pause();clearTimeout(timer);timer=0;
  try{
    const next=readFields();
    model=buildProject(next);project=next;revision++;
    packed=packSheets(model);
    const errors=[...(model.errors||[]),...(packed.errors||[])];
    disableExport(!model.valid||errors.length>0);showErrors(errors);
    $('play').disabled=!model.valid||view!=='motion';
    $('angle').disabled=!model.valid||view!=='motion';
    $('movementMetric').textContent=project.mechanism.type==='lever'?fmt(model.metrics.swing)+'°':fmt(model.metrics.stroke)+' mm';
    $('movementLabel').textContent=project.mechanism.type==='lever'?'Schwenkwinkel':'Hub';
    $('partsMetric').textContent=String(model.parts.length);$('sheetsMetric').textContent=String(packed.sheets.length);
    const old=$('sheetSelect').selectedIndex;
    $('sheetSelect').replaceChildren(...packed.sheets.map((sheet,index)=>new Option('Bogen '+(index+1)+' / '+packed.sheets.length,String(index))));
    if(old>=0&&old<packed.sheets.length)$('sheetSelect').selectedIndex=old;
    renderChecks();calculateBounds();renderScene();
    status(errors.length?'Bitte die markierten Einstellungen korrigieren.':'Dein Entwurf · '+{slider:'Kurbel & Schubstange',eccentric:'Exzenter & Kulisse',lever:'Kurbel & Kipphebel'}[project.mechanism.type]+' · '+model.parts.length+' Schnittteile',errors.length>0);
    if(save)persist();
  }catch(error){disableExport(true);pause();$('play').disabled=true;$('angle').disabled=true;showErrors([error.message]);status('Entwurf nicht übernommen. Bitte die Eingaben prüfen.',true);}
}
function renderChecks(){
  const checks=[['Kinematik',model.checks.kinematics],['Kollisionsprüfung',model.checks.collision]];
  $('checks').innerHTML=checks.map(([label,check])=>'<div class="check-row '+(check.status==='pass'?'':'warning')+'"><span class="check-mark" aria-hidden="true">'+(check.status==='pass'?'✓':'○')+'</span><div><strong>'+esc(label)+'</strong><p>'+esc(check.text)+'</p></div></div>').join('')+
    (model.warnings||[]).map(warning=>'<div class="small">'+esc(warning)+'</div>').join('');
}
function calculateBounds(){
  bounds=null;
  if(!model.valid)return;
  for(let a=0;a<360;a+=15){
    const b=poseProject(model,a).bounds;if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite))continue;
    if(!bounds)bounds={...b};else{
      const right=Math.max(bounds.x+bounds.width,b.x+b.width),bottom=Math.max(bounds.y+bounds.height,b.y+b.height);
      bounds.x=Math.min(bounds.x,b.x);bounds.y=Math.min(bounds.y,b.y);bounds.width=right-bounds.x;bounds.height=bottom-bounds.y;
    }
  }
}
const contourPath=contours=>contours.map(points=>'M'+points.map(p=>p.join(' ')).join('L')+'Z').join(' ');
function renderScene(){
  moving=[];
  if(!model?.valid){$('scene').replaceChildren();return;}
  $('viewCaption').textContent=view==='motion'?'SEITENANSICHT · BAUEBENEN':'SCHNITTBOGEN · NOMINALE MASSE';
  if(view==='cut'){
    if(!packed.sheets.length||packed.errors.length){$('scene').replaceChildren();return;}
    try{
      const source=new DOMParser().parseFromString(exportSVG(model,Number($('sheetSelect').value)||0),'image/svg+xml').documentElement;
      $('scene').setAttribute('viewBox',source.getAttribute('viewBox'));
      $('scene').replaceChildren(...Array.from(source.childNodes).map(node=>document.importNode(node,true)));
    }catch(error){status(error.message,true);disableExport(true);$('scene').replaceChildren();}
    return;
  }
  const b=bounds||poseProject(model,angle).bounds;
  $('scene').setAttribute('viewBox',`${b.x-14} ${b.y-14} ${b.width+28} ${b.height+28}`);
  const lookup=new Map(model.parts.map(part=>[part.id,part]));
  const entries=poseProject(model,angle).entries.filter(entry=>lookup.has(entry.id));
  entries.sort((a,b)=>(lookup.get(a.id).layer||0)-(lookup.get(b.id).layer||0));
  $('scene').innerHTML=entries.filter(entry=>$('showFrame').checked||lookup.get(entry.id).kind!=='frame').map(entry=>{
    const part=lookup.get(entry.id),isFrame=part.kind==='frame';
    const fill=part.kind==='figure'?project.figure.color:isFrame?'#d9c7a7':/crank|eccentric|drive/i.test(part.id)?'#a4b789':'#87a296';
    return '<g data-part="'+esc(part.id)+'" transform="translate('+entry.x+' '+entry.y+') rotate('+entry.rotation+')"><title>'+esc(part.id+' · '+part.name)+'</title><path d="'+contourPath(part.contours)+'" fill="'+fill+'" fill-opacity="'+(isFrame?'.34':'.96')+'" fill-rule="evenodd" stroke="'+(isFrame?'#aa9573':'#486651')+'" stroke-width="0.5" stroke-linejoin="round"/></g>';
  }).join('')+'<g id="jointMarkers" fill="none" stroke="#9b603f" stroke-width="0.4" pointer-events="none"></g>';
  moving=Array.from($('scene').querySelectorAll('[data-part]')).map(el=>({id:el.dataset.part,el}));
  updateAngle();
}
function updateAngle(){
  $('angle').value=angle;$('angleValue').textContent=fmt(angle)+'°';
  if(!model?.valid||view!=='motion')return;
  const pose=poseProject(model,angle),lookup=new Map(pose.entries.map(entry=>[entry.id,entry]));
  for(const {id,el} of moving){const p=lookup.get(id);if(p)el.setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${p.rotation})`);}
  const marks=$('jointMarkers');
  if(marks)marks.innerHTML=$('showAxes').checked?pose.joints.map(([x,y])=>'<g transform="translate('+x+' '+y+')"><circle r="1.5"/><path d="M-3 0H3M0-3V3"/></g>').join(''):'';
}
function pause(){if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0;$('play').textContent='▶';$('play').setAttribute('aria-label','Bewegung starten');$('play').setAttribute('aria-pressed','false');}
function tick(time){
  if(!model?.valid||view!=='motion'){pause();return;}
  if(lastTime)angle=(angle+Math.min(time-lastTime,80)/1000*Number($('speed').value)*6)%360;
  lastTime=time;updateAngle();frame=requestAnimationFrame(tick);
}
$('play').addEventListener('click',()=>{if(frame){pause();return;}if(!model?.valid||view!=='motion')return;$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Bewegung pausieren');$('play').setAttribute('aria-pressed','true');frame=requestAnimationFrame(tick);});
$('angle').addEventListener('input',()=>{pause();angle=$('angle').valueAsNumber;updateAngle();});
$('speed').addEventListener('input',()=>{$('speedValue').textContent=$('speed').value+' U/min';});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
for(const id of ['showFrame','showAxes'])$(id).addEventListener('change',renderScene);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
  pause();view=button.dataset.view;for(const item of document.querySelectorAll('[data-view]'))item.setAttribute('aria-pressed',String(item===button));
  $('play').disabled=!model?.valid||view!=='motion';$('angle').disabled=!model?.valid||view!=='motion';renderScene();
});
for(const input of document.querySelectorAll('[data-path]')){
  input.addEventListener('input',()=>{revision++;disableExport(true);pause();clearTimeout(timer);timer=setTimeout(rebuild,110);});
  input.addEventListener('change',()=>{updateMechanism();rebuild();});
}
$('figurePreset').addEventListener('change',()=>{
  if($('figurePreset').value==='custom'){openDrawing(false);return;}
  try{project=useMotif(project,$('figurePreset').value);syncFields();rebuild();}catch(error){status(error.message,true);}
});
$('sheetSelect').addEventListener('change',()=>{if(view==='cut')renderScene();});

function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportAction(action){try{if(timer)rebuild();if($('downloadSVG').disabled)throw new Error('Bitte zuerst die fehlerhaften Einstellungen korrigieren.');action();}catch(error){status('Export nicht möglich: '+error.message,true);}}
$('downloadSVG').addEventListener('click',()=>exportAction(()=>{const index=Number($('sheetSelect').value)||0;download(exportSVG(model,index),`Automat-Bogen-${index+1}.svg`,'image/svg+xml');}));
$('downloadParts').addEventListener('click',()=>exportAction(()=>download(exportPartsList(model),'Automat-Teileliste.csv','text/csv;charset=utf-8')));
$('downloadAssembly').addEventListener('click',()=>exportAction(()=>download(exportAssemblyHTML(model),'Automat-Bauanleitung.html','text/html;charset=utf-8')));
$('saveProject').addEventListener('click',()=>{
  try{const next=readFields();download(JSON.stringify(next,null,2)+'\n','Automat-Projekt.json','application/json');}
  catch(error){status('Projekt nicht gespeichert: '+error.message+' Der letzte übernommene Entwurf bleibt in der Browsersicherung.',true);}
});
$('openProject').addEventListener('click',()=>$('projectFile').click());
$('projectFile').addEventListener('change',async()=>{
  const file=$('projectFile').files[0];$('projectFile').value='';if(!file)return;
  const started=revision;
  try{
    if(file.size>1024*1024)throw new Error('Projektdateien dürfen höchstens 1 MiB groß sein.');
    const next=checked(JSON.parse(await file.text()));
    if(started!==revision)throw new Error('Der Entwurf wurde inzwischen verändert. Bitte die Datei erneut öffnen.');
    project=next;syncFields();rebuild();
    if(model.valid)status('Projekt geladen · '+file.name);else status('Projekt geladen. Bitte die markierten Einstellungen korrigieren.',true);
  }catch(error){status('Projekt nicht geladen: '+error.message,true);}
});

function openDrawing(fresh){
  try{readFields();}catch(error){status('Bitte vor dem Zeichnen die Eingaben korrigieren: '+error.message,true);return;}
  pause();drawing={points:fresh?[]:clone(project.figure.points),anchor:clone(project.figure.anchor),closed:!fresh};selected=-1;anchorMode=false;cursor=[50,50];
  $('figurePreset').value=Object.hasOwn(motifs,project.figure.motif)?project.figure.motif:'custom';
  $('drawingStatus').textContent=fresh?'Klicke für mindestens drei Punkte. Danach die Kontur schließen und übernehmen.':'Wähle einen Punkt zum Verschieben oder setze die Klebestelle neu.';
  renderDrawing();$('figureDialog').showModal();if(fresh)$('drawingSVG').focus();
}
function closeDrawing(){$('figureDialog').close();drawing=null;dragging=false;}
$('drawNew').addEventListener('click',()=>openDrawing(true));$('editContour').addEventListener('click',()=>openDrawing(false));
$('cancelDrawing').addEventListener('click',closeDrawing);
$('figureDialog').addEventListener('cancel',()=>{drawing=null;dragging=false;});
$('anchorMode').addEventListener('click',()=>{anchorMode=!anchorMode;renderDrawing();$('drawingStatus').textContent=anchorMode?'Klicke in die Figur, um die Klebestelle zu setzen.':'Punkt auswählen oder verschieben.';});
function renderDrawing(){
  if(!drawing)return;
  $('anchorMode').setAttribute('aria-pressed',String(anchorMode));$('drawingSVG').classList.toggle('anchor-mode',anchorMode);
  $('pointCount').textContent=drawing.points.length+' / 256 Punkte';$('deletePoint').disabled=selected<0;
  const points=drawing.points.map(p=>p.join(',')).join(' '),[x,y]=drawing.anchor;
  $('drawingSVG').innerHTML='<'+(drawing.closed?'polygon':'polyline')+' points="'+points+'" fill="'+(drawing.closed?project.figure.color+'55':'none')+'" stroke="#24594b" stroke-width=".5" stroke-linejoin="round"/>'+
    '<g pointer-events="none" stroke="#a56b42" stroke-width=".4" fill="none"><ellipse cx="'+x+'" cy="'+y+'" rx="'+(600/project.figure.width)+'" ry="'+(600/project.figure.height)+'" stroke-dasharray="1.4 1"/><path d="M'+(x-2)+' '+y+'h4M'+x+' '+(y-2)+'v4"/></g>'+
    drawing.points.map(([px,py],index)=>'<circle data-index="'+index+'" tabindex="0" role="button" aria-label="Punkt '+(index+1)+'" cx="'+px+'" cy="'+py+'" r="'+(index===selected?'1.5':'1.05')+'" fill="'+(index===selected?'#24594b':'white')+'" stroke="#24594b" stroke-width=".45"/>').join('')+
    (!drawing.closed&&selected<0?'<path d="M'+(cursor[0]-2)+' '+cursor[1]+'h4M'+cursor[0]+' '+(cursor[1]-2)+'v4" stroke="#687c4e" stroke-width=".4" pointer-events="none"/>':'');
}
function drawingPoint(event){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform($('drawingSVG').getScreenCTM().inverse());return [p.x,p.y].map(n=>Math.max(0,Math.min(100,Math.round(n*10)/10)));}
$('drawingSVG').addEventListener('pointerdown',event=>{
  if(!drawing||event.button!==0)return;event.preventDefault();
  const point=drawingPoint(event),index=event.target.dataset.index;
  if(anchorMode){drawing.anchor=point;renderDrawing();return;}
  if(index!==undefined){
    selected=Number(index);
    if(selected===0&&!drawing.closed&&drawing.points.length>=3){drawing.closed=true;renderDrawing();$('drawingStatus').textContent='Kontur geschlossen. Prüfe die Klebestelle und übernimm deine Figur.';return;}
    dragging=true;$('drawingSVG').setPointerCapture(event.pointerId);renderDrawing();return;
  }
  if(drawing.closed){selected=-1;renderDrawing();return;}
  if(drawing.points.length>=256){$('drawingStatus').textContent='Höchstens 256 Punkte pro Figur.';return;}
  drawing.points.push(point);selected=drawing.points.length-1;renderDrawing();
});
$('drawingSVG').addEventListener('pointermove',event=>{if(!drawing||!dragging||selected<0)return;drawing.points[selected]=drawingPoint(event);renderDrawing();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('drawingSVG').addEventListener(event,()=>{dragging=false;});
function deleteSelected(){
  if(!drawing||selected<0)return;
  drawing.points.splice(selected,1);selected=Math.min(selected,drawing.points.length-1);
  if(drawing.points.length<3)drawing.closed=false;
  renderDrawing();
  ($('drawingSVG').querySelector(`[data-index="${selected}"]`)||$('drawingSVG')).focus();
}
$('deletePoint').addEventListener('click',deleteSelected);
$('drawingSVG').addEventListener('focusin',event=>{if(event.target.dataset.index!==undefined){selected=Number(event.target.dataset.index);$('deletePoint').disabled=false;}});
$('drawingSVG').addEventListener('keydown',event=>{
  if(!drawing)return;
  if(event.target.dataset.index!==undefined)selected=Number(event.target.dataset.index);
  if(['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteSelected();return;}
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(delta&&selected>=0){event.preventDefault();const step=event.shiftKey?5:1;drawing.points[selected]=drawing.points[selected].map((n,i)=>Math.max(0,Math.min(100,n+delta[i]*step)));renderDrawing();$('drawingSVG').querySelector(`[data-index="${selected}"]`)?.focus();}
  else if(delta){event.preventDefault();const step=event.shiftKey?5:1;cursor=cursor.map((n,i)=>Math.max(0,Math.min(100,n+delta[i]*step)));renderDrawing();$('drawingStatus').textContent='Zeichencursor: '+cursor.join(' / ')+'. Enter setzt einen Punkt.';}
  if(event.key==='Enter'||event.key===' '){
    event.preventDefault();
    if(event.target.dataset.index!==undefined){selected=-1;$('drawingSVG').focus();renderDrawing();return;}
    if(anchorMode){drawing.anchor=[...cursor];renderDrawing();return;}
    if(!drawing.closed&&drawing.points.length<256){drawing.points.push([...cursor]);selected=-1;renderDrawing();$('drawingStatus').textContent='Punkt gesetzt. Pfeiltasten bewegen den Cursor; Enter setzt den nächsten Punkt.';}
  }
});
$('closeContour').addEventListener('click',()=>{
  if(!drawing)return;
  try{
    const next=clone(project);next.figure={...next.figure,motif:'custom',points:clone(drawing.points),anchor:clone(drawing.anchor)};
    checked(next);const built=buildProject(next);if(!built.valid)throw new Error(built.errors.join(' '));
    project=next;closeDrawing();syncFields();rebuild();status('Deine Figur wurde übernommen.');
  }catch(error){$('drawingStatus').textContent='Figur nicht übernommen: '+error.message;}
});

syncFields();rebuild({save:!startupNotice});if(startupNotice)status(startupNotice,true);
window.WorkshopReports?.register({capture:()=>({document:clone(project),project:clone(project),angle,view,drawing:drawing?clone(drawing):null,checks:model?.checks}),preview:()=>$('scene')});
