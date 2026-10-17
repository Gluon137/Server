// Run with playwright-cli run-code; owns an isolated browser context and storage.
export default async function checkAutomaten(rootPage,base='http://127.0.0.1:8769') {
 const context=await rootPage.context().browser().newContext({viewport:{width:1440,height:1050}});
 const page=await context.newPage(),errors=[],passed=[];
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 page.on('pageerror',error=>errors.push(error.message));
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('automaten-studio-project-v1')));
 const ready=()=>page.waitForFunction(()=>document.querySelector('#scene path')&&!document.querySelector('#downloadSVG').disabled);
 const change=async(id,value)=>{await page.locator('#'+id).fill(String(value));await page.locator('#'+id).dispatchEvent('input');await page.locator('#'+id).dispatchEvent('change');};
 const upload=async(content,name='project.json')=>page.evaluate(({content,name})=>{const dt=new DataTransfer();dt.items.add(new File([content],name,{type:'application/json'}));document.querySelector('#status').textContent='';const el=document.querySelector('#projectFile');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));},{content,name});
 const download=async id=>{const event=page.waitForEvent('download');await page.locator('#'+id).click();const file=await event;let text='';for await(const chunk of await file.createReadStream())text+=chunk.toString('utf8');return {file,text};};
 const point=async(x,y)=>{const screen=await page.locator('#drawingSVG').evaluate((svg,[x,y])=>{const p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y};},[x,y]);await page.mouse.click(screen.x,screen.y);};
 try {
  await page.goto(base+'/automaten-studio/');await ready();
  check((await saved()).format==='automaten-studio','Default project autosaves');
  for(const mechanism of ['slider','eccentric','lever']){
   await page.locator('#mechanism').selectOption(mechanism);await ready();
   check((await saved()).mechanism.type===mechanism,'Mechanism control changes saved project');
   for(const motif of ['bird','wave','flower']){await page.locator('#figurePreset').selectOption(motif);await ready();check((await saved()).figure.motif===motif,'Motif '+motif+' applied to '+mechanism);}
   const before=JSON.stringify(await saved());
   for(const angle of [0,90,180,270,360]){await change('angle',angle);check((await page.locator('#angleValue').innerText()).includes(String(angle)),'Scrubber displays angle '+angle);}
   await change('angle',0);await page.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#angle').value)>1);await page.locator('#play').click();
   check(JSON.stringify(await saved())===before,'Animation does not mutate fabrication state');
   await page.locator('#showFrame').uncheck();await page.locator('#showFrame').check();await page.locator('#showAxes').uncheck();await page.locator('#showAxes').check();
  }
  passed.push('all three mechanisms and all motifs, scrubber, animation and view toggles');
  await page.locator('#mechanism').selectOption('slider');await ready();
  const radius=(await saved()).mechanism.radius;
  await change('radius',0);await page.waitForFunction(()=>document.querySelector('#downloadSVG').disabled);
  check((await page.locator('#errors').innerText()).trim().length>0,'Invalid geometry has a visible reason');
  await change('radius',radius);await ready();check(!await page.locator('#downloadSVG').isDisabled(),'Corrected input re-enables fabrication');
  const length=(await saved()).mechanism.rodLength;await change('rodLength',10);await page.waitForFunction(()=>document.querySelector('#downloadSVG').disabled);await change('rodLength',length);await ready();
  await change('radius',5);await page.waitForFunction(()=>document.querySelector('#downloadSVG').disabled);const editableInvalid=await download('saveProject');check(JSON.parse(editableInvalid.text).mechanism.radius===5,'Schema-valid infeasible project remains saveable');await change('radius',radius);await ready();
  await upload(editableInvalid.text,'editable-invalid.json');await page.waitForFunction(()=>Number(document.querySelector('#radius').value)===5&&document.querySelector('#downloadSVG').disabled);check((await saved()).mechanism.radius===5,'Saved infeasible project opens for repair');await change('radius',radius);await ready();
  passed.push('numeric and kinematic failures block exports and recover');
  const keyboardBefore=JSON.stringify(await saved());await page.locator('#drawNew').click();
  check(await page.locator('#drawingSVG').evaluate(el=>el===document.activeElement),'New contour focuses keyboard drawing cursor');
  await page.keyboard.press('Enter');for(let i=0;i<4;i++)await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Enter');for(let i=0;i<4;i++)await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Enter');
  check(await page.locator('#drawingSVG [data-index]').count()===3,'Keyboard cursor creates three contour vertices');
  await page.keyboard.press('Tab');check(await page.locator(':focus').getAttribute('data-index')==='0','Tab selects the first vertex');await page.keyboard.press('ArrowLeft');check(Number(await page.locator('#drawingSVG [data-index="0"]').getAttribute('cx'))===49,'Arrow key moves the selected vertex');await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');await page.keyboard.press('Delete');check(await page.locator('#drawingSVG [data-index]').count()===2,'Delete removes the selected vertex');check(await page.locator('#drawingSVG').evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),'Deleting a keyboard vertex retains editor focus');
  await page.locator('#cancelDrawing').click();check(JSON.stringify(await saved())===keyboardBefore,'Cancelled keyboard drawing preserves saved project');passed.push('keyboard contour creation and vertex adjustment');
  const beforeDrawing=JSON.stringify(await saved());await page.locator('#drawNew').click();await point(10,10);await point(90,10);await page.locator('#cancelDrawing').click();check(JSON.stringify(await saved())===beforeDrawing,'Cancelled drawing preserves project');
  await page.locator('#drawNew').click();for(const [x,y] of [[10,10],[90,10],[90,90],[10,90]])await point(x,y);await page.locator('#closeContour').click();await ready();
  check((await saved()).figure.motif==='custom'&&(await saved()).figure.points.length===4,'Closed authored contour becomes a custom fabrication figure');
  await page.locator('#editContour').click();await page.locator('#anchorMode').click();await point(50,60);await page.locator('#closeContour').click();await ready();
  check(Math.abs((await saved()).figure.anchor[0]-50)<1&&Math.abs((await saved()).figure.anchor[1]-60)<1,'Custom anchor is applied');
  await page.locator('#editContour').click();await point(10,10);await page.locator('#deletePoint').click();await page.locator('#cancelDrawing').click();
  passed.push('custom contour creation, anchor placement, point editing and cancelled transactions');
  for(const [id,value] of [['thickness',4],['dowel',5],['running',.25],['glue',.05],['axial',.4],['slide',.4]])await change(id,value);
  await ready();check((await saved()).material.dowel===5&&(await saved()).material.running===.25,'Calibration settings persist');
  const svg=await download('downloadSVG');check(svg.file.suggestedFilename().endsWith('.svg')&&/width="[\d.]+mm"/.test(svg.text),'SVG download uses millimetres');check(!/<(?:text|script|image|foreignObject)\b|NaN|Infinity/.test(svg.text),'Machine SVG excludes preview-only content');
  const parts=await download('downloadParts');check(parts.file.suggestedFilename().endsWith('.csv')&&/5/.test(parts.text),'Parts CSV download includes calibrated dowels');
  const assembly=await download('downloadAssembly');check(/html/i.test(assembly.file.suggestedFilename())&&/@media print/.test(assembly.text),'Assembly HTML is printable');
  const project=await download('saveProject');check(JSON.parse(project.text).format==='automaten-studio','Saved project is valid JSON');
  passed.push('calibration and SVG, parts list, printable instructions, project downloads');
  const raw=JSON.stringify(await saved());await page.reload();await ready();check(JSON.stringify(await saved())===raw,'Reload restores authored project exactly');
  for(const content of ['{bad json','{"format":"automaten-studio","version":999}',JSON.stringify({...JSON.parse(raw),figure:{...JSON.parse(raw).figure,points:[[0,0],[100,100],[0,100],[100,0]]}})]){
   await upload(content);await page.waitForFunction(()=>/nicht|fehler|ungültig/i.test(document.querySelector('#status').textContent));check(JSON.stringify(await saved())===raw,'Malformed upload preserves saved project');
  }
  await upload(project.text);await ready();check(JSON.stringify(await saved())===raw,'Valid project round trip');
  passed.push('saved reload, project round trip and malformed import preservation');
  await page.locator('#problem-report-button').click();const reportDownload=await download('problem-report-download'),report=JSON.parse(reportDownload.text);
  check(report.app==='automaten-studio','Reporter app identity');check(report.snapshot.state.project.format==='automaten-studio','Reporter captures project through registered adapter');check(report.preview?.startsWith('data:image/png;base64,'),'Reporter renders scene preview');
  check(report.snapshot.inputs.some(input=>input.id==='running'&&Number(input.value)===.25),'Reporter preserves calibration input');await page.locator('#problem-report-close').click();
  for(const width of [390,320]){await page.setViewportSize({width,height:1000});check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'No horizontal overflow at '+width);await page.locator('#problem-report-button').click();const b=await page.locator('#problem-report-dialog').boundingBox();check(b.x>=0&&b.x+b.width<=width+1,'Report dialog fits at '+width);await page.locator('#problem-report-close').click();await page.locator('#drawNew').click();const drawing=await page.locator('#figureDialog').boundingBox();check(drawing.x>=0&&drawing.x+drawing.width<=width+1,'Drawing dialog fits at '+width);await page.locator('#cancelDrawing').click();}
  passed.push('reporter project snapshot, PNG preview and 390/320px responsive layout');
  check(errors.length===0,'No browser exceptions: '+errors.join('; '));return {passed,browserErrors:errors};
 } finally {await context.close();}
}
