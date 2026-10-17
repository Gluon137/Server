export const STORAGE_KEY='box-studio-project-v1';
export const clone=value=>structuredClone(value);
export const defaults={version:1,box:{shape:'rect',width:200,depth:140,height:100,radius:20,dimensions:'outer',lid:'removable',lidValue:0},material:{thickness:3,finger:9,play:.15,burn:0,flexStretch:1.05,flexPitch:3},parts:[],features:[],groups:[],hardware:[],layout:{width:600,height:400,margin:5,spacing:5,rotate:true}};

// Copy the documented fields only. Source files are data, never executable markup.
export function validateProject(input){
 const fail=message=>{throw new Error(message);};
 const obj=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(`${label}: Objekt erwartet.`);return v;};
 const number=(v,label,min=-6000,max=6000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`${label}: Zahl zwischen ${min} und ${max} erwartet.`);return v;};
 const choice=(v,values,label)=>{if(!values.includes(v))fail(`${label}: unbekannte Auswahl.`);return v;};
 const str=(v,label,max=160)=>{if(typeof v!=='string'||v.length>max)fail(`${label}: ungültiger Text.`);return v;};
 const list=(v,label,max)=>{if(!Array.isArray(v)||v.length>max)fail(`${label}: höchstens ${max} Einträge.`);return v;};
 let pointCount=0;
 const vector=(v,label,size=3)=>{if(!Array.isArray(v)||v.length!==size)fail(`${label}: ${size} Koordinaten erwartet.`);return v.map(n=>number(n,label,-36000,36000));};
 const points=(v,label)=>list(v??[],label,4000).map(p=>{if(++pointCount>12000)fail('Höchstens 12000 Konturpunkte pro Projekt.');return vector(p,label,2);});
 const loops=(v,label)=>list(v??[],label,256).map(loop=>points(loop,label));
 const anchor=(v={},withPosition=false)=>{obj(v,'Bezug');const result={u:choice(v.u??'center',['start','center','end','relative'],'U-Bezug'),v:choice(v.v??'center',['start','center','end','relative'],'V-Bezug')};if(withPosition){result.x=number(v.x??0,'U-Position');result.y=number(v.y??0,'V-Position');}return result;};
 const motion=(v={type:'fixed'})=>{obj(v,'Bewegung');const type=choice(v.type,['fixed','slider','revolute'],'Bewegung');const result={type,axis:vector(v.axis??[0,0,1],'Bewegungsachse'),pivot:vector(v.pivot??[0,0,0],'Drehpunkt'),min:number(v.min??0,'Anfang',-3600,3600),max:number(v.max??90,'Ende',-3600,3600),value:number(v.value??0,'Stellung',-3600,3600)};if(type!=='fixed'&&Math.hypot(...result.axis)<1e-8)fail('Die Bewegungsachse darf nicht null sein.');if(result.min>result.max||result.value<result.min||result.value>result.max)fail('Bewegung: Stellung muss innerhalb der geordneten Grenzen liegen.');return result;};
 obj(input,'Projekt');if(input.version!==1)fail('Die Projektdatei benötigt Formatversion 1.');
 const box=obj(input.box,'Kiste'),material=obj(input.material,'Material'),layout=obj(input.layout,'Schnittlayout');
 const p={version:1,box:{shape:choice(box.shape,['rect','rounded','cylinder'],'Grundform'),dimensions:choice(box.dimensions,['outer','inner'],'Maßbezug'),lid:choice(box.lid,['none','removable','sliding','hinged'],'Deckel')},material:{},parts:[],features:[],groups:[],hardware:[],layout:{}};
 for(const key of ['width','depth','height'])p.box[key]=number(box[key],key,1,3000);p.box.radius=number(box.radius,'Eckradius',0,1500);
 if(p.box.shape!=='rect'&&!['none','removable'].includes(p.box.lid))fail('Runde Kisten unterstützen offene oder abnehmbare Deckel.');
 p.box.lidValue=number(box.lidValue??0,'Deckelstellung',0,3600);
 for(const [key,min,max] of [['thickness',.5,30],['finger',.5,300],['play',0,5],['burn',0,2],['flexStretch',.8,1.3],['flexPitch',.5,20]])p.material[key]=number(material[key],key,min,max);
 for(const [key,min,max] of [['width',10,10000],['height',10,10000],['margin',0,1000],['spacing',0,1000]])p.layout[key]=number(layout[key],key,min,max);
 if(typeof layout.rotate!=='boolean')fail('Schnittlayout: Drehschalter fehlt.');p.layout.rotate=layout.rotate;
 const ids=new Set(),identifier=(v,label)=>{str(v,label,80);if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v))fail(`${label}: ungültige Kennung.`);return v;};
 const unique=(v,label)=>{identifier(v,label);if(ids.has(v))fail('Doppelte Kennung im Projekt.');ids.add(v);return v;};
 const baseIds=new Set(['bottom','front','back','left','right','lid','wrap','bottom-ring','top-ring','lid-ring','lid-motion','rail-left','rail-right','hinge-left','hinge-right','hinge-lid-left','hinge-lid-right','seam-strap']);
 for(const raw of list(input.parts??[],'Zusatzbretter',128)){const v=obj(raw,'Zusatzbrett');if(baseIds.has(v.id))fail('Zusatzteil verwendet eine reservierte Kennung.');p.parts.push({id:unique(v.id,'Teilkennung'),name:str(v.name??'Zusatzbrett','Teilename'),kind:choice(v.kind??'custom',['custom','divider','shelf','reinforcement','decoration','slider','rotor'],'Teilvorlage'),host:identifier(v.host,'Bezugsfläche'),shape:choice(v.shape??'rect',['rect','circle','polygon','svg'],'Teilform'),width:number(v.width,'Teilbreite',.1,3000),height:number(v.height,'Teilhöhe',.1,3000),points:points(v.points,'Teilkontur'),contours:loops(v.contours,'Teilkonturen'),anchor:anchor(v.anchor,true),rotation:vector(v.rotation??[0,0,0],'Teildrehung'),offset:number(v.offset??0,'Abstand'),fit:choice(v.fit??'fixed',['fixed','width','height','both'],'Größenbezug'),connection:choice(v.connection??'none',['none','glue','screw','tabs'],'Anschluss'),motion:motion(v.motion)});}
 for(const raw of list(input.features??[],'Bearbeitungen',512)){const v=obj(raw,'Bearbeitung');p.features.push({id:unique(v.id,'Bearbeitungskennung'),partId:identifier(v.partId,'Zielfläche'),name:str(v.name??'Bearbeitung','Bearbeitungsname'),shape:choice(v.shape,['circle','rect','slot','polygon','pattern','svg','text'],'Werkzeug'),operation:choice(v.operation,['cut','engrave'],'Bearbeitungsart'),x:number(v.x??0,'X'),y:number(v.y??0,'Y'),width:number(v.width,'Breite',.01,6000),height:number(v.height,'Höhe',.01,6000),angle:number(v.angle??0,'Drehung',-36000,36000),anchor:anchor(v.anchor),points:points(v.points,'Kontur'),contours:loops(v.contours,'Konturen'),lines:loops(v.lines,'Linien'),count:number(v.count??3,'Anzahl',1,128),pitch:number(v.pitch??12,'Teilung',.01,3000),text:str(v.text??'','Text',2000),source:str(v.source??'','SVG-Quelle',2*1024*1024)});if(!Number.isInteger(p.features.at(-1).count))fail('Die Anzahl muss ganzzahlig sein.');}
 const grouped=new Set();
 for(const raw of list(input.groups??[],'Baugruppen',64)){const v=obj(raw,'Baugruppe');const partIds=list(v.partIds,'Baugruppenteile',128).map(id=>{identifier(id,'Teilkennung');if(grouped.has(id))fail('Ein Teil darf nur zu einer Baugruppe gehören.');grouped.add(id);return id;});p.groups.push({id:unique(v.id,'Baugruppenkennung'),name:str(v.name??'Baugruppe','Baugruppenname'),partIds,motion:motion(v.motion)});}
 for(const part of p.parts)if(grouped.has(part.id)&&part.motion.type!=='fixed')fail('Gruppierte Teile benötigen eine feste Einzelbewegung.');
 for(const raw of list(input.hardware??[],'Zusatzmaterial',128)){const v=obj(raw,'Zusatzmaterial');const quantity=number(v.quantity,'Menge',1,10000);if(!Number.isInteger(quantity))fail('Die Materialmenge muss ganzzahlig sein.');p.hardware.push({id:unique(v.id,'Materialkennung'),name:str(v.name,'Materialname'),quantity,diameter:number(v.diameter??0,'Durchmesser',0,1000),length:number(v.length??0,'Länge',0,3000)});}
 // Missing references are a repairable construction error, not a corrupt file.
 const byId=new Map(p.parts.map(v=>[v.id,v])),active=new Set(),done=new Set();
 function visit(id){if(active.has(id))fail('Zyklische Abhängigkeit zwischen Zusatzteilen.');if(done.has(id)||!byId.has(id))return;active.add(id);visit(byId.get(id).host);active.delete(id);done.add(id);}
 for(const id of byId.keys())visit(id);
 return p;
}
