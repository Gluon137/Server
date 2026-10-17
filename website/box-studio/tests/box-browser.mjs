// Reusable smoke checks: pass an existing Playwright Page and a running local service.
export async function runBoxDimensionBrowserTests(page,baseURL='http://127.0.0.1:8767/box-studio/'){
 const assert=(value,message)=>{if(!value)throw new Error(message);},ready=()=>page.waitForFunction(()=>document.querySelector('#canvas').getAttribute('aria-busy')!=='true',null,{timeout:45000});
 const dimension=kind=>page.locator(`#surfaceHost [data-dimension="${kind}"]`);
 const edit=async(label,value)=>{const input=page.locator('#featureFields').getByLabel(label,{exact:true});await input.fill(String(value));await input.press('Tab');await ready();};
 await page.goto(baseURL);await ready();await page.locator('#reset').click();await ready();await page.locator('[data-view="surface"]').click();
 assert(await dimension('plate-width').textContent()==='200 mm','Plate width visible');
 assert(await dimension('plate-height').textContent()==='97 mm','Nominal wall height includes lid allowance');
 assert(await dimension('thickness').textContent()==='Stärke 3 mm','Material thickness visible');
 await page.locator('#featureShape').selectOption('circle');await page.locator('#addFeature').click();await ready();
 assert(await dimension('diameter').textContent()==='Ø 20 mm','Hole diameter visible');
 assert(await dimension('position-x').textContent()==='X 100 mm','X position measured from left');
 assert(await dimension('position-y').textContent()==='Y 48,5 mm','Y position measured from bottom');
 await edit('X / relativ',.25);await page.locator('#featureFields').getByLabel('X-Bezug').selectOption('relative');await ready();
 assert(await dimension('position-x').textContent()==='X 50 mm','Relative anchors show physical position');
 await page.locator('#featureShape').selectOption('rect');await page.locator('#addFeature').click();await ready();
 await edit('Breite',26);await edit('Höhe',14);await edit('Drehung °',30);
 assert(await dimension('feature-width').textContent()==='26 mm'&&await dimension('feature-height').textContent()==='14 mm','Rotated local dimensions stay correct');
 const screenPoint=async(x,y)=>page.locator('#surfaceHost svg > g').evaluate((g,coordinates)=>{const p=new DOMPoint(...coordinates).matrixTransform(g.getScreenCTM());return {x:p.x,y:p.y};},[x,y]);
 const from=await screenPoint(100,48.5),to=await screenPoint(120,58.5);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();await ready();
 assert(await dimension('position-x').textContent()==='X 120 mm','Dimensions update after dragging');
 await page.setViewportSize({width:320,height:900});await page.waitForFunction(()=>{const text=document.querySelector('[data-dimension="plate-width"]'),matrix=text?.getScreenCTM();return matrix&&parseFloat(text.getAttribute('font-size'))*Math.hypot(matrix.a,matrix.b)>=11.5;});
 const visible=await page.locator('#surfaceHost').evaluate(host=>{const rect=host.getBoundingClientRect();return [...host.querySelectorAll('[data-dimension]')].every(node=>{const box=node.getBoundingClientRect();return box.left>=rect.left-1&&box.right<=rect.right+1&&box.top>=rect.top-1&&box.bottom<=rect.bottom+1;});});
 assert(visible,'Dimension text fits the mobile viewport');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dimensions do not cause horizontal overflow');
 await page.setViewportSize({width:1280,height:900});
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadSVG').click()]);let svg='';for await(const chunk of await download.createReadStream())svg+=chunk.toString('utf8');
 assert(!svg.includes('data-dimension')&&!svg.includes('surface-dimensions'),'Measurements are not exported as laser paths');
 return {passed:['plate dimensions','thickness','diameter','XY position','relative anchors','rotated feature','drag updates','mobile readability','SVG without measurement lines']};
}

export async function runBoxExplosionBrowserTests(page,baseURL='http://127.0.0.1:8767/box-studio/'){
 await page.goto(baseURL);
 return await page.evaluate(async()=>{
  const THREE=await import('three'),{BoxScene}=await import('./scene.mjs');
  const defaults=await fetch('./api/defaults').then(r=>r.json()),passed=[];
  const variants=[['rect','removable',0],['rect','hinged',65],['rounded','removable',0],['cylinder','removable',0]];
  for(const [shape,lid,lidValue] of variants){
   const project=structuredClone(defaults);Object.assign(project.box,{shape,lid,lidValue});
   if(shape==='rounded')Object.assign(project.box,{width:160,depth:110,radius:25});
   if(shape==='cylinder')project.box.width=160;
   const result=await fetch('./api/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)}).then(r=>r.json());
   if(!result.parts?.length)throw new Error('Missing explosion test parts');
   // Exercise real mesh construction and pose matrices without a second WebGL renderer.
   const scene=Object.create(BoxScene.prototype);scene.group=new THREE.Group();scene.meshes=[];scene.hasFitted=true;
   scene.update(project,result,{explode:0});
   const original=new Map(scene.group.children.map(group=>[group.userData.part.id,{matrix:group.matrix.clone(),center:group.userData.center.clone().applyMatrix4(group.matrix)}]));
   scene.options.explode=100;scene.pose();
   for(const group of scene.group.children){
    const id=group.userData.part.id,before=original.get(id),delta=group.userData.center.clone().applyMatrix4(group.matrix).sub(before.center);
    if(delta.length()<1||delta.dot(before.center.clone().sub(scene.modelCenter))<-.001)throw new Error(`${shape}/${lid}: ${id} explodes inward`);
    if(shape==='rect'&&lid==='removable'){
     const axis={bottom:[2,-1],front:[1,-1],back:[1,1],left:[0,-1],right:[0,1],lid:[2,1]}[id];
     if(axis&&delta.getComponent(axis[0])*axis[1]<=0)throw new Error('Wrong outward direction: '+id);
    }
   }
   scene.options.explode=0;scene.pose();
   for(const group of scene.group.children)if(!group.matrix.equals(original.get(group.userData.part.id).matrix))throw new Error('Zero explosion changes the joint pose');
   passed.push(shape+'/'+lid+(lidValue?' open':' closed'));
   scene.update(project,{parts:[],joints:[]},{explode:0});
  }
  return {passed};
 });
}

export async function runBoxBrowserTests(page,baseURL='http://127.0.0.1:8767/box-studio/'){
 const assert=(value,message)=>{if(!value)throw new Error(message);};
 const ready=async()=>{await page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('wird geprüft')&&!document.querySelector('#status').textContent.includes('vorbereitet'),null,{timeout:45000});};
 await page.goto(baseURL);await ready();await page.locator('#reset').click();await ready();
 assert(await page.locator('#downloadSVG').isEnabled(),'Default project should export');
 const readDownload=async selector=>{const [file]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);let source='';for await(const chunk of await file.createReadStream())source+=chunk.toString('utf8');return {name:file.suggestedFilename(),source};};
 const projectDownload=await readDownload('#saveProject');const saved=JSON.parse(projectDownload.source);assert(saved.version===1&&saved.box.width===200&&Array.isArray(saved.features),'Downloaded project contains source data');
 const svgDownload=await readDownload('#downloadSVG');assert(svgDownload.name.endsWith('.svg')&&svgDownload.source.includes('<svg')&&svgDownload.source.includes('mm'),'Downloaded sheet is a physical SVG');
 const bomDownload=await readDownload('#downloadBOM');assert(bomDownload.name.endsWith('.csv')&&bomDownload.source.includes('Schnittteil'),'Downloaded BOM includes fabricated parts');

 await page.locator('#boxFields').getByLabel('Breite',{exact:true}).fill('210');await page.locator('#boxFields').getByLabel('Breite',{exact:true}).press('Tab');await ready();assert((await page.locator('#metricSize').innerText()).startsWith('210'),'Box width changes');
 await page.locator('#featureShape').selectOption('circle');await page.locator('#addFeature').click();await ready();await page.locator('#featureFields').getByLabel('Durchmesser',{exact:true}).fill('12');await page.locator('#featureFields').getByLabel('Durchmesser',{exact:true}).press('Tab');await ready();assert(await page.locator('#surfaceHost .feature').count()===1,'Added circle is drawn');
 await page.locator('#featureFields').getByLabel('X / relativ',{exact:true}).fill('-60');await page.locator('#featureFields').getByLabel('X / relativ',{exact:true}).press('Tab');await ready();
 await page.locator('#featureShape').selectOption('text');await page.locator('#addFeature').click();await page.waitForFunction(()=>document.querySelectorAll('#surfaceHost .feature')[1]?.getAttribute('d').length>100,null,{timeout:30000});await ready();assert(await page.locator('#downloadSVG').isEnabled(),'Outlined text exports');
 const before=await page.locator('#surfaceHost .feature').nth(1).getAttribute('d');await page.locator('#featureFields').getByLabel('Breite',{exact:true}).fill('30');await page.locator('#featureFields').getByLabel('Breite',{exact:true}).press('Tab');await ready();assert(await page.locator('#surfaceHost .feature').nth(1).getAttribute('d')!==before,'Text contour resizes');
 await page.locator('#svgFile').evaluate(input=>input.dataset.target='new');await page.locator('#svgFile').evaluate(input=>{const transfer=new DataTransfer();transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>'],'aspect-test.svg',{type:'image/svg+xml'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelectorAll('#featureList button').length===3);await ready();
 const dimensions=await page.locator('#featureFields').evaluate(host=>Object.fromEntries([...host.querySelectorAll('label')].filter(label=>['Breite','Höhe'].includes(label.firstChild.textContent)).map(label=>[label.firstChild.textContent,+label.querySelector('input').value])));assert(Math.abs(dimensions.Breite/dimensions.Höhe-2)<.001,'SVG physical aspect');
 await page.locator('#addHardware').click();await ready();assert(await page.locator('#hardwareFields input').count()===4,'Hardware editable');await page.locator('#addGroup').click();await ready();assert(await page.locator('#groupFields fieldset').count()===1,'Empty group editable');
 await page.locator('#example').selectOption('rounded');await ready();assert(await page.locator('#downloadSVG').isEnabled(),'Rounded example fits sheet');await page.locator('#example').selectOption('cylinder');await ready();assert(await page.locator('#downloadSVG').isEnabled(),'Cylinder example fits its sheet');await page.locator('[data-view="surface"]').click();await page.setViewportSize({width:320,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at320px');
 await page.setViewportSize({width:1280,height:900});await page.locator('#reset').click();await ready();return {passed:['project download','SVG download','BOM download','default export','dimension editing','circle editing','outlined text','text resizing','SVG aspect','hardware','group drafts','rounded example','cylinder','320px layout']};
}

export async function runBoxDrawingBrowserTests(page,baseURL='http://127.0.0.1:8767/box-studio/'){
 const assert=(condition,message)=>{if(!condition)throw new Error(message);};
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('wird geprüft'),null,{timeout:45000});
 await page.goto(baseURL);await ready();await page.locator('#reset').click();await ready();await page.locator('[data-view="surface"]').click();
 const point=(x,y)=>page.locator('#surfaceHost svg > g').evaluate((g,coordinates)=>{const p=new DOMPoint(...coordinates).matrixTransform(g.getScreenCTM());return {x:p.x,y:p.y};},[x,y]);
 const click=async(x,y)=>{const p=await point(x,y);await page.mouse.click(p.x,p.y);};
 await page.locator('[data-draw="rect"]').click();const a=await point(75,35),b=await point(105,55);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await ready();
 assert(await page.locator('#featureList button').count()===1,'Drawing creates a rectangle');
 const center=await point(90,45),moved=await point(110,55);await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(moved.x,moved.y,{steps:8});await page.mouse.up();await ready();
 assert(+(await page.locator('#featureFields').getByLabel('X / relativ',{exact:true}).inputValue())===10,'Dragging updates feature position');
 await page.keyboard.press('ControlOrMeta+z');await ready();assert(+(await page.locator('#featureFields').getByLabel('X / relativ',{exact:true}).inputValue())===-10,'One undo restores the whole drag');
 await page.locator('[data-draw="polygon"]').click();await click(130,30);await click(150,30);await page.locator('[data-draw="select"]').click();await page.locator('[data-draw="polygon"]').click();assert((await page.locator('#surfaceHint').innerText()).includes('2 Punkte'),'Tool switching preserves open polygon');
 await page.locator('#partSelect').selectOption('bottom');await page.locator('#partSelect').selectOption('front');assert((await page.locator('#surfaceHost svg > g path').last().getAttribute('d')).includes('130,30'),'Part switching preserves open polygon');
 await page.locator('#saveProject').click();assert((await page.locator('#status').innerText()).includes('noch offen'),'Saving surfaces an unfinished polygon');
 await click(140,60);await page.locator('#finishPolygon').click();await ready();assert(await page.locator('#featureList button').count()===2,'Polygon closes into a feature');
 await page.locator('[data-draw="polygon"]').click();await click(50,70);await click(65,70);await page.keyboard.press('Escape');assert(!(await page.locator('#surfaceHint').innerText()).includes('Punkte in offener'),'Escape explicitly discards a draft');
 const safety=await page.evaluate(async()=>{const {parseSheetSVG}=await import('./sheet-svg.mjs');const valid=parseSheetSVG('<svg xmlns="http://www.w3.org/2000/svg">'+Array.from({length:2100},()=>'<path d="M0 0L1 1"/>').join('')+'</svg>').querySelectorAll('path').length;let rejects=0;for(const inner of ['<script>alert(1)</script>','<path onload="alert(1)"/>','<path fill="url(https://example.invalid/image)"/>'])try{parseSheetSVG('<svg xmlns="http://www.w3.org/2000/svg">'+inner+'</svg>');}catch{rejects++;}return {valid,rejects};});assert(safety.valid===2100&&safety.rejects===3,'Generated sheet parser accepts large valid output and rejects active SVG');
 return {passed:['drawing','dragging','drag undo','polygon draft retention','unfinished save','polygon close','draft cancel','generated SVG safety']};
}
