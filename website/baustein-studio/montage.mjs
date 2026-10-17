import {axisNames,panelCode} from './project.mjs';

// Offsets describe removal; insertion travels along the opposite vector.
export function assemblyOperations(response,size=[100,100,100]){
 if(!response)return [];
 const panels=new Map((response.panels||[]).filter(p=>!p.omitted).map(p=>[p.id,p])),fallback=Math.max(...size)*.8;
 function normalize(operation,kind='panel',groupId){
  const panelIds=operation.panelIds||[operation.panelId],panel=panels.get(panelIds[0]);
  if(!Array.isArray(panelIds)||!panelIds.length||new Set(panelIds).size!==panelIds.length||panelIds.some(id=>!panels.has(id)))throw new Error('Die Montage enthält unbekannte oder doppelte Bauteile.');
  const translation=operation.translation??axisNames.map(axis=>axis===(operation.axis||panel.axis)?(operation.sign??panel.sign)*(operation.distance??fallback):0);
  if(!Array.isArray(translation)||translation.length!==3||!translation.every(Number.isFinite))throw new Error('Die Montage enthält einen ungültigen Bewegungsvektor.');
  return {...operation,panelIds,translation,kind:operation.kind||kind,groupId:operation.groupId??groupId};
 }
 if(Array.isArray(response.assemblyOperations))return response.assemblyOperations.map(operation=>normalize(operation));
 const operations=[];let group=0;
 function visit(steps,parentGroup){for(const operation of steps){if(operation.steps?.length){const groupId=operation.groupId??`G${++group}`;visit(operation.steps,groupId);operations.push(normalize(operation,'group',groupId));}else operations.push(normalize(operation,parentGroup?'preassembly':'panel',parentGroup));}}
 if(response.assemblySteps?.length)visit(response.assemblySteps);
 else for(const panelId of response.assembly||[])operations.push(normalize({panelId}));
 return operations;
}

export function panelOffset(operations,panelId,step){
 const offset=[0,0,0];
 for(const [index,operation] of operations.entries())if(operation.panelIds.includes(panelId)){const remaining=1-Math.max(0,Math.min(1,step-index));for(let axis=0;axis<3;axis++)offset[axis]+=operation.translation[axis]*remaining;}
 return offset;
}

export function assemblyInstruction(operations,step){
 if(!operations.length)return 'Für diesen Entwurf liegt noch keine Montagefolge vor.';
 if(step>=operations.length)return 'Montage abgeschlossen. Alle Bauteile sind eingesetzt; für diesen Aufbau sind keine Drehungen erforderlich.';
 const index=Math.max(0,Math.floor(step)),operation=operations[index],codes=operation.panelIds.map(panelCode).join(' + '),components=operation.translation.map((value,axis)=>value?`${value>0?'−':'+'}${axisNames[axis].toUpperCase()} ${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(Math.abs(value))} mm`:null).filter(Boolean),diagonal=components.length>1,direction=components.join(', ');
 const group=operations.slice(index+1).find(item=>item.kind==='group'&&operation.panelIds.every(id=>item.panelIds.includes(id)));
 let action=operation.kind==='group'?`Baugruppe ${codes} gemeinsam ${diagonal?'diagonal ':''}einsetzen`:operation.kind==='preassembly'||group?`${codes} in Baugruppe ${group?group.panelIds.map(panelCode).join(' + '):operation.groupId||''} vormontieren; ${diagonal?'diagonal ':''}einschieben`:`${codes} ${diagonal?'diagonal ':''}einschieben`;
 return `Schritt ${index+1}: ${action} (${direction}).${diagonal?' Die Richtungen gleichzeitig über den angegebenen Weg ausführen.':''} Keine Drehung erforderlich. Spätere lose Bauteile sind ausgeblendet.`;
}
