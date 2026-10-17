import { parse as parseFont, Path as FontPath } from './vendor/opentype.min.mjs';

const NS = 'http://www.w3.org/2000/svg';
const MAX_SOURCE = 2 * 1024 * 1024;
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'title', 'desc', 'metadata', 'defs']);
const ATTRIBUTES = new Set(['class', 'id', 'version', 'xmlns', 'xmlns:xlink', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'opacity', 'style', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'xml:space', 'display', 'visibility', 'data-operation', 'data-source-text', 'data-font-size', 'data-studio-normalized', 'data-studio-curve-tolerance']);
const STYLES = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'display', 'visibility']);
let paperPromise, fontPromise;

export function loadPaper() {
  return paperPromise ||= new Promise((resolve, reject) => {
    if (window.paper) return resolve(window.paper);
    const script = document.createElement('script');
    script.src = new URL('./vendor/paper-core.min.js', import.meta.url).href;
    script.onload = () => resolve(window.paper);
    script.onerror = () => reject(new Error('Die lokale Vektorbibliothek konnte nicht geladen werden.'));
    document.head.append(script);
  });
}

export async function loadFont() {
  return fontPromise ||= fetch(new URL('./vendor/NotoSans.ttf', import.meta.url)).then(r => {
    if (!r.ok) throw new Error('Die lokale Schrift Noto Sans fehlt.');
    return r.arrayBuffer();
  }).then(buffer => {
    const font = parseFont(buffer);
    // The bundled Latin font needs no contextual GSUB shaping; OpenType.js does
    // not implement every contextual lookup present in modern Noto tables.
    font.defaultRenderOptions = {...font.defaultRenderOptions,features:[]};
    return font;
  });
}

export async function textPath(text, x = 10, y = 50, size = 24) {
  if (typeof text !== 'string' || !text.trim() || text.length > 250) throw new Error('Bitte 1 bis 250 Zeichen eingeben.');
  if (!Number.isFinite(size) || size < 1 || size > 500) throw new Error('Die Schriftgröße muss zwischen 1 und 500 liegen.');
  const font = await loadFont();
  for (const char of text) if (!font.charToGlyphIndex(char) && !/\s/u.test(char)) throw new Error(`Die lokale Schrift enthält das Zeichen „${char}“ nicht.`);
  const path = new FontPath();
  let cursor=x, previous;
  for (const char of text.normalize('NFC')) {
    const glyph=font.charToGlyph(char);
    if (previous) cursor+=font.getKerningValue(previous,glyph)*size/font.unitsPerEm;
    // OpenType.js omits Z for fill-only glyphs. Explicitly close every glyph
    // contour so a cutter sees physical closed paths, including letter counters.
    let open=false;
    for(const command of glyph.getPath(cursor,y,size,{},font).commands){
      if(command.type==='M'&&open)path.close();
      path.commands.push(command);open=command.type!=='Z';
    }
    if(open)path.close();
    cursor+=(glyph.advanceWidth||0)*size/font.unitsPerEm; previous=glyph;
  }
  return path.toPathData(4);
}

async function textWidth(text,size) {
  const font=await loadFont();let width=0,previous;
  for(const char of text.normalize('NFC')){const glyph=font.charToGlyph(char);if(previous)width+=font.getKerningValue(previous,glyph);width+=glyph.advanceWidth||0;previous=glyph;}
  return width*size/font.unitsPerEm;
}

// Validate before any SVG reaches a live DOM or the upstream SVG parser.
export function parseSafeSVG(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_SOURCE) throw new Error('SVG-Dateien dürfen höchstens 2 MB groß sein.');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error('DOCTYPE, Entitäten und externe Stylesheets sind nicht erlaubt.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Die Datei ist kein gültiges SVG.');
  const nodes = [...doc.querySelectorAll('*')];
  if (nodes.length > 2000) throw new Error('Das SVG enthält zu viele Elemente (maximal 2000).');
  let coordinateCount=0;
  for (const node of nodes) {
    if (!ELEMENTS.has(node.localName) || (node.namespaceURI && node.namespaceURI !== NS)) throw new Error(`Das SVG-Element „${node.localName}“ wird nicht unterstützt. Bilder, Referenzen, Filter, Masken und Beschneidungen bitte vorher in Pfade umwandeln.`);
    for (const attr of [...node.attributes]) {
      const key = attr.name;
      if (/^on/i.test(key) || /href$/i.test(key) || /[\\]|url\s*\(|javascript:|data:|https?:|\/\//i.test(attr.value) && !key.startsWith('xmlns')) throw new Error(`Aktive oder externe SVG-Inhalte sind nicht erlaubt (${key}).`);
      if (key === 'style') {
        for (const declaration of attr.value.split(';').filter(s => s.trim())) {
          const colon = declaration.indexOf(':');
          const property = declaration.slice(0, colon).trim();
          const value = declaration.slice(colon + 1).trim();
          if (colon < 0 || !STYLES.has(property) || /[{}@\\]|!important/i.test(value)) throw new Error(`Nicht unterstützter SVG-Stil: ${property}.`);
          node.setAttribute(property, value);
        }
        node.removeAttribute('style');
      } else if (!ATTRIBUTES.has(key)) {
        // Editor and Inkscape namespace annotations carry no geometry.
        if (/^(xmlns:|inkscape:|sodipodi:|data-)/.test(key)) node.removeAttribute(key);
        else throw new Error(`Nicht unterstütztes SVG-Attribut: ${key}.`);
      }
      if (attr.value.length > 350000) throw new Error('Ein SVG-Pfad ist zu komplex.');
      if (['d','points','transform','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry'].includes(key)) {
        const numbers = attr.value.match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) || [];
        coordinateCount+=numbers.length;
        if (numbers.length > 25000 || coordinateCount > 50000 || numbers.some(n => !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 1e7)) throw new Error('SVG-Koordinaten sind zu groß oder zu komplex.');
        if (/NaN|Infinity/i.test(attr.value)) throw new Error('Das SVG enthält ungültige Koordinaten.');
      }
    }
    if (node.localName === 'svg' && node !== doc.documentElement) throw new Error('Verschachtelte SVG-Zeichenflächen bitte vor dem Import in Gruppen umwandeln.');
    if (node.closest('defs') && !['defs','title','desc'].includes(node.localName)) throw new Error('SVG-Definitionen bitte vor dem Import in sichtbare Pfade umwandeln.');
  }
  return doc;
}

function inherited(node, name, fallback) {
  for (let current = node; current?.nodeType === 1; current = current.parentNode) if (current.hasAttribute(name)) return current.getAttribute(name);
  return fallback;
}

export async function normalizeSVG(source, physicalSize = {}) {
  const doc = parseSafeSVG(source);
  const root = doc.documentElement;
  const canonicalInput=root.getAttribute('data-studio-normalized')==='1'&&root.getAttribute('viewBox')==='0 0 100 100';
  const savedTolerance=Number(root.getAttribute('data-studio-curve-tolerance'));
  root.querySelectorAll('[display="none"],[visibility="hidden"],[opacity="0"]').forEach(node=>node.remove());
  const sourceTexts = [];
  for (const meta of root.querySelectorAll('metadata')) {
    if (meta.id === 'studio-texts') {
      try { const texts = JSON.parse(meta.textContent); if (Array.isArray(texts)) sourceTexts.push(...texts.filter(t => typeof t.text === 'string' && t.text.length <= 250).slice(0, 100)); } catch { /* invalid optional metadata is discarded */ }
    }
    meta.remove();
  }
  for (const text of root.querySelectorAll('text')) {
    const family = inherited(text, 'font-family', 'Noto Sans').replace(/["']/g, '').trim();
    if (!['Noto Sans', 'sans-serif'].includes(family)) throw new Error(`Die Schrift „${family}“ ist nicht lokal vorhanden. Text vorher in Pfade umwandeln oder Noto Sans verwenden.`);
    if (inherited(text, 'font-weight', 'normal') !== 'normal' && inherited(text, 'font-weight', '400') !== '400') throw new Error('Bitte normalen Schriftschnitt verwenden oder den Text vor dem Import in Pfade umwandeln.');
    if (inherited(text, 'font-style', 'normal') !== 'normal') throw new Error('Kursiven Text bitte vor dem Import in Pfade umwandeln.');
    if (text.children.length) throw new Error('Mehrteiligen SVG-Text bitte vor dem Import in Pfade umwandeln.');
    const x = Number(text.getAttribute('x') || 0), y = Number(text.getAttribute('y') || 0), size = parseFloat(inherited(text, 'font-size', '24'));
    if (![x,y,size].every(Number.isFinite)) throw new Error('Ungültige Textposition oder Schriftgröße.');
    const path = doc.createElementNS(NS, 'path');
    for (const attr of text.attributes) if (!['x','y','font-family','font-size','font-style','font-weight','text-anchor'].includes(attr.name)) path.setAttribute(attr.name, attr.value);
    path.setAttribute('d', await textPath(text.textContent, x, y, size));
    const anchor = inherited(text, 'text-anchor', 'start');
    if (anchor !== 'start') {
      const offset = await textWidth(text.textContent, size) * (anchor === 'middle' ? 0.5 : 1);
      path.setAttribute('transform', `${text.getAttribute('transform') || ''} translate(${-offset} 0)`);
    }
    sourceTexts.push({text:text.textContent,font:'Noto Sans',size,x,y});
    text.replaceWith(path);
  }
  const paper = await loadPaper();
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(100,100));
  try {
    // Remove descriptions: Paper treats all remaining nodes as vector geometry.
    root.querySelectorAll('title,desc,defs').forEach(n => n.remove());
    const imported = scope.project.importSVG(root, {insert:true,expandShapes:true,applyMatrix:true,onImport:(node,item) => { if (item) item.data.operation=inherited(node,'data-operation','cut'); }});
    if (!imported) throw new Error('Das SVG enthält keine Vektorpfade.');
    const paths = [];
    function collect(item, operation = 'cut') {
      if(item.clipMask)return;
      operation = item.data?.operation || operation;
      if (item instanceof scope.Path || item instanceof scope.CompoundPath) paths.push({item,operation});
      else if (item.children) item.children.forEach(child => collect(child, operation));
    }
    // Paper's onImport attaches our operation metadata before flattening groups.
    collect(imported);
    if (!paths.length || paths.length > 2000) throw new Error('Das Motiv enthält keine Pfade oder ist zu komplex.');
    // SVG viewport clipping groups may have page-sized bounds. Only actual
    // drawable paths define the physical motif, including exact Bézier extrema.
    let bounds;
    for(const {item} of paths){
      const parentMatrix=item.parent?.globalMatrix;
      item.remove();
      if(parentMatrix)item.transform(parentMatrix);
      item.applyMatrix=true;
      bounds=bounds?bounds.unite(item.bounds):item.bounds.clone();
    }
    if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || Math.max(Math.abs(bounds.x),Math.abs(bounds.y),bounds.width,bounds.height)>1e7) throw new Error('Das Motiv hat keine gültige zweidimensionale Kontur.');
    const result = document.implementation.createDocument(NS, 'svg'); const svg = result.documentElement;
    svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('width','100'); svg.setAttribute('height','100');
    svg.setAttribute('data-studio-normalized','1');
    const alreadyCanonical=canonicalInput&&Math.abs(bounds.x)<.0001&&Math.abs(bounds.y)<.0001&&Math.abs(bounds.width-100)<.0001&&Math.abs(bounds.height-100)<.0001;
    const physicalMaximum=+Math.max(physicalSize.width||0,physicalSize.height||0).toFixed(6);
    const tolerance=+(physicalMaximum>0 ? Math.max(.0025,Math.min(1,5/physicalMaximum)) : canonicalInput&&savedTolerance>=.0025&&savedTolerance<=1 ? savedTolerance : Math.max(.0025,Math.min(1,5/(+Math.max(bounds.width,bounds.height).toFixed(6))))).toFixed(8);
    svg.setAttribute('data-studio-curve-tolerance',String(tolerance));
    const contours = [], engravings = [], warnings = [];
    let sampleCount = 0;
    for (const entry of paths) {
      const item = entry.item;
      if(!alreadyCanonical)item.transform(new scope.Matrix(100/bounds.width,0,0,100/bounds.height,-bounds.x*100/bounds.width,-bounds.y*100/bounds.height));
      const pathData=item.getPathData(null,6);
      // Sample the exact serialized geometry, not the unrounded intermediate.
      item.pathData=pathData;
      const subpaths = item instanceof scope.CompoundPath ? item.children : [item];
      const closed = subpaths.every(path => path.closed);
      const operation = entry.operation === 'engrave' || !closed ? 'engrave' : 'cut';
      const out = result.createElementNS(NS,'path'); out.setAttribute('d',pathData);
      out.setAttribute('fill', item.fillColor?.toCSS(true) || (operation==='cut' ? '#263d47' : 'none')); out.setAttribute('stroke',item.strokeColor?.toCSS(true) || 'none');
      if (item.strokeColor) out.setAttribute('stroke-width', String(Math.min(10,item.strokeWidth||0.5)));
      // Cut contours follow the same even/odd material rule as geometry/export.
      out.setAttribute('fill-rule', operation==='cut' ? 'evenodd' : item.fillRule || 'nonzero'); out.setAttribute('data-operation',operation);
      svg.append(out);
      for (const subpath of subpaths) {
        if (!subpath.length || !Number.isFinite(subpath.length)) continue;
        const clone = subpath.clone({insert:false}); clone.flatten(tolerance);
        const points = clone.segments.map(s => [+(s.point.x/100).toFixed(6), +(s.point.y/100).toFixed(6)]);
        sampleCount += points.length;
        if (sampleCount > 2048) throw new Error('Die Konturen sind zu komplex (maximal 2048 Stützpunkte).');
        if (operation === 'engrave') {engravings.push(points); if (!closed && entry.operation !== 'engrave') warnings.push('Ein offener Pfad wurde als Gravurlinie übernommen; für Schnitte den Pfad im Knoteneditor schließen.');}
        else if (subpath.closed) contours.push(points);
        clone.remove();
      }
    }
    if (!contours.length) warnings.push('Das Motiv hat keine geschlossene Schnittkontur.');
    if (sourceTexts.length) {const metadata = result.createElementNS(NS,'metadata');metadata.id='studio-texts';metadata.textContent=JSON.stringify(sourceTexts);svg.prepend(metadata);}
    return {svg:new XMLSerializer().serializeToString(svg),contours,engravings,sourceTexts,warnings:[...new Set(warnings)],aspectRatio:bounds.width/bounds.height,physicalWidth:bounds.width,physicalHeight:bounds.height,rawBounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};
  } finally { scope.project.remove(); }
}
