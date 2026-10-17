import {normalizeSVG,parseSafeSVG,loadPaper,textPath} from './svg.mjs';

const NS='http://www.w3.org/2000/svg';

/** Same-origin bridge to the complete local SVG-Edit UI. `native` and `canvas`
 * expose the upstream Editor and SvgCanvas APIs after init(). */
export class MotifEditor {
  constructor(host,{onChange=()=>{},onStatus=()=>{}}={}) {
    this.host=host;this.onChange=onChange;this.onStatus=onStatus;this.sourceTexts=[];this.loading=false;
    this.frame=document.createElement('iframe');this.frame.title='Vollständiger SVG-Motiveditor';
    this.frame.style.cssText='border:0;width:100%;height:100%;min-height:560px;background:white';
    // The only input into this frame is validated vector markup. Native file/image
    // import controls are hidden; the application's validated import is authoritative.
    this.frame.src=new URL('./vendor/svgedit/studio.html',import.meta.url).href;
  }
  captureReport(){const content=this.canvas?.getSvgContent();return {svg:content?new XMLSerializer().serializeToString(content):null,sourceTexts:this.sourceTexts,loading:this.loading,selection:this.canvas?.getSelectedElements().filter(Boolean).map(element=>element.id)||[]};}
  reportPreview(){return this.canvas?.getSvgContent()||null;}
  async init() {
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      const loaded=new Promise((resolve,reject)=>{this.frame.onload=resolve;this.frame.onerror=()=>reject(new Error('SVG-Edit konnte nicht geladen werden.'));});
      this.host.replaceChildren(this.frame);await loaded;
      const win=this.frame.contentWindow;
      // SVG-Edit's resize handlers assume a visible viewport; other studio tabs have none.
      win.addEventListener('resize',event=>{if(!this.frame.getClientRects().length||this.frame.clientWidth<1)event.stopImmediatePropagation();},true);
      for(let i=0;i<300&&!win.studioReady;i++)await new Promise(r=>setTimeout(r,50));
      if(!win.studioReady)throw new Error('SVG-Edit ist nicht erreichbar. Bitte den lokalen Webserver verwenden.');
      this.native=await win.studioReady;this.canvas=this.native.svgCanvas;
      for(const method of ['updateCanvas','zoomChanged']) {
        const original=this.native[method].bind(this.native);
        this.native[method]=(...args)=>{
          if(!this.frame.getClientRects().length||this.frame.clientWidth<1)return;
          return original(...args);
        };
      }
      for(const method of ['setSvgString','importSvgString']){
        const original=this.canvas[method].bind(this.canvas);
        this.canvas[method]=(source,...args)=>{
          try{const safe=parseSafeSVG(source);return original(new XMLSerializer().serializeToString(safe),...args);}
          catch(error){this.onStatus(error.message);return false;}
        };
      }
      const previous=this.canvas.bind('changed',(window,elems)=>{previous?.(window,elems);if(!this.loading)this.changed();});
      this.native.configObj.pref('lang','de');
      this.onStatus('SVG-Edit bereit · Bézierknoten durch Doppelklick auf einen Pfad.');
      return this;
    })();
    return this.ready;
  }
  changed(){this.onChange();}
  async load(figure) {
    await this.init();
    const result=await normalizeSVG(figure.svg);
    this.loading=true;
    try {
      this.sourceTexts=result.sourceTexts.length?result.sourceTexts:(figure.sourceTexts||[]);
      const width=Number(figure.width)||40,height=Number(figure.height)||40;
      const doc=parseSafeSVG(result.svg),root=doc.documentElement;
      root.setAttribute('width',String(width));root.setAttribute('height',String(height));root.setAttribute('viewBox',`0 0 ${width} ${height}`);
      [...root.children].filter(node=>node.localName!=='metadata').forEach(node=>node.setAttribute('transform',`scale(${width/100} ${height/100})`));
      if(!this.canvas.setSvgString(new XMLSerializer().serializeToString(doc),true))throw new Error('SVG-Edit konnte das Motiv nicht öffnen.');
      this.canvas.undoMgr.resetUndoStack();this.canvas.setMode('select');
      this.native.updateCanvas(true);this.native.zoomChanged(null,'canvas',true);
      this.onStatus('Motiv geladen · Änderungen mit „Motiv übernehmen“ speichern.');
    }finally{this.loading=false;}
    return result;
  }
  async commit(){
    await this.init();
    const source=this.canvas.getSvgString();
    const doc=parseSafeSVG(source);const old=doc.getElementById('studio-texts');old?.remove();
    if(this.sourceTexts.length){const metadata=doc.createElementNS(NS,'metadata');metadata.id='studio-texts';metadata.textContent=JSON.stringify(this.sourceTexts);doc.documentElement.prepend(metadata);}
    const result=await normalizeSVG(new XMLSerializer().serializeToString(doc));
    this.onStatus(result.warnings.join(' ')||'Motiv geprüft und übernommen.');return result;
  }
  undo(){this.canvas?.undoMgr.undo();this.native?.zoomChanged(null,'canvas',true);this.changed();}
  redo(){this.canvas?.undoMgr.redo();this.native?.zoomChanged(null,'canvas',true);this.changed();}
  selected(){return this.canvas?.getSelectedElements().filter(Boolean)||[];}
  async command(name,value){
    try {
      await this.init();
      switch(name){
        case 'undo':return this.undo();case 'redo':return this.redo();
        case 'mode':case 'tool':this.canvas.setMode(value);return;
        case 'group':return this.canvas.groupSelectedElements();
        case 'ungroup':return this.canvas.ungroupSelectedElement();
        case 'align':return this.canvas.alignSelectedElements(value,'selected');
        case 'delete':return this.canvas.deleteSelectedElements();
        case 'operation':return this.operation(value);
        case 'addText':case 'text':return await this.addText(value);
        case 'unite':case 'union':case 'subtract':case 'intersect':return await this.boolean(name==='union'?'unite':name);
        case 'selectAll':return this.canvas.selectAllInCurrentLayer();
        case 'grid':{
          const doc=this.frame.contentDocument;const grid=doc.getElementById('tool_grid');grid?.click();return;
        }
        default:throw new Error(`Unbekannter Editorbefehl: ${name}`);
      }
    }catch(error){this.onStatus(error.message);throw error;}
  }
  operation(value){
    if(!['cut','engrave'].includes(value))throw new Error('Operation muss Schnitt oder Gravur sein.');
    if(!this.selected().length)throw new Error('Bitte zuerst mindestens ein Objekt auswählen.');
    this.canvas.changeSelectedAttribute('data-operation',value);
    this.canvas.changeSelectedAttribute('stroke',value==='engrave'?'#d77b24':'#233e4c');
    this.canvas.changeSelectedAttribute('stroke-width',0.6);
    this.onStatus(value==='engrave'?'Auswahl als Gravur markiert.':'Auswahl als Schnitt markiert.');
  }
  async addText(input){
    const {text,size=24}=typeof input==='string'?{text:input}:input||{};
    const x=Math.max(1,this.canvas.contentW*.1),y=Math.max(1,this.canvas.contentH*.6);
    const d=await textPath(text,x,y,Number(size));
    const path=this.canvas.addSVGElementsFromJson({element:'path',attr:{d,fill:'#263d47',stroke:'none','data-operation':'cut'}});
    this.canvas.addCommandToHistory(new this.canvas.history.InsertElementCommand(path,'Text als Pfade'));
    this.canvas.selectOnly([path],true);this.canvas.call('changed',[path]);
    this.sourceTexts.push({text,font:'Noto Sans',size:Number(size),x,y});
    this.onStatus('Text mit Noto Sans als echte Schnittpfade eingefügt. Originaltext bleibt im Projekt gespeichert.');this.changed();
  }
  async boolean(operation){
    const selected=this.selected();if(selected.length<2)throw new Error('Für eine boolesche Operation mindestens zwei geschlossene Objekte auswählen.');
    const paper=await loadPaper();const scope=new paper.PaperScope();scope.setup(new scope.Size(100,100));
    try {
      const items=[];
      for(const element of selected){
        const svg=document.createElementNS(NS,'svg');svg.setAttribute('width','100');svg.setAttribute('height','100');
        const copy=document.importNode(element,true);copy.removeAttribute('transform');
        const content=this.canvas.getSvgContent();const matrix=content.getCTM().inverse().multiply(element.getCTM());
        copy.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);svg.append(copy);
        parseSafeSVG(new XMLSerializer().serializeToString(svg));
        const item=scope.project.importSVG(svg,{insert:false,expandShapes:true,applyMatrix:true});
        const paths=item.getItems({class:scope.Path});
        if(paths.some(p=>!p.closed))throw new Error('Boolesche Operationen benötigen geschlossene Pfade.');
        const pathData=paths.map(p=>{p.transform(p.globalMatrix);return p.pathData;}).join(' ');
        if(!pathData)throw new Error('Die Auswahl enthält keine geschlossenen Vektorpfade.');
        items.push(new scope.CompoundPath({pathData,insert:false}));
      }
      let result=items[0];for(const item of items.slice(1))result=result[operation](item,{insert:false});
      if(!result.pathData)throw new Error('Die Operation ergibt eine leere Fläche.');
      const {BatchCommand,RemoveElementCommand,InsertElementCommand}=this.canvas.history;
      const batch=new BatchCommand(`Boolesch: ${operation}`);
      this.canvas.clearSelection();
      for(const element of selected){const cmd=new RemoveElementCommand(element,element.nextSibling,element.parentNode);element.remove();batch.addSubCommand(cmd);}
      const path=this.canvas.addSVGElementsFromJson({element:'path',attr:{d:result.pathData,fill:'#263d47',stroke:'none','data-operation':'cut'}});
      batch.addSubCommand(new InsertElementCommand(path));this.canvas.addCommandToHistory(batch);
      this.canvas.selectOnly([path],true);this.canvas.call('changed',[path]);
      this.onStatus('Boolesche Pfadoperation angewendet.');this.changed();
    }finally{scope.project.remove();}
  }
  destroy(){this.frame.remove();this.canvas=null;this.native=null;this.ready=null;}
}
