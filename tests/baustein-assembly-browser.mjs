// Run through playwright-cli run-code in a separate local browser session.
export default async function checkExtendedAssembly(page,baseUrl='http://127.0.0.1:8765') {
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl+'/baustein-studio/');
  await page.setViewportSize({width:1440,height:1050});
  const defaults=await (await page.request.get(baseUrl+'/baustein-studio/api/defaults')).json();
  const fixture=(size,heights)=>({...defaults,axes:{x:[size,size,size],y:[size,size,size],z:Array(Math.max(...heights)).fill(size)},cells:heights.flatMap((height,index)=>Array.from({length:height},(_,z)=>[Math.floor(index/3),index%3,z]))});
  const load=async project=>{
    await page.evaluate(project=>{const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(project)],'assembly-test.json',{type:'application/json'}));const input=document.querySelector('#projectFile');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));},project);
    await page.waitForFunction(()=>!document.querySelector('#downloadSVG').disabled,{}, {timeout:30000});
  };
  const step=async value=>page.locator('#assemblyStep').fill(String(value));
  const target=fixture(100,[2,1,2,1,1,1,2,1,2]);
  const targetResult=await (await page.request.post(baseUrl+'/baustein-studio/api/build',{data:target})).json();
  check(targetResult.valid,'Four corner towers must pass');
  await load(target);
  check(await page.locator('#metricCells').innerText()==='13','13 cells');
  check(await page.locator('#metricPanels').innerText()==='18','18 panels');
  await page.locator('[data-view="assembly"]').click();
  check(await page.locator('#assemblyStep').getAttribute('max')===String(targetResult.assemblyOperations.length),'Timeline operation count');
  const diagonal=targetResult.assemblyOperations.findIndex(op=>op.translation.filter(value=>value!==0).length>1);
  check(diagonal>=0,'Target contains a diagonal operation');
  await step(diagonal+.5);
  check((await page.locator('#assemblyInstruction').innerText()).includes('diagonal'),'Diagonal instructions');
  await page.locator('[data-camera="fit"]').click();
  await page.screenshot({path:'output/playwright/baustein-four-towers-diagonal.png',scale:'css'});
  await step(targetResult.assemblyOperations.length);
  check((await page.locator('#assemblyInstruction').innerText()).includes('Montage abgeschlossen'),'Completion instructions');
  await page.locator('[data-camera="fit"]').click();
  await page.screenshot({path:'output/playwright/baustein-four-towers-finished.png',scale:'css'});
  await page.locator('[data-view="layout"]').click();
  check(await page.locator('#layoutPreview svg path').count()>0,'Cut preview');
  const downloads=page.waitForEvent('download');
  await page.locator('#downloadSVG').click();
  await (await downloads).saveAs('output/playwright/baustein-four-towers-sheet-1.svg');
  const projectDownload=page.waitForEvent('download');
  await page.locator('#saveProject').click();
  await (await projectDownload).saveAs('output/playwright/baustein-four-towers-project.json');
  await page.reload();
  await page.waitForFunction(()=>!document.querySelector('#downloadSVG').disabled);
  check(await page.locator('#metricCells').innerText()==='13','Target restored');
  const groupProject=fixture(60,[2,3,1,1,1,1,3,2,3]);
  const groupResult=await (await page.request.post(baseUrl+'/baustein-studio/api/build',{data:groupProject})).json();
  check(groupResult.valid,'Group fixture must pass');
  await load(groupProject);
  await page.locator('[data-view="assembly"]').click();
  check(await page.locator('#metricPanels').innerText()==='17','Group fixture has 17 parts');
  check(await page.locator('#assemblyStep').getAttribute('max')==='18','Group fixture has 18 operations');
  const preparation=groupResult.assemblyOperations.findIndex(op=>op.kind==='preassembly');
  const group=groupResult.assemblyOperations.findIndex(op=>op.kind==='group');
  check(preparation>=0&&group>preparation,'Proven preassembly precedes group insertion');
  // Independently instantiate the real renderer to check the playback camera
  // across every linear motion boundary, including hidden staging positions.
  await page.evaluate(async ({project,result})=>{
    const {StudioScene}=await import('/baustein-studio/scene.mjs');
    const host=document.createElement('div');host.style.cssText='position:fixed;left:-2000px;width:900px;height:600px';document.body.append(host);
    const scene=new StudioScene(host,()=>{});
    try {
      scene.update(project,result,'assembly',project.cells[0],'select',0);
      scene.fit('iso',true);
      for(let step=0;step<=result.assemblyOperations.length;step++){
        scene.setStep(step);scene.group.updateWorldMatrix(true,true);scene.camera.updateMatrixWorld();
        for(const mesh of scene.group.children){
          if(!mesh.isMesh||!mesh.visible)continue;
          const bounds=mesh.geometry.boundingBox;
          for(let mask=0;mask<8;mask++){
            const point=bounds.min.clone();for(let axis=0;axis<3;axis++)if(mask&(1<<axis))point.setComponent(axis,bounds.max.getComponent(axis));
            mesh.localToWorld(point);point.project(scene.camera);
            if(Math.abs(point.x)>1||Math.abs(point.y)>1||Math.abs(point.z)>1)throw new Error('Assembly playback leaves camera frame at step '+step);
          }
        }
      }
    } finally {cancelAnimationFrame(scene.frame);scene.resizeObserver.disconnect();scene.controls.dispose();scene.clear();scene.renderer.dispose();host.remove();}
  },{project:groupProject,result:groupResult});
  await step(preparation+.5);
  check((await page.locator('#assemblyInstruction').innerText()).includes('vormontieren'),'Preassembly instructions');
  await step(group+.5);
  check((await page.locator('#assemblyInstruction').innerText()).includes('gemeinsam'),'Group insertion instructions');
  await page.locator('[data-camera="fit"]').click();
  await page.screenshot({path:'output/playwright/baustein-group-insertion.png',scale:'css'});
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile assembly controls fit');
  await page.screenshot({path:'output/playwright/baustein-group-mobile.png',scale:'css',fullPage:true});
  check(errors.length===0,'Browser errors: '+errors.join('; '));
  return {fourTowers:targetResult.metrics,diagonalStep:diagonal+1,groupStep:group+1,browserErrors:errors};
}
