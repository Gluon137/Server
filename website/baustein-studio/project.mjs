export const defaults={version:1,axes:{x:[100],y:[100],z:[100]},cells:[[0,0,0]],openFaces:[],joint:{thickness:4,finger:2,space:2,relative:true,surroundingspaces:2,play:0,burn:0},layout:{width:600,height:400,margin:5,spacing:5,rotate:true}};
export const axisNames=['x','y','z'];
export const clone=value=>structuredClone(value);
export const cellKey=cell=>cell.join(',');
export const faceKey=(cell,axis,sign)=>`${cellKey(cell)}:${axis}:${sign}`;
export function validateProject(value){
 const fail=message=>{throw new Error(message);};
 if(!value||typeof value!=='object'||value.version!==1)fail('Die Projektdatei benötigt Formatversion 1.');
 for(const axis of axisNames){const list=value.axes?.[axis];if(!Array.isArray(list)||!list.length||list.length>32||list.some(n=>!Number.isFinite(n)||n<=0)||list.reduce((a,b)=>a+b,0)>3000)fail('Rastermaße: 1–32 positive Abschnitte, insgesamt höchstens 3000 mm je Achse.');}
 if(!Array.isArray(value.cells)||value.cells.length>512)fail('Ein Projekt darf höchstens 512 Blöcke enthalten.');
 const seen=new Set();for(const cell of value.cells){if(!Array.isArray(cell)||cell.length!==3||cell.some((n,i)=>!Number.isInteger(n)||n<0||n>=value.axes[axisNames[i]].length)||seen.has(cellKey(cell)))fail('Ungültige oder doppelte Blockkoordinaten.');seen.add(cellKey(cell));}
 if(!Array.isArray(value.openFaces)||value.openFaces.length>3072||value.openFaces.some(key=>typeof key!=='string'||!/^\d+,\d+,\d+:[xyz]:(?:-1|1)$/.test(key)||!seen.has(key.split(':')[0]))||new Set(value.openFaces).size!==value.openFaces.length)fail('Ungültige offene Flächen.');
 for(const [group,fields] of [['joint',['thickness','finger','space','surroundingspaces','play','burn']],['layout',['width','height','margin','spacing']]]){if(!value[group]||fields.some(key=>!Number.isFinite(value[group][key])))fail('Unvollständige oder ungültige Material- und Plattenwerte.');}
 if(typeof value.joint.relative!=='boolean'||typeof value.layout.rotate!=='boolean')fail('Ungültige Schalterwerte.');
 const limits={joint:{thickness:[.5,100],finger:[Number.MIN_VALUE,1000],space:[Number.MIN_VALUE,1000],surroundingspaces:[0,100],play:[0,100],burn:[0,100]},layout:{width:[Number.MIN_VALUE,10000],height:[Number.MIN_VALUE,10000],margin:[0,1000],spacing:[0,1000]}};
 for(const [group,fields] of Object.entries(limits))for(const [key,[min,max]] of Object.entries(fields))if(value[group][key]<min||value[group][key]>max)fail(`Ungültiger Wert für ${group}.${key}: ${min===Number.MIN_VALUE?'größer als 0':min} bis ${max}.`);
 // Copy only the documented fields; file content never becomes markup or executable code.
 return {version:1,axes:Object.fromEntries(axisNames.map(a=>[a,[...value.axes[a]]])),cells:value.cells.map(c=>[...c]),openFaces:[...value.openFaces],joint:Object.fromEntries(['thickness','finger','space','relative','surroundingspaces','play','burn'].map(k=>[k,value.joint[k]])),layout:Object.fromEntries(['width','height','margin','spacing','rotate'].map(k=>[k,value.layout[k]]))};
}
export function boundaries(project){return Object.fromEntries(axisNames.map(a=>[a,[0,...project.axes[a].map((_,i)=>project.axes[a].slice(0,i+1).reduce((s,n)=>s+n,0))]]));}
export function outsideFaces(project){const cells=new Set(project.cells.map(cellKey)),result=[];for(const cell of project.cells)for(const [index,axis] of axisNames.entries())for(const sign of [-1,1]){const next=[...cell];next[index]+=sign;if(!cells.has(cellKey(next)))result.push({cell,axis,sign,key:faceKey(cell,axis,sign),plane:cell[index]+(sign===1?1:0)});}return result;}
export function panelFacets(project,key){
 const faces=outsideFaces(project),start=faces.find(f=>f.key===key);if(!start)return [];
 const candidates=faces.filter(f=>f.axis===start.axis&&f.sign===start.sign&&f.plane===start.plane),result=[],queue=[start],seen=new Set([key]),uv=axisNames.map((a,i)=>a===start.axis?-1:i).filter(i=>i>=0);
 while(queue.length){const current=queue.pop();result.push(current.key);for(const face of candidates)if(!seen.has(face.key)&&uv.reduce((s,i)=>s+Math.abs(face.cell[i]-current.cell[i]),0)===1){seen.add(face.key);queue.push(face);}}return result;
}
export function addCell(project,selected,axis='x',sign=1){
 if(project.cells.length>=512)throw new Error('Höchstens 512 Blöcke sind möglich.');
 if(!project.cells.length){const first=[0,0,0];project.cells.push(first);return first;}
 const index=axisNames.indexOf(axis),target=[...selected];target[index]+=sign;
 if(project.cells.some(c=>cellKey(c)===cellKey(target)))throw new Error('An dieser Stelle steht bereits ein Block.');
 const intervals=project.axes[axis];if(target[index]<0||target[index]>=intervals.length){const width=intervals[target[index]<0?0:intervals.length-1];if(intervals.length>=32||intervals.reduce((a,b)=>a+b,0)+width>3000)throw new Error('Rastergrenze erreicht: 32 Abschnitte / 3000 mm.');if(target[index]<0){intervals.unshift(width);for(const c of project.cells)c[index]++;project.openFaces=project.openFaces.map(key=>{const [coords,a,s]=key.split(':'),c=coords.split(',').map(Number);c[index]++;return faceKey(c,a,Number(s));});target[index]=0;}else intervals.push(width);}
 project.cells.push(target);const outside=new Set(outsideFaces(project).map(f=>f.key));project.openFaces=project.openFaces.filter(k=>outside.has(k));return target;
}
export function removeCell(project,cell){project.cells=project.cells.filter(c=>cellKey(c)!==cellKey(cell));project.openFaces=project.openFaces.filter(k=>k.split(':')[0]!==cellKey(cell));}
export function togglePanel(project,key,facets=panelFacets(project,key)){if(!facets.length)return;const opened=facets.some(k=>project.openFaces.includes(k)),set=new Set(project.openFaces);for(const k of facets)opened?set.delete(k):set.add(k);project.openFaces=[...set];}

export function openedFacets(project){const opened=new Set(project.openFaces),visited=new Set();for(const key of project.openFaces){if(visited.has(key))continue;const facets=panelFacets(project,key);for(const facet of facets)opened.add(facet);facets.forEach(f=>visited.add(f));}return opened;}

export function panelCode(id){const match=/^panel-(\d+)$/.exec(String(id));return match?`P${Number(match[1]).toString().padStart(2,'0')}`:String(id).slice(0,24);}
