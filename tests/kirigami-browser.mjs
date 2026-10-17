// Run through playwright-cli run-code; all changes belong to a fresh browser context.
export default async function checkKirigami(rootPage,base='http://127.0.0.1:8766') {
 const context=await rootPage.context().browser().newContext({viewport:{width:1500,height:1100}});
 const page=await context.newPage(),errors=[],passed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const check=(condition,message)=>{if(!condition)throw new Error(message);};
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')));
 const change=async(id,value)=>{await page.locator('#'+id).fill(String(value));await page.locator('#'+id).dispatchEvent('change');};
 const ready=()=>page.waitForFunction(()=>document.querySelector('#editorHost iframe')?.contentWindow?.svgEditor?.svgCanvas&&!document.querySelector('#downloadSVG').disabled);
 const upload=async(content)=>page.evaluate(content=>{const dt=new DataTransfer();dt.items.add(new File([content],'kirigami.json',{type:'application/json'}));const el=document.getElementById('projectFile');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));},content);
 try {
  await page.goto(base+'/klappkarten-studio/');await ready();
  for(const [key,count] of [['terraces',4],['blocks',5],['wave',4]]) {
   await page.locator('#example').selectOption(key);await page.locator('#loadExample').click();
   await page.waitForFunction(count=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===count,count);
   await ready();await page.waitForSelector('#view-motion:visible canvas');
   check((await saved()).figures.length===0,'Architecture example contains broad bands');
   check(await page.locator('#metricParts').innerText()==='1','One card blank');
   check(await page.locator('#errors').isHidden(),'Valid architecture '+key);
  }
  passed.push('three architectural examples with broad multi-step surfaces');
  const unchanged=JSON.stringify(await saved());
  for(const angle of [0,90,180]){await page.locator('#angle').fill(String(angle));await page.locator('#angle').dispatchEvent('input');}
  check(unchanged===JSON.stringify(await saved()),'Angle only changes preview');
  await page.locator('#angle').fill('90');await page.locator('#angle').dispatchEvent('input');
  await page.screenshot({path:'output/playwright/kirigami-motion.png'});
  await page.locator('#editStructure').click();await page.waitForSelector('#view-kirigami:visible svg');
  const before=await saved(),oldRise=before.structures[0].steps[0].rise;
  await page.locator('[data-step="0"][data-key="rise"]').fill(String(oldRise+1));await page.locator('[data-step="0"][data-key="rise"]').dispatchEvent('change');
  await page.waitForFunction(rise=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0].steps[0].rise===rise,oldRise+1);
  await page.locator('#undo').click();await page.waitForFunction(rise=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0].steps[0].rise===rise,oldRise);
  await page.locator('#redo').click();await page.waitForFunction(rise=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0].steps[0].rise===rise,oldRise+1);
  await page.locator('#addStep').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0].steps.length===5);
  await page.locator('[data-remove-step="4"]').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures[0].steps.length===4);
  passed.push('editable dimensions, add/remove steps and project undo/redo');
  const valid=JSON.stringify(await saved());
  await page.locator('[data-step="0"][data-key="run"]').fill('0');await page.locator('[data-step="0"][data-key="run"]').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#downloadSVG').disabled);
  check(JSON.stringify(await saved())===valid,'Invalid step preserves saved project');
  await page.locator('[data-step="0"][data-key="run"]').fill('8');await page.locator('[data-step="0"][data-key="run"]').dispatchEvent('change');await ready();
  await change('structureX',-50);await page.waitForSelector('#errors:visible');check(await page.locator('#downloadSVG').isDisabled(),'Out-of-card band blocks export');
  await change('structureX',before.structures[0].x);await ready();
  await page.locator('[data-step="0"][data-key="rise"]').fill('150');await page.locator('[data-step="0"][data-key="rise"]').dispatchEvent('change');
  await page.waitForSelector('#errors:visible');check(await page.locator('#downloadSVG').isDisabled(),'Closed envelope failure blocks export');
  await page.locator('#undo').click();await ready();
  passed.push('invalid steps preserve data; invalid placement and closure block export');
  const validProject=JSON.stringify(await saved()),hostile=JSON.parse(validProject);hostile.structures[0].steps=Array.from({length:13},()=>({rise:2,run:2}));
  await upload(JSON.stringify(hostile));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Projekt nicht geladen'));
  check(JSON.stringify(await saved())===validProject,'Oversized profile import preserves active project');
  const downloadPromise=page.waitForEvent('download');await page.locator('#saveProject').click();let json='';for await(const chunk of await(await downloadPromise).createReadStream())json+=chunk.toString('utf8');
  check(JSON.stringify(JSON.parse(json))===validProject,'Saved file preserves exact profile');
  await page.reload();await ready();await page.waitForSelector('#view-kirigami:visible');check(JSON.stringify(await saved())===validProject,'Reload restores complete staircase');
  await upload(json);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Projekt geladen.');
  check(JSON.stringify(await saved())===validProject,'JSON round trip');
  passed.push('bounded profile import, JSON download/import and autosave reload');
  await page.screenshot({path:'output/playwright/kirigami-profile.png'});
  await page.locator('[data-view="layout"]').click();await page.waitForSelector('#layoutHost svg');
  const svgPromise=page.waitForEvent('download');await page.locator('#downloadSVG').click();const downloaded=await svgPromise;
  let svg='';for await(const chunk of await downloaded.createReadStream())svg+=chunk.toString('utf8');
  await downloaded.saveAs('output/playwright/kirigami-cut.svg');
  check(svg.includes('data-structure=')&&svg.includes('width="600mm"'),'Machine file has architecture metadata and millimetres');
  check(!/<text\b|stroke-dasharray|data-preview-only/.test(svg),'Only machine operations');
  check([...svg.matchAll(/data-part="([^"]+)"/g)].every(m=>m[1]==='card'),'Single connected card');
  passed.push('one-sheet SVG with solid, separate cut/mountain/valley operations');
  await page.locator('#duplicateStructure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===5);
  await page.locator('#removeStructure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).structures.length===4);await ready();
  await page.locator('#figureSettings > summary').click();await page.locator('#addFigure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).figures.length===1);
  await page.locator('#removeFigure').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('klappkarten-studio-project-v2')).figures.length===0);await ready();
  passed.push('bands duplicate/remove and coexist with editable motifs');
  for(const width of [390,320]){await page.setViewportSize({width,height:900});await page.locator('#editStructure').click();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile horizontal overflow '+width);}
  passed.push('320/390 px layout');
  await page.locator('#example').selectOption('animals');await page.locator('#loadExample').click();await page.waitForSelector('#view-design:visible');await ready();
  check((await saved()).structures.length===0,'Figure example leaves empty architecture editor');
  await upload(json);await page.waitForSelector('#view-kirigami:visible');await ready();check((await saved()).figures.length===0,'Architecture import leaves empty drawing editor');
  passed.push('editor follows figure/architecture example and project changes');
  check(errors.length===0,'Browser errors: '+errors.join('; '));return {passed,browserErrors:errors};
 } finally {await context.close();}
}
