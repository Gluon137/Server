// Generated sheets have their own output budget; imported artwork uses the stricter importer.
const ELEMENTS=new Set(['svg','g','path','rect','line','polyline','polygon','circle','ellipse','text','title','desc']);
const ATTRIBUTES=new Set(['xmlns','data-operation','id','width','height','viewBox','fill','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-opacity','fill-opacity','opacity','transform','d','x','y','x1','x2','y1','y2','points','cx','cy','r','rx','ry','font-size','font-family','text-anchor','vector-effect']);
export function parseSheetSVG(source){
 if(typeof source!=='string'||/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source))throw new Error('Ungültige Schnittplatte.');
 const doc=new DOMParser().parseFromString(source,'image/svg+xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw new Error('Die Schnittplatte ist kein gültiges SVG.');
 for(const node of doc.querySelectorAll('*')){
  if(node.namespaceURI!=='http://www.w3.org/2000/svg'||!ELEMENTS.has(node.localName))throw new Error('Unerlaubtes Element in der Schnittplatte.');
  for(const attribute of node.attributes)if(!ATTRIBUTES.has(attribute.name)||/url\s*\(|javascript:|data:|https?:\/\//i.test(attribute.value)&&attribute.name!=='xmlns')throw new Error('Unerlaubtes Attribut in der Schnittplatte.');
 }
 return doc;
}
