import {buildProject} from './geometry.mjs';
import {validateProject} from './project.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const operations={CUT:'cut',FOLD_MOUNTAIN:'mountain',FOLD_VALLEY:'valley',ENGRAVE:'engrave'};
export function exportSVG(project){const p=validateProject(project),build=buildProject(p);
 if(build.errors.length)throw new Error(`Export gesperrt: ${build.errors.map(e=>e.message).join(' ')}`);
 const groups=Object.entries(operations).map(([operation,color])=>`<g id="${operation}" inkscape:groupmode="layer" inkscape:label="${operation}" fill="none" stroke="${p.colors[color]}" stroke-width="0.15" stroke-linejoin="round" stroke-linecap="round">${build.parts.map(part=>`<g data-part="${escape(part.id)}" transform="translate(${part.placement.x} ${part.placement.y})"><title>${escape(part.label)}</title>${part.paths.filter(a=>a.operation===operation).map(a=>`<path${a.surfaceId?` data-surface="${escape(a.surfaceId)}"`:''}${a.figureId?` data-figure="${escape(a.figureId)}"`:''} ${a.structureId?` data-structure="${escape(a.structureId)}"`:''} ${a.lineId?` data-line="${escape(a.lineId)}"`:''} d="${escape(a.d)}"/>`).join('')}</g>`).join('')}</g>`).join('\n');
 return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${p.layout.width}mm" height="${p.layout.height}mm" viewBox="0 0 ${p.layout.width} ${p.layout.height}"><title>Klappkarten-Studio · Einblatt-Schnittdatei in Millimetern</title><desc>Ein zusammenhängendes Blatt, keine Klebeteile. CUT: schneiden. FOLD_MOUNTAIN: Bergfalte. FOLD_VALLEY: Talfalte. ENGRAVE: gravieren. Die Scharnierkanten bleiben ungeschnitten. Keine Materialstärkenkompensation.</desc>\n${groups}\n</svg>`;
}
export function exportProject(project){return JSON.stringify(validateProject(project),null,2);}
