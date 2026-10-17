// Isolated pointer tests; no existing studio state or user storage is changed.
export default async function checkSurfaceEditor(rootPage,base='http://127.0.0.1:8766') {
  const context=await rootPage.context().browser().newContext({viewport:{width:1250,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const click=async point=>{const position=await page.evaluate(point=>window.surfaceEditor.projectPoint(point),point);await page.mouse.click(position.x,position.y);};
  const ready=()=>page.waitForFunction(()=>!window.surfaceEditor.busy);
  const saved=()=>page.evaluate(()=>window.surfaceChanges);
  try {
    await page.goto(base+'/klappkarten-studio/');
    await page.waitForFunction(()=>document.body.dataset.ready==='true');
    await page.evaluate(async()=>{
      for(const child of document.body.children)child.hidden=true;
      const host=document.createElement('div');host.id='isolated-surface-editor';Object.assign(host.style,{width:'1150px',height:'800px'});document.body.append(host);
      const {SurfaceEditor}=await import('./surface-editor.mjs'),{defaults}=await import('./project.mjs');
      window.surfaceProject=structuredClone(defaults);surfaceProject.surface={active:true,shapes:[]};
      window.surfaceChanges=[];window.surfaceDraftEvents=[];window.surfaceReject=false;
      window.surfaceEditor=new SurfaceEditor(host,{
        onChange:async shape=>{
          if(window.surfaceReject){window.surfaceReject=false;throw new Error('Test: Zeichnung bleibt erhalten.');}
          surfaceChanges.push(structuredClone(shape));
          surfaceProject.surface.shapes=surfaceProject.surface.shapes.filter(item=>item.id!==shape.id).concat(shape);
          surfaceEditor.update(surfaceProject,{},shape.id);
        },onDraftChange:active=>surfaceDraftEvents.push(active),onStatus:message=>window.surfaceStatus=message
      });
      surfaceEditor.update(surfaceProject,{});surfaceEditor.setTool('rectangle');
    });
    await click([20,10]);await click([50,35]);await ready();
    check(JSON.stringify((await saved())[0].contours)==='[[[20,10],[50,10],[50,35],[20,35]]]','Projected rectangle clicks preserve exact plane millimetres.');
    check(await page.evaluate(()=>surfaceEditor.draft===null&&surfaceDraftEvents.join(',')==='true,false'),'Committed rectangle clears its draft exactly once.');
    await page.evaluate(()=>{surfaceEditor.setTool('polygon');surfaceEditor.setPlane('horizontal',15);});
    await click([70,10]);await click([95,10]);await click([80,35]);
    await page.locator('#isolated-surface-editor [data-surface-editor]').press('Enter');await ready();
    check((await saved())[1].orientation==='horizontal'&&(await saved())[1].offset===15,'Horizontal plane records its actual height.');
    await page.evaluate(()=>{surfaceEditor.setTool('polygon');surfaceEditor.setPlane('vertical',25);window.surfaceReject=true;});
    await click([35,10]);await click([55,10]);await click([45,35]);
    await page.locator('#isolated-surface-editor [data-surface-editor]').press('Enter');await ready();
    check(await page.evaluate(()=>surfaceEditor.draft?.points.length===3&&surfaceChanges.length===2),'Rejected parent transaction retains every draft point.');
    check(await page.evaluate(()=>surfaceEditor.setPlane('vertical',30)===false&&surfaceEditor.setTool('select')===false&&surfaceEditor.setAngle(45)===false),'Unfinished geometry cannot silently disappear on plane, tool or angle changes.');
    await page.evaluate(()=>surfaceEditor.update(surfaceProject,{},surfaceEditor.selection));
    check(await page.evaluate(()=>surfaceEditor.draft?.points.length===3),'A rebuild preserves an unfinished polygon.');
    await page.locator('#isolated-surface-editor [data-surface-editor]').press('Enter');await ready();
    check((await saved()).length===3,'Finish retries the retained draft successfully.');
    await page.evaluate(()=>{surfaceEditor.setTool('select');surfaceEditor.setSelection(surfaceChanges[2].id);});
    const a=await page.evaluate(()=>surfaceEditor.projectPoint([35,10])),b=await page.evaluate(()=>surfaceEditor.projectPoint([30,15]));
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();await ready();
    check(JSON.stringify((await saved()).at(-1).contours[0][0])==='[30,15]','Dragging a selected vertex changes the original contour in its own plane.');
    await page.evaluate(()=>{surfaceEditor.setTool('polygon');});await click([80,10]);
    await page.locator('#isolated-surface-editor [data-surface-editor]').press('Backspace');
    check(await page.evaluate(()=>surfaceEditor.draft.points.length===0),'Backspace removes the unfinished vertex.');
    await page.locator('#isolated-surface-editor [data-surface-editor]').press('Escape');
    check(await page.evaluate(()=>surfaceEditor.draft===null),'Escape clears the uncommitted draft.');
    await page.evaluate(()=>{surfaceEditor.setVisible(false);surfaceEditor.update(surfaceProject,{});});
    check(await page.evaluate(()=>surfaceEditor.view.visible===false),'Updating a hidden editor does not restart rendering.');
    await page.evaluate(()=>surfaceEditor.destroy());
    check(await page.locator('#isolated-surface-editor [data-surface-editor]').count()===0,'Destroy removes the canvas and releases the scene.');
    check(!errors.length,errors.join('; '));
    return {passed:6,browserErrors:errors};
  } finally {await context.close();}
}
