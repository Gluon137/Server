// Adapter checks use an isolated context and a reporter stub; no user project storage is touched.
export default async function checkReportCapture(rootPage,base='http://127.0.0.1:8769'){
 const context=await rootPage.context().browser().newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),passed=[];
 const check=(value,message)=>{if(!value)throw new Error(message);};
 await context.route('**/shared/problem-reporter.js',route=>route.fulfill({contentType:'application/javascript',body:"window.WorkshopReports={register(adapter){window.reportAdapter=adapter;},record(...entry){(window.reportRecords??=[]).push(entry);}};"}));
 await context.route('**/shared/problem-reporter.css',route=>route.fulfill({contentType:'text/css',body:''}));
 await context.route('**/shared/hero-copy.mjs',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await context.route('**/api/build',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({errors:[{message:'Test service unavailable'}]})}));
 try{
  for(const app of ['baustein','drehscheiben','box','klappkarten','zahnrad']){
   const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
   await page.goto(`${base}/${app}-studio/`);
   await page.waitForFunction(()=>!!window.reportAdapter);
   await page.waitForFunction(()=>!!window.reportAdapter.preview());
   if(app==='drehscheiben')await page.waitForFunction(()=>!window.reportAdapter.capture().pending.busy);
   if(app==='klappkarten')await page.waitForFunction(()=>!!document.querySelector('#surfaceCanvas')?.__surfaceEditor);
   const captured=await page.evaluate(()=>{
    const adapter=window.reportAdapter,before=adapter.capture(),documentBefore=JSON.stringify(before.document),cameraBefore=JSON.stringify(before.ui);
    const preview=adapter.preview();let image=null;if(preview instanceof HTMLCanvasElement)image=preview.toDataURL();
    const after=adapter.capture();return {hasDocument:!!before.document,documentStable:documentBefore===JSON.stringify(after.document),uiStable:cameraBefore===JSON.stringify(after.ui),preview:preview?.tagName||null,image,bodyApp:document.body.dataset.app};
   });
   check(captured.hasDocument&&captured.documentStable&&captured.uiStable,`${app}: capture/preview must preserve document and camera`);
   check(captured.bodyApp===`${app}-studio`,`${app}: body route hook`);
   check(captured.preview,`${app}: active preview exists`);
   if(captured.preview==='CANVAS')check(captured.image?.startsWith('data:image/png'),`${app}: synchronous WebGL preview PNG`);
   if(['box','klappkarten'].includes(app)){
    if(app==='box'){
     await page.locator('[data-view="surface"]').click();await page.locator('[data-draw="polygon"]').click();
     await page.locator('#surfaceHost svg').click({position:{x:100,y:100}});
    }else{
     await page.locator('[data-surface-tool="polygon"]').click();
     await page.locator('#surfaceCanvas canvas').click({position:{x:200,y:150}});
    }
    const draft=await page.evaluate(app=>{
     const before=window.reportAdapter.capture(),raw=JSON.stringify(before.drafts),document=JSON.stringify(before.document);
     window.reportAdapter.preview();const after=window.reportAdapter.capture();
     return {count:app==='box'?before.drafts.surface.active.length:before.drafts.surface.draft?.points.length,stable:raw===JSON.stringify(after.drafts)&&document===JSON.stringify(after.document)};
    },app);
    check(draft.count===1&&draft.stable,`${app}: open one-point draft captured without committing or clearing`);
   }
   if(app!=='zahnrad'){
    const raw=app==='drehscheiben'?'<svg broken>':'{broken';
    const selector=app==='drehscheiben'?'#file':'#projectFile';
    await page.locator(selector).setInputFiles({name:app==='drehscheiben'?'broken.svg':'broken.json',mimeType:'text/plain',buffer:Buffer.from(raw)});
    await page.waitForFunction(raw=>window.reportAdapter.capture().drafts?.lastAttemptedImport?.text===raw,raw);
    check(await page.evaluate(()=>window.reportRecords?.some(entry=>entry[0]==='error')),`${app}: caught import error retained`);
   }
   check(errors.length===0,`${app}: browser errors: ${errors.join('; ')}`);page.off('pageerror',onError);passed.push(app);
  }
  for(const app of ['baustein','box']){
   let requests=0;
   const buildRoute=route=>{requests++;return route.fulfill({status:requests===1?200:503,contentType:'application/json',body:JSON.stringify(requests===1?{valid:false,errors:[{message:'Test geometry issue'}],warnings:[],parts:[],panels:[],sheets:[],joints:[],assembly:[]}:{errors:[{message:'Later build failed'}]})});};
   await context.route('**/api/build',buildRoute);await page.goto(`${base}/${app}-studio/`);
   await page.waitForFunction(()=>!!window.reportAdapter?.capture().response);
   const completed=await page.evaluate(()=>{const state=window.reportAdapter.capture();return {document:JSON.stringify(state.document),response:JSON.stringify(state.response),previousBuild:state.previousBuild};});
   check(completed.previousBuild===null,`${app}: current response not duplicated`);
   if(app==='baustein')await page.locator('[data-add="x:1"]').click();else await page.locator('#example').selectOption('rounded');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Later build failed'));
   const pending=await page.evaluate(()=>window.reportAdapter.capture());
   check(pending.response===null&&JSON.stringify(pending.previousBuild.document)===completed.document&&JSON.stringify(pending.previousBuild.response)===completed.response,`${app}: failed rebuild retains previous document and accepted response`);
   check(JSON.stringify(pending.document)!==completed.document,`${app}: current and previous documents distinguished`);
   await context.unroute('**/api/build',buildRoute);passed.push(app+' previous build');
  }
  return {passed};
 }finally{await context.close();}
}
