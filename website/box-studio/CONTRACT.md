# Kästchen-Studio implementation contract

All coordinates and lengths are millimetres; angles are degrees. Source document:

```js
{version:1, box:{shape:'rect',width:200,depth:140,height:100,radius:20,dimensions:'outer',lid:'removable'},
 material:{thickness:3,finger:9,play:0.15,burn:0,flexStretch:1.05,flexPitch:3},
 parts:[], features:[], groups:[], hardware:[],
 layout:{width:600,height:400,margin:5,spacing:5,rotate:true}}
```

Shapes: `rect`, `rounded`, `cylinder` (diameter is width). Nonrectangular lids: `none` or `removable`; rectangular also `sliding`, `hinged`.

Additional part: `{id,name,kind,host,shape,width,height,points:[],contours:[],anchor:{u:'center',v:'center',x:0,y:0},rotation:[0,0,0],offset:0,fit:'fixed',connection:'none',motion:{type:'fixed',axis:[0,0,1],pivot:[0,0,0],min:0,max:90,value:0}}`. Kinds: custom/divider/shelf/reinforcement/decoration/slider/rotor. Shape: rect/circle/polygon/svg. Host is a base or custom part ID. Fit: fixed/width/height/both. Connections: none/glue/screw/tabs. Anchor modes start/center/end/relative; start/end values are inward distances, center is signed distance, relative value is a fraction. Rotation is local XYZ Euler. Motion axis/pivot are world coordinates; translation is in mm, revolution in degrees. Base IDs: bottom/front/back/left/right/lid, wrap for curved walls; round forms additionally retaining rings. Base lid joint ID `lid-motion`.

Feature: `{id,partId,name,shape,operation,x,y,width,height,angle,anchor:{u:'center',v:'center'},points:[],contours:[],lines:[],count:3,pitch:12,text:'',source:''}`. Shapes circle/rect/slot/polygon/pattern/svg/text. Features use centre positions relative to the host nominal bounding box and anchor modes above. Polygon points are local mm around their centre; imported contours/lines are centred mm (frontend converts normalizeSVG's 0–1 coordinate fractions using physical width/height). Closed contours are cut areas; open lines are engraving. Text is outlined in the browser before build, while source text is retained. Groups: `{id,name,partIds:[],motion:{...}}`; grouped parts must have fixed individual motion. Hardware: `{id,name,quantity,diameter,length}`. Geometric resource limits validated on server.

`build_project` response: `{valid,errors:[{code,message,partIds:[],featureId?}],warnings:[],parts:[],joints:[],sheets:[],hardware:[],checks:{geometry,manufacturing,assembly,motion},motionChecks:[],stats:{...}}`.

Each output part: `{id,name,nominal:[[x,y],...],nominalHoles:[loops...],thickness,frame:{origin:[x,y,z],u:[x,y,z],v:[x,y,z],normal:[x,y,z]},bounds:[minU,minV,maxU,maxV],engrave:[polylines...],flexCuts:[polylines...],protected:[loops...],cutPath:string,surface?:{type:'wrap',samples:[{s,x,y,nx,ny}],z:number},...}`. Local flat coordinates map by origin + u*x + v*y + normal*depth; extrusion is [0,thickness]. For wrap surfaces, u=s interpolates samples to XY and v maps to z+v; normal maps along nx/ny. All exported paths local to part. Keep nominal geometry distinct from compensated toolpaths.

Joints: `{id,name,partIds:[],type:'slider'|'revolute',axis:[...],pivot:[...],min,max,value,contacts:[]}`. Parts are built at joint state zero; frontend and motion checker apply value relative to zero, with axis and pivot in world coordinates. Contacts may only exempt local declared joint regions, never entire part pairs. A sheet is `{index,width,height,svg,placements:[{partId,x,y,angle}]}`. SVG string is safe server-generated markup. checks use `valid`/`invalid`/`unchecked`; motionChecks entries use `clear`/`collision`/`unchecked` and jointId/message. Known collision blocks export; unproved intervals remain unchecked.

Backend modules: geometry.py exports default_project(), validate_project(), build_project(). motion.py exports check_project(parts,joints, **optional_limits), returning `{status:'clear'|'collision'|'unchecked',results:[...],errors:[...]}`. Use Shapely + NumPy/SciPy already installed. No changes to existing studio project formats.
