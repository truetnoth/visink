const page=await figma.getNodeByIdAsync('18:2');await figma.setCurrentPageAsync(page);
const shelf=await figma.getNodeByIdAsync(F.shelfId);shelf.x=6800;shelf.y=0;
const ids=[],mutated=[],components=[],warnings=[];
await Promise.all(['Regular','Semibold','Bold','Regular Italic'].map(style=>figma.loadFontAsync({family:'SF Pro',style})));
await figma.loadFontAsync({family:'JetBrains Mono',style:'Regular'});
const vars={};await Promise.all(Object.entries(F.tokens[theme]).map(async([key,id])=>{vars[key]=await figma.variables.getVariableByIdAsync(id)}));
const geom={};await Promise.all(Object.entries(F.geometry).map(async([key,id])=>{geom[key]=await figma.variables.getVariableByIdAsync(id)}));
const register=n=>{ids.push(n.id);return n};
const rgb=s=>{if(!s)return null;if(s[0]==='#'){let v=s.slice(1);if(v.length===3)v=v.split('').map(c=>c+c).join('');return {r:parseInt(v.slice(0,2),16)/255,g:parseInt(v.slice(2,4),16)/255,b:parseInt(v.slice(4,6),16)/255,a:1}}const a=s.match(/[\d.]+/g)?.map(Number);return a?.length>=3?{r:a[0]/255,g:a[1]/255,b:a[2]/255,a:a[3]??1}:null};
const paint=s=>{const c=rgb(s);if(!c||c.a===0)return [];const {a,...color}=c;let p={type:'SOLID',color,opacity:a};for(const [key,val]of Object.entries(data.tokens)){const b=rgb(val);if(Math.abs(b.r-c.r)+Math.abs(b.g-c.g)+Math.abs(b.b-c.b)<.003){p=figma.variables.setBoundVariableForPaint(p,'color',vars[key]);break}}return [p]};
const paletteCache=new Map();
const existing=page.findAllWithCriteria({types:['COMPONENT']});for(const c of existing)paletteCache.set(c.name,c);
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16)};
const norm=n=>JSON.stringify([n.type,n.tag,Math.round(n.w*100)/100,Math.round(n.h*100)/100,n.cls,n.bg,n.border,n.bw,n.radius,n.type==='text'?'':n.svg,n.size,n.color,n.font,n.weight,n.children?.map(c=>JSON.parse(norm(c)))]);
function applyBox(n,d){n.resize(Math.max(.1,d.w),Math.max(.1,d.h));n.fills=paint(d.bg);n.clipsContent=!!d.clip;n.opacity=d.opacity??1;
 if(d.radius){[n.topLeftRadius,n.topRightRadius,n.bottomRightRadius,n.bottomLeftRadius]=d.radius.map(x=>Math.min(x,d.w/2,d.h/2));if(d.radius.every(x=>x===d.radius[0])&&geom[d.radius[0]])n.setBoundVariable('cornerRadius',geom[d.radius[0]]);}
 if(d.bw?.some(x=>x>0)){n.strokes=paint(d.border);n.strokeAlign='INSIDE';[n.strokeTopWeight,n.strokeRightWeight,n.strokeBottomWeight,n.strokeLeftWeight]=d.bw;}
 const sh=d.shadow?.match(/rgba?\([^)]+\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);if(sh){const c=rgb(sh[0].match(/rgba?\([^)]+\)/)[0]);if(c)n.effects=[{type:'DROP_SHADOW',color:c,offset:{x:+sh[1],y:+sh[2]},radius:+sh[3],spread:0,visible:true,blendMode:'NORMAL'}];}}
function axisOf(d){const cs=d.children||[];if(!cs.length)return 'VERTICAL';if(d.cls?.includes('react-flow')||cs.some(c=>c.position==='absolute'||c.position==='fixed'))return null;
 const fits=axis=>{const key=axis==='HORIZONTAL'?'x':'y',size=key==='x'?'w':'h';for(let i=1;i<cs.length;i++)if(cs[i][key]<cs[i-1][key]+cs[i-1][size]-.5)return false;return cs.every(c=>c[key]>=d[key]-.5&&c[key]+c[size]<=d[key]+d[size]+.5)};
 if(d.display==='flex'){const axis=d.dir==='column'?'VERTICAL':'HORIZONTAL';if(fits(axis))return axis;}
 return fits('VERTICAL')?'VERTICAL':fits('HORIZONTAL')?'HORIZONTAL':null;}
function textNode(d,parent){const n=register(figma.createText());parent.appendChild(n);const mono=/mono|Menlo|Consolas/i.test(d.font);const style=mono?'Regular':d.italic?'Regular Italic':d.weight>=700?'Bold':d.weight>=600?'Semibold':'Regular';
 n.fontName={family:mono?'JetBrains Mono':'SF Pro',style};n.fontSize=d.size;n.textAutoResize='NONE';n.resize(Math.max(1,d.w+.5),Math.max(d.h,d.lh));n.characters=d.text;n.name=(typeof d.name==='string'?d.name:'SVG');n.fills=paint(d.color);n.lineHeight={unit:'PIXELS',value:d.lh};n.textAlignHorizontal=['center','right'].includes(d.align)?d.align.toUpperCase():'LEFT';
 if(!mono&&d.size===13&&style==='Regular')n.textStyleId=F.typography.Body;else if(!mono&&d.size===12&&style==='Regular')n.textStyleId=F.typography.Caption;
 return n;}
function raw(d,parent,component=false){let n;
 if(d.type==='text')return textNode(d,parent);
 if(d.type==='svg'){n=register(figma.createNodeFromSvg(d.svg));parent.appendChild(n);n.name=(typeof d.name==='string'?d.name:'SVG');for(const c of n.findAll(()=>true))ids.push(c.id);return n;}
 const axis=axisOf(d);n=register(component?figma.createComponent():axis?figma.createAutoLayout(axis):figma.createFrame());parent.appendChild(n);n.name=(typeof d.name==='string'?d.name:'SVG'); if(component&&axis)n.layoutMode=axis;applyBox(n,d);
 if(d.checkbox&&d.checked){const tick=register(figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="m5 10 3 3 7-7" fill="none" stroke="#fff" stroke-width="2"/></svg>'));n.appendChild(tick);tick.x=0;tick.y=0;for(const c of tick.findAll(()=>true))ids.push(c.id);}
 const cs=d.children||[];
 if(axis){n.itemSpacing=0;n.paddingLeft=0;n.paddingRight=0;n.paddingTop=0;n.paddingBottom=0;const main=axis==='VERTICAL'?'y':'x',size=main==='y'?'h':'w',cross=main==='y'?'x':'y';let cursor=d[main];
  for(const child of cs){const wrap=register(figma.createAutoLayout(axis));n.appendChild(wrap);wrap.name='Отступ / '+(typeof child.name==='string'?child.name:'SVG');const gap=Math.max(0,child[main]-cursor);const crossGap=Math.max(0,child[cross]-d[cross]);wrap.fills=[];wrap.clipsContent=false;wrap.resize(axis==='VERTICAL'?d.w:child.w+gap,axis==='VERTICAL'?child.h+gap:d.h);if(axis==='VERTICAL'){wrap.paddingTop=gap;wrap.paddingLeft=crossGap;}else{wrap.paddingLeft=gap;wrap.paddingTop=crossGap;}
   const c=build(child,wrap);c.layoutSizingHorizontal='FIXED';c.layoutSizingVertical='FIXED';cursor=child[main]+child[size];
  }
 }else{for(const child of cs){const c=build(child,n);c.x=child.x-d.x;c.y=child.y-d.y;}}
 return n;}
function build(d,parent){const isIcon=d.type==='svg'&&d.w<100&&d.h<100;const isButton=d.tag==='BUTTON'&&d.w<400&&d.h<70;const isInput=d.tag==='INPUT'&&d.w<900;
 if(!(isIcon||isButton||isInput))return raw(d,parent);
 const role=isIcon?'Icon':isButton?'Button':'Input';const signature=role+'/'+theme+'/'+hash(norm(d));let c=paletteCache.get(signature);
 if(!c){c=raw(d,shelf,true);if(c.type!=='COMPONENT'){const wrap=register(figma.createComponent());shelf.appendChild(wrap);wrap.resize(Math.max(1,d.w),Math.max(1,d.h));wrap.fills=[];wrap.appendChild(c);c.x=0;c.y=0;c=wrap;}
 c.name=signature;c.description='Из '+(isIcon?'SVG исходного интерфейса':d.tag+' '+d.cls)+'. Текст редактируется через свойства экземпляра.';const texts=c.findAllWithCriteria({types:['TEXT']});texts.forEach((t,i)=>{const key=c.addComponentProperty('Text '+(i+1),'TEXT',t.characters);t.componentPropertyReferences={characters:key};});paletteCache.set(signature,c);components.push({id:c.id,name:c.name});}
 const inst=register(c.createInstance());parent.appendChild(inst);inst.name=(typeof d.name==='string'?d.name:'SVG');inst.resize(Math.max(1,d.w),Math.max(1,d.h));
 const sourceTexts=[];const scan=n=>{if(n.type==='text')sourceTexts.push(n.text);for(const x of n.children||[])scan(x)};scan(d);const props=c.componentPropertyDefinitions;const keys=Object.keys(props).filter(k=>props[k].type==='TEXT');if(keys.length===sourceTexts.length)inst.setProperties(Object.fromEntries(keys.map((k,i)=>[k,sourceTexts[i]])));
 for(const x of inst.findAll(()=>true))ids.push(x.id);return inst;}
const root=register(figma.createFrame());page.appendChild(root);root.name=screenName;root.resize(data.w,data.h);root.x=200+(screenIndex%4)*1600;root.y=1100+Math.floor(screenIndex/4)*1080;root.fills=paint(data.tokens.bg);root.clipsContent=true;
const content=raw(data.tree,root);content.x=0;content.y=0;
return {createdNodeIds:ids,mutatedNodeIds:[shelf.id],rootId:root.id,name:root.name,components,warnings,nodeCount:ids.length};

