import {normalizeSVG,parseSafeSVG,textPath} from '../svg.mjs';
import {MotifEditor} from '../editor.mjs';

function assert(condition,message){if(!condition)throw new Error(message);}
function svg(content){return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${content}</svg>`;}

/** Browser self-check. Serve this directory locally; run `await
 * (await import('./tests/editor.browser.mjs')).runEditorTests()` in a browser. */
export async function runEditorTests(){
  const results=[];
  for(const bad of [svg('<script>alert(1)</script>'),svg('<image href="https://example.invalid/x"/>'),svg('<path onload="alert(1)" d="M0 0L1 1"/>'),svg('<rect fill="url(https://example.invalid/x)" width="20" height="20"/>'),svg('<rect fill="u\\72l(https://example.invalid/x)" width="20" height="20"/>'),svg('<rect width="1e300" height="2"/>'),svg('<text font-family="Unknown font">Test</text>')]){
    let rejected=false;try{await normalizeSVG(bad);}catch{rejected=true;}assert(rejected,'Unsafe or unsupported SVG was accepted');
  }
  results.push('7 unsafe/unsupported SVG inputs rejected');
  const transformed=await normalizeSVG(svg('<g transform="translate(10 20)"><rect width="20" height="30"/></g>'));
  assert(Math.abs(transformed.physicalWidth-20)<.001&&Math.abs(transformed.physicalHeight-30)<.001,'Transforms changed dimensions');
  assert(transformed.contours.flat().every(p=>p.every(n=>n>=-.00001&&n<=1.00001)),'Contours outside unit box');
  const curve=await normalizeSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M0 100V20C0 -5 100 -5 100 20V100Z M40 30H60V45H40Z"/></svg>');
  assert(Math.abs(curve.physicalWidth-100)<.000001&&Math.abs(curve.physicalHeight-98.75)<.000001,'SVG viewport bounds must not expand the curve geometry');
  let repeated=curve;
  for(let i=0;i<3;i++){repeated=await normalizeSVG(repeated.svg);assert(Math.abs(repeated.physicalWidth-100)<.00001&&Math.abs(repeated.physicalHeight-100)<.00001,'Repeated canonical normalization drifts');}
  const ring=await normalizeSVG(svg('<path fill-rule="evenodd" d="M0 0H100V100H0Z M25 25V75H75V25Z"/>'));
  assert(ring.contours.length===2&&parseSafeSVG(ring.svg).querySelectorAll('path').length===1,'Compound holes were lost');
  const sameWinding=await normalizeSVG(svg('<path fill="none" fill-rule="nonzero" d="M0 0H100V100H0Z M25 25H75V75H25Z"/>'));
  const cutPath=parseSafeSVG(sameWinding.svg).querySelector('path');
  assert(sameWinding.contours.length===2&&cutPath.getAttribute('fill-rule')==='evenodd'&&cutPath.getAttribute('fill')!=='none','Cut material preview must show physical holes and a solid material fill');
  const text=await normalizeSVG(svg(`<path d="${await textPath('Ö',5,50,20)}"/>`));
  assert(text.contours.length>=3&&!text.warnings.length,'Font contours must be closed, including counters');
  let mixed=await normalizeSVG(svg(`<path d="M0 100V20C0 -5 100 -5 100 20V100Z M40 30H60V45H40Z"/><path d="${await textPath('ÄÖÜ',-10,20,25)}"/>`));
  for(let i=0;i<3;i++){
    const roundtrip=await normalizeSVG(mixed.svg);
    assert(roundtrip.svg===mixed.svg&&JSON.stringify(roundtrip.contours)===JSON.stringify(mixed.contours),'Canonical text/curve SVG and contours must be exactly idempotent');
    mixed=roundtrip;
  }
  results.push('Transforms, compound holes and German font contours preserved');
  const host=document.createElement('div');host.style.cssText='width:1100px;height:700px;position:fixed;inset:0;z-index:99999;background:white';document.body.append(host);
  const editor=new MotifEditor(host);
  try{
    await editor.init();
    let curveFigure={svg:curve.svg,width:28,height:28/curve.aspectRatio};
    for(let i=0;i<3;i++){
      await editor.load(curveFigure);const savedCurve=await editor.commit();
      assert(Math.abs(savedCurve.physicalWidth-curveFigure.width)<.00001&&Math.abs(savedCurve.physicalHeight-curveFigure.height)<.00001,'Curve no-op editor save changed physical size');
      curveFigure={svg:savedCurve.svg,width:savedCurve.physicalWidth,height:savedCurve.physicalHeight};
    }
    const source=svg('<rect width="70" height="100"/><rect x="30" width="70" height="100"/>');
    for(const [operation,width] of [['unite',40],['subtract',12],['intersect',16]]){
      await editor.load({svg:source,width:40,height:20});const before=await editor.commit();
      assert(Math.abs(before.physicalWidth-40)<.001&&Math.abs(before.physicalHeight-20)<.001,'No-op save changed physical size');
      editor.canvas.selectAllInCurrentLayer();await editor.command(operation);let after=await editor.commit();
      assert(after.contours.length===1&&Math.abs(after.physicalWidth-width)<.001,'Wrong Boolean geometry');
      editor.undo();assert((await editor.commit()).contours.length===2,'Boolean undo did not restore operands');
      editor.redo();assert((await editor.commit()).contours.length===1,'Boolean redo failed');
    }
    results.push('Physical dimensions, all 3 Booleans, undo and redo verified');
    await editor.addText({text:'Hallo ÄÖÜ ß',size:8});const saved=await editor.commit();
    assert(saved.sourceTexts.some(t=>t.text==='Hallo ÄÖÜ ß')&&saved.contours.length>2,'Outlined text or original text missing');
    const reloadedText=await normalizeSVG(saved.svg);
    assert(reloadedText.svg===saved.svg&&JSON.stringify(reloadedText.contours)===JSON.stringify(saved.contours)&&JSON.stringify(reloadedText.sourceTexts)===JSON.stringify(saved.sourceTexts),'Saved outlined text must restore exactly');
    editor.undo();assert((await editor.commit()).contours.length===1,'Text undo failed');
    editor.redo();assert((await editor.commit()).contours.length>2,'Text redo failed');
    results.push('Text outlines, source text persistence, text undo/redo verified');
  }finally{editor.destroy();host.remove();}
  return results;
}
