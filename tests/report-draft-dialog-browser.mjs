// Uses the real dialog and isolated projects. Network submission is intercepted locally.
export default async function checkReportDraftDialog(rootPage,base='http://127.0.0.1:8769'){
 const context=await rootPage.context().browser().newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),reports=[],passed=[];
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 await context.addInitScript(()=>{
  Object.defineProperty(window,'WorkshopReports',{configurable:true,set(reporter){
   Object.defineProperty(window,'WorkshopReports',{value:reporter,configurable:true,writable:true});
   const register=reporter.register.bind(reporter);reporter.register=adapter=>{window.reportAdapter=adapter;register(adapter);};
  }});
 });
 await context.route('**/api/build',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({errors:[{message:'Test service unavailable'}]})}));
 await context.route('**/api/problem-reports',route=>{const report=JSON.parse(route.request().postData());reports.push(report);return route.fulfill({contentType:'application/json',body:JSON.stringify({id:report.id,number:reports.length})});});
 try{
  for(const app of ['box','klappkarten']){
   await page.goto(`${base}/${app}-studio/`);
   await page.waitForFunction(()=>!!window.reportAdapter);
   if(app==='box'){
    await page.locator('[data-view="surface"]').click();await page.locator('[data-draw="polygon"]').click();
    await page.locator('#surfaceHost svg').click({position:{x:100,y:100}});
   }else{
    await page.waitForFunction(()=>!!document.querySelector('#surfaceCanvas')?.__surfaceEditor);
    await page.locator('[data-surface-tool="polygon"]').click();await page.locator('#surfaceCanvas canvas').click({position:{x:200,y:150}});
   }
   const state=()=>page.evaluate(()=>{const captured=window.reportAdapter.capture();return {document:JSON.stringify(captured.document),drafts:JSON.stringify(captured.drafts),history:JSON.stringify(captured.history),saved:JSON.stringify({...localStorage})};});
   const before=await state();
   await page.locator('#problem-report-button').click();
   await page.waitForFunction(()=>document.querySelector('#problem-report-dialog').open);
   await page.locator('#problem-description').fill('Open drawing remains unfinished.');
   await page.locator('#problem-description').press('Escape');
   await page.waitForFunction(()=>!document.querySelector('#problem-report-dialog').open);
   check(JSON.stringify(await state())===JSON.stringify(before),`${app}: opening and Escape preserve draft, document, undo and local save`);
   await page.locator('#problem-report-button').click();await page.locator('#problem-report-send').click();
   await page.waitForFunction(()=>document.querySelector('#problem-report-dialog').dataset.saved==='true');
   const report=reports.at(-1);
   check(JSON.stringify(report.snapshot.state.drafts)===before.drafts,`${app}: captured report contains exact unfinished draft`);
   check(JSON.stringify(report.snapshot.state.document)===before.document,`${app}: captured document unchanged`);
   check(report.preview?.startsWith('data:image/png'),`${app}: real reporter generated preview`);
   check(JSON.stringify(await state())===JSON.stringify(before),`${app}: submitting local test report preserves app state`);
   await page.locator('#problem-description').press('Escape');passed.push(app);
  }
  return {passed,reports:reports.length};
 }finally{await context.close();}
}
