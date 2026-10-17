// Run through playwright-cli run-code. This suite owns a fresh browser context.
export default async function checkSpirals(rootPage,base='http://127.0.0.1:8766') {
 const context=await rootPage.context().browser().newContext({viewport:{width:1500,height:1100}});
 const page=await context.newPage(),errors=[],passed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const check=(condition,message)=>{if(!condition)throw new Error(message);};
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')));
 const ready=()=>page.waitForFunction(()=>document.querySelector('#editorHost iframe')?.contentWindow?.svgEditor?.svgCanvas&&!document.querySelector('#downloadSVG').disabled);
 const change=async(id,value)=>{await page.locator('#'+id).fill(String(value));await page.locator('#'+id).dispatchEvent('change');};
 const expectField=(key,value)=>page.waitForFunction(({key,value})=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0][key]===value,{key,value});
 const upload=content=>page.evaluate(content=>{const dt=new DataTransfer();dt.items.add(new File([content],'spiral.json',{type:'application/json'}));const input=document.getElementById('projectFile');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));},content);
 const load=async key=>{const previous=JSON.stringify(await saved());await page.locator('#example').selectOption(key);await page.locator('#loadExample').click();await page.waitForFunction(previous=>localStorage.getItem('klappkarten-studio-project-v2')!==previous,previous);await ready();};
 const download=async id=>{const pending=page.waitForEvent('download');await page.locator('#'+id).click();const file=await pending;let content='';for await(const chunk of await file.createReadStream())content+=chunk.toString('utf8');return {file,content};};
 try {
  await page.goto(base+'/klappkarten-studio/');await ready();
  for(const [key,count] of [['spiral',1],['double-spiral',2]]){
   await load(key);const p=await saved();
   check(p.figures.length===0&&p.structures.length===count&&p.structures.every(s=>s.type==='spiral'&&!s.steps),'Dedicated spiral examples retain editable spiral parameters');
   check(await page.locator('#metricParts').innerText()==='1','Spirals remain in one card blank');
   check(await page.locator('#errors').isHidden(),'Valid example '+key);
   await page.waitForSelector('#view-motion:visible canvas');
   await page.locator('#editSpiralNet').click();await page.waitForSelector('#profileHost svg[data-spiral-net]');
   check(await page.locator('#spiralControls').isVisible()&&await page.locator('#addStep').isHidden()&&await page.locator('#stepTableWrap').isHidden(),'Spiral controls replace staircase controls');
   const anchors=await page.locator('#profileHost [data-anchor]').evaluateAll(nodes=>nodes.map(el=>{const p=el.points;return p.numberOfItems>=2?Math.hypot(p.getItem(1).x-p.getItem(0).x,p.getItem(1).y-p.getItem(0).y):0;}));
   check(anchors.length>=2&&anchors.every(length=>Number.isFinite(length)&&length>=1-1e-6),'Net marks finite uncut material anchors');
  }
  passed.push('two editable spiral examples, finite card anchors and dedicated net controls');
  await load('spiral');await page.locator('#editSpiralNet').click();
  await change('spiralRotation',145);await page.waitForSelector('#errors:visible');
  check(await page.locator('#downloadSVG').isDisabled(),'Sub-millimetre inner hinge blocks export while keeping the spiral editable');
  await change('spiralRotation',0);await ready();
  passed.push('too-narrow inner hinges block export and recover through rotation');
  const beforeEdit=JSON.stringify(await saved());
  for(const [id,key,value] of [['structureWidth','width',88],['spiralTurns','turns',2.25],['spiralRibbonWidth','ribbonWidth',3.5],['spiralInnerRadius','innerRadius',8],['spiralHeight','height',32],['spiralLevels','levels',5],['spiralRotation','rotation',30]]){
   await change(id,value);await expectField(key,value);await ready();
  }
  await page.locator('#spiralDirection').selectOption('ccw');await expectField('direction','ccw');await ready();
  const edited=JSON.stringify(await saved());
  check(edited!==beforeEdit,'Parameter edits change the saved design');
  await page.locator('#undo').click();await expectField('direction','cw');await ready();
  await page.locator('#redo').click();await expectField('direction','ccw');await ready();
  check(JSON.stringify(await saved())===edited,'Redo restores the exact edited spiral');
  passed.push('physical dimensions, turns, ribbon, radius, height, levels, rotation and direction; exact undo/redo');
  await change('spiralTurns',0);await page.waitForFunction(()=>document.querySelector('#downloadSVG').disabled);
  check(JSON.stringify(await saved())===edited,'Invalid schema input preserves the last saved spiral');
  await change('spiralTurns',2.25);await ready();
  await change('spiralRibbonWidth',12);await page.waitForSelector('#errors:visible');
  check(await page.locator('#downloadSVG').isDisabled(),'Insufficient space between turns blocks manufacturing');
  await change('spiralRibbonWidth',3.5);await ready();
  await change('spiralHeight',200);await page.waitForSelector('#errors:visible');
  check(await page.locator('#downloadSVG').isDisabled(),'Impossible unfolding height blocks manufacturing');
  await change('spiralHeight',32);await ready();
  await change('structureX',-25);await page.waitForSelector('#errors:visible');
  check(await page.locator('#downloadSVG').isDisabled(),'Out-of-card spiral blocks manufacturing');
  await change('structureX',74);await ready();
  passed.push('invalid input preserves saved data; narrow gaps, impossible heights and misplaced forms block export and recover');
  const valid=JSON.stringify(await saved()),invalid=JSON.parse(valid);invalid.structures[0].direction='invalid';
  await upload(JSON.stringify(invalid));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Projekt nicht geladen'));
  check(JSON.stringify(await saved())===valid,'Rejected project import preserves the active design');
  const json=await download('saveProject');check(JSON.stringify(JSON.parse(json.content))===valid,'Downloaded JSON preserves every editable parameter');
  await page.reload();await ready();check(JSON.stringify(await saved())===valid,'Autosave restores the exact spiral project');
  await upload(json.content);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Projekt geladen.');await ready();
  check(JSON.stringify(await saved())===valid,'Downloaded project round-trips exactly');
  passed.push('rejected import, exact JSON download/import and autosave restoration');
  await page.locator('[data-view="motion"]').click();await page.waitForSelector('#sceneHost canvas');
  for(const angle of [0,45,90,135,180]){await page.locator('#angle').fill(String(angle));await page.locator('#angle').dispatchEvent('input');}
  check(await page.locator('#angleValue').innerText()==='180° · flach','Unfolded manufacturing net is explicitly labelled');
  check(JSON.stringify(await saved())===valid,'Preview movement never changes fabrication parameters');
  await page.locator('#angle').fill('90');await page.locator('#angle').dispatchEvent('input');
  await page.screenshot({path:'output/playwright/spiral-motion.png'});
  passed.push('full opening range remains independent of saved fabrication geometry');
  await page.locator('#editSpiralNet').click();await page.waitForSelector('#profileHost svg[data-spiral-net]');
  await page.screenshot({path:'output/playwright/spiral-net.png'});
  await page.locator('[data-view="layout"]').click();await page.waitForSelector('#layoutHost svg');
  const svg=await download('downloadSVG');await svg.file.saveAs('output/playwright/spiral-cut.svg');
  const machine=await page.evaluate(source=>{
   const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
   if(parsed.querySelector('parsererror'))return {parseError:true};
   const node=document.importNode(parsed.documentElement,true);node.style.position='absolute';node.style.visibility='hidden';document.body.append(node);
   try{
    const paths=[...node.querySelectorAll('path')],cut=[...node.querySelectorAll('#CUT path[data-structure]')],fold=[...node.querySelectorAll('#FOLD_MOUNTAIN path[data-structure],#FOLD_VALLEY path[data-structure]')];
    const angled=cut.filter(path=>{const v=path.getAttribute('d').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number)||[];return v.length>=4&&Math.abs(v[2]-v[0])>.01&&Math.abs(v[3]-v[1])>.01;}).length;
    return {width:node.getAttribute('width'),groups:['CUT','FOLD_MOUNTAIN','FOLD_VALLEY','ENGRAVE'].every(id=>node.querySelector('#'+id)),parts:[...node.querySelectorAll('[data-part]')].map(el=>el.dataset.part),cuts:cut.length,angled,folds:fold.length,finite:paths.every(path=>Number.isFinite(path.getTotalLength())&&path.getTotalLength()>1e-6),foldStraight:fold.every(path=>(path.getAttribute('d').match(/[ML]/gi)||[]).length===2)};
   }finally{node.remove();}
  },svg.content);
  check(!machine.parseError&&machine.width==='600mm'&&machine.groups,'Machine file is valid SVG with millimetres and four operation groups');
  check(machine.parts.length>0&&machine.parts.every(id=>id==='card'),'Machine file contains one integral card');
  check(machine.cuts>40&&machine.angled>20&&machine.folds>2&&machine.finite&&machine.foldStraight,'Actual curved cutting edges and finite straight folds reach the download');
  check(!/<(?:text|script|image)\b|stroke-dasharray|data-preview-only/.test(svg.content),'Machine file excludes labels, active elements and dashed helper lines');
  passed.push('download contains curved cut contours and finite solid folds in one millimetre card');
  await page.locator('#addSpiral').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===2);await page.waitForSelector('#errors:visible');
  check(await page.locator('#downloadSVG').isDisabled(),'Overlapping new spiral blocks export');
  await page.locator('#removeStructure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===1);await ready();
  await page.locator('#duplicateStructure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===2);
  const duplicate=(await saved()).structures[1],original=(await saved()).structures[0];
  check(duplicate.id!==original.id&&duplicate.type==='spiral'&&['width','turns','ribbonWidth','innerRadius','rotation','direction','levels','height'].every(key=>duplicate[key]===original[key]),'Duplicate keeps editable spiral settings with its own identity');
  await page.locator('#removeStructure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===1);await ready();
  passed.push('add, overlap rejection, parameter-preserving duplicate and delete');
  await load('terraces');await page.locator('#editStructure').click();await page.waitForSelector('#stepTableWrap:visible');
  check(await page.locator('#spiralControls').isHidden()&&await page.locator('#addStep').isVisible(),'Existing stair editor retains its own controls');
  const stairs=JSON.stringify(await saved());await upload(stairs);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Projekt geladen.');await ready();
  check(JSON.stringify(await saved())===stairs,'Existing staircase project imports without conversion');
  await load('animals');await page.waitForSelector('#view-design:visible');
  const oldMotif=await saved();delete oldMotif.structures;
  await upload(JSON.stringify(oldMotif));await page.waitForFunction(()=>document.querySelector('#status').textContent==='Projekt geladen.');await ready();
  check((await saved()).figures.length===3&&(await saved()).structures.length===0,'Earlier motif-only v2 projects remain supported');
  check(await page.locator('#spiralControls').isHidden(),'Motif editing hides spiral-only tools');
  await upload(json.content);await page.waitForSelector('#view-kirigami:visible');await ready();
  check(await page.locator('#spiralControls').isVisible(),'Import restores the appropriate spiral tools');
  passed.push('stairs and earlier motif-only projects remain editable across mode switches');
  for(const width of [390,320]){
   await page.setViewportSize({width,height:900});await page.locator('#editSpiralNet').click();
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Spiral net and controls fit '+width+' px');
  }
  passed.push('320/390 px net and controls');
  check(errors.length===0,'Browser errors: '+errors.join('; '));return {passed,browserErrors:errors};
 }finally{await context.close();}
}
