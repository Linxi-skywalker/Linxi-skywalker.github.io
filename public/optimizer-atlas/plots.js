import {loss, METHODS, getMinima, getObjective, displayHeight} from './engine.js';
import {buildTerrain,projectPath,clipPath,refineDisplayPath} from './terrain.js';
import {resolveRegion,fillInspection,cancelInspection} from './inspection.js';
import {spectrum,sciencePaths,scienceColorMapping} from './palette.js';
import {buildMotionOverlays} from './motion.js';
import {preserveCamera} from './camera.js';

const grid=Array.from({length:121},(_,i)=>-5+i/12);
let raw=grid.map(y=>grid.map(x=>loss(x,y)));
let logarithmic=raw.map(row=>row.map(z=>displayHeight(z)));
const colors=[[0,'#F1F6FB'],[0.22,'#DCE9F3'],[0.45,'#BBD3E6'],[0.67,'#A8C7DD'],[0.85,'#99B4D0'],[1,'#879EBD']];
const contourColors=[[0,'#FBFCFE'],[0.25,'#EDF3F9'],[0.5,'#DCE7F2'],[0.75,'#CADBEA'],[1,'#B8CADE']];
const ink='#18243B',muted='#8694A8';
const font={family:'Segoe UI, Microsoft YaHei, sans-serif',size:10,color:muted};
const camera3d={eye:{x:-1.08,y:1.28,z:1.18},center:{x:0,y:0,z:-0.08},up:{x:0,y:0,z:1},projection:{type:'perspective'}};
const config={responsive:true,displaylogo:false,scrollZoom:true,displayModeBar:false};
const miniConfig={responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false};
const hover='<b>%{fullData.name}</b><br>t = %{text}<br>w₁ = %{x:.7f}<br>w₂ = %{y:.7f}<br>L = %{customdata:.7g}<extra></extra>';
const byId=id=>document.getElementById(id);
const height=displayHeight;
const lift=()=>terrain.lift;
const shown=name=>!hidden.has(name);
let hidden=new Set(),mode='log',runs=[],step=200,first=true;
let style='mist',focus='all',radius=0.6,samples=false,terrain=buildTerrain();
let projectedRuns=[];
let view='3d',lastExperiment,hoverBound=false,hoverFrame=0,hoverPoint=null,requestedFocus='all';
let display={balls:true,trails:true,minima:true,arrows:false},studyTarget='hover',studyRadius=1.2,studySide=1;
let colorMode='contrast',dragMode='orbit',inspectionInteracting=false;
const inside=p=>p.x>=terrain.xRange[0]&&p.x<=terrain.xRange[1]&&p.y>=terrain.yRange[0]&&p.y<=terrain.yRange[1];

function pathTrace(run,i,dimension,head=false,kind='line') {
  const pts=run.points.filter(p=>p.t<=step);
  const actual=head||kind==='samples';
  const base=head?[pts.at(-1)]:dimension===3&&!actual?projectedRuns[i].slice(0,(pts.length-1)*12+1):pts;
  const data=dimension===3&&!actual?refineDisplayPath(clipPath(base,terrain.xRange,terrain.yRange),(terrain.xRange[1]-terrain.xRange[0])/160):base.map(p=>dimension===3&&!inside(p)?null:p);
  const color=dimension===3&&style==='science'?sciencePaths[i]:METHODS[i].color;
  const trace={type:dimension===3?'scatter3d':'scatter',mode:actual?'markers':'lines',name:run.name,x:data.map(p=>p?.x??null),y:data.map(p=>p?.y??null),customdata:data.map(p=>p?.loss??null),text:data.map(p=>p?.t??null),connectgaps:false,hovertemplate:hover,showlegend:false,visible:shown(run.name)&&(kind==='samples'?samples:head?!display.balls:display.trails),line:{color,width:dimension===3?7:3,dash:dimension===2?['solid','solid','dash','dot'][i]:undefined},marker:{color,size:dimension===3?(head?5:2.5):head?8:3,line:{color:'#fff',width:1}}};
  if(dimension===3) trace.z=data.map(p=>p?height(p.loss,mode)+lift()*4:null);
  return trace;
}
function surfaceData(experiment) {
  const {x,y}=experiment.config;
  const color=scienceColorMapping(terrain.raw,colorMode);
  return [
    {type:'surface',x:terrain.x,y:terrain.y,z:terrain.z,customdata:terrain.raw,...(style==='science'?{surfacecolor:color.values,cmin:0,cmax:1}:{}),colorscale:style==='science'?spectrum:colors,showscale:style==='science',colorbar:{title:{text:'损失 L',font:{size:11,color:ink}},tickvals:color.tickvals,ticktext:color.ticktext,thickness:11,len:0.6,x:1,xpad:5,tickfont:{size:10,color:muted},outlinewidth:0},opacity:1,hovertemplate:'w₁ = %{x:.6f}<br>w₂ = %{y:.6f}<br>L = %{customdata:.6g}<extra>Himmelblau</extra>',contours:{z:{show:true,start:terrain.zRange[0],end:terrain.zMax,size:(terrain.zMax-terrain.zRange[0])/12,color:style==='science'?'#FFFFFF55':'#AFC5D9',width:1,highlight:false}},lighting:{ambient:0.95,diffuse:0.7,roughness:0.8,specular:0.15,fresnel:0.1},lightposition:{x:-300,y:-600,z:1400}},
    {type:'scatter3d',mode:'markers',name:'全局最小值',x:getMinima().filter(inside).map(p=>p.x),y:getMinima().filter(inside).map(p=>p.y),z:getMinima().filter(inside).map(()=>lift()),text:getMinima().filter(inside).map(p=>focus==='all'?p.id:`${p.id} · L=0<br>(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`),textposition:'bottom center',textfont:{color:style==='science'?ink:'#426E96',size:focus==='all'?13:12},marker:{size:6,symbol:'diamond',color:style==='science'?'#FFFFFF':'#426E96',line:{color:ink,width:2}},hovertemplate:'<b>全局最小值</b><br>(%{x:.7f}, %{y:.7f})<br>L = 0<extra></extra>',showlegend:false},
    {type:'scatter3d',mode:'markers',name:'共同起点',x:inside({x,y})?[x]:[],y:inside({x,y})?[y]:[],z:inside({x,y})?[height(loss(x,y),mode)+lift()]:[],customdata:[loss(x,y)],text:[0],marker:{size:5,color:ink,symbol:'circle',line:{color:'#fff',width:2}},hovertemplate:hover,showlegend:false},
    ...runs.map((r,i)=>pathTrace(r,i,3)),...runs.map((r,i)=>pathTrace(r,i,3,true)),
    ...runs.map((r,i)=>pathTrace(r,i,3,false,'samples'))
  ];
}
const xyAxis=title=>({title:{text:title,font:{...font,size:10}},range:[-5,5],tickvals:[-4,-2,0,2,4],tickfont:{...font,size:9},showbackground:false,showgrid:true,gridcolor:'#DDE5EF',zeroline:false,showline:false,ticks:'',showspikes:false});
export function buildTopLandscape(terrain,surfaceStyle,heightMode,colorMode='contrast'){
  const scientific=surfaceStyle==='science';
  const color= scienceColorMapping(terrain.raw,colorMode);
  return {type:'contour',x:terrain.x,y:terrain.y,z:scientific?color.values:terrain.raw.map(row=>row.map(v=>displayHeight(v))),...(scientific?{zmin:0,zmax:1}:{}),customdata:terrain.raw,colorscale:scientific?spectrum:contourColors,showscale:scientific,colorbar:{title:{text:'损失 L',font:{size:11,color:ink}},tickvals:color.tickvals,ticktext:color.ticktext,thickness:11,len:0.6,x:1.02,xpad:8,tickfont:{size:10,color:muted},outlinewidth:0},ncontours:22,contours:{coloring:'heatmap',showlabels:false},line:{width:scientific?0.45:0.7,color:scientific?'#FFFFFF40':'#B9CBDE'},hoverinfo:'skip',showlegend:false};
}
function topPathTrace(run,i,head=false,kind='line'){
  const trace=pathTrace(run,i,2,head,kind);
  if(style==='science'){
    trace.line={...trace.line,color:sciencePaths[i],width:head||kind==='samples'?3:3.5};
    trace.marker={...trace.marker,color:sciencePaths[i],line:{color:ink,width:1}};
  }
  return trace;
}
function topData(experiment){
  const {x,y}=experiment.config;
  return [
    buildTopLandscape(terrain,style,mode,colorMode),
    {type:'scatter',mode:'markers+text',name:'全局最小值',x:getMinima().map(p=>p.x),y:getMinima().map(p=>p.y),text:getMinima().map(p=>`${p.id} · L=0`),textposition:'top right',textfont:{color:style==='science'?'#fff':ink,size:12},marker:{symbol:'diamond',size:10,color:'#fff',line:{color:style==='science'?ink:'#426B95',width:2}},showlegend:false,hovertemplate:'<b>全局最小值 %{text}</b><br>w₁=%{x:.6f}<br>w₂=%{y:.6f}<extra></extra>'},
    {type:'scatter',mode:'markers+text',name:'共同起点',x:[x],y:[y],text:['起点'],textposition:'top left',textfont:{color:style==='science'?'#fff':ink},marker:{size:9,color:ink,line:{color:'#fff',width:1.5}},showlegend:false,hovertemplate:'共同起点<br>(%{x:.6f}, %{y:.6f})<extra></extra>'},
    ...runs.map((r,i)=>topPathTrace(r,i)),...runs.map((r,i)=>topPathTrace(r,i,true)),...runs.map((r,i)=>topPathTrace(r,i,false,'samples'))
  ];
}
function topLayout(){
  const axis={tickfont:{...font,size:11},gridcolor:'#E4EAF2',zeroline:false,showline:true,linecolor:'#CBD6E4',fixedrange:false,nticks:6};
  const right=style==='science'?75:25;
  const el=byId('surface'),w=Math.max(1,el.clientWidth-55-right),h=Math.max(1,el.clientHeight-103);
  const xd=w>h?[(1-h/w)/2,(1+h/w)/2]:[0,1],yd=h>w?[(1-w/h)/2,(1+w/h)/2]:[0,1];
  return {margin:{l:55,r:right,t:55,b:48},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'#FAFCFF',font,showlegend:false,uirevision:`top-${focus}-${radius}`,xaxis:{...axis,range:terrain.xRange,domain:xd,title:{text:'w₁',font:{...font,size:12}}},yaxis:{...axis,range:terrain.yRange,domain:yd,title:{text:'w₂',font:{...font,size:12}},scaleanchor:'x',scaleratio:1},dragmode:'pan',hovermode:'closest',hoverdistance:25,hoverlabel:{bgcolor:'#fff',font:{...font,color:ink,size:12}}};
}
const surfaceConfig=()=>config;
const motionData=()=>buildMotionOverlays(runs,step,terrain,{...display,mode,style,hidden},view==='top'?2:3);
function mainData(){
  const data=(view==='top'?topData(lastExperiment):surfaceData(lastExperiment)).map(trace=>({...trace,hovertemplate:null,hoverinfo:'none'}));
  data[1].visible=display.minima;
  return [...data,...motionData(),studyFrame()];
}
const mainLayout=()=>view==='top'?topLayout():surfaceLayout();
function surfaceLayout(){
  const axis=(title,range)=>({...xyAxis(title),range,tickvals:focus==='all'?[-4,-2,0,2,4]:undefined,nticks:5,tickformat:focus==='all'?undefined:'.3f',showbackground:false,gridcolor:'#D9DFE8'});
  const minima=display.minima?getMinima().filter(inside):[];
  const narrow=byId('surface').clientWidth<600;
  return {margin:{l:5,r:style==='science'?60:5,t:0,b:0},paper_bgcolor:'rgba(0,0,0,0)',font,showlegend:false,uirevision:`atlas-${focus}-${radius}-${mode}`,scene:{bgcolor:'rgba(0,0,0,0)',xaxis:axis('w₁',terrain.xRange),yaxis:axis('w₂',terrain.yRange),zaxis:{...axis(mode==='log'?(getObjective().kind==='custom'?'signed log(1+|L|)':'log(1 + L)'):'L',terrain.zRange),tickvals:undefined,tickformat:focus==='all'?undefined:'.3g'},aspectmode:'manual',aspectratio:{x:1,y:1,z:0.65},camera:camera3d,dragmode:dragMode,annotations:minima.map((p,i)=>({x:p.x,y:p.y,z:lift(),text:focus==='all'?`${p.id} · L = 0`:`谷底 ${p.id} · 全局最小值<br>(${p.x.toFixed(4)}, ${p.y.toFixed(4)})<br>L = 0`,showarrow:true,arrowhead:0,arrowcolor:'#8A9DB7',ax:focus==='all'?[30,-45,40,-35][i]*(narrow?0.6:1):narrow?0:-100,ay:focus==='all'?[-35,30,30,-35][i]:narrow?65:40,bgcolor:'#FFFFFFEB',bordercolor:'#D9E2EE',borderpad:5,font:{size:focus==='all'||narrow?10:12,color:ink}}))},hoverlabel:{bgcolor:'#fff',font:{...font,color:ink,size:12},bordercolor:'#D6DFEB'}};
}
function miniHeadTrace(run,i){const trace=pathTrace(run,i,2,true);trace.visible=shown(run.name);trace.marker.size=display.balls?10:7;return trace;}
function contourData(experiment){
  const {x,y}=experiment.config;
  return [
    {type:'contour',x:grid,y:grid,z:logarithmic,colorscale:contourColors,showscale:false,ncontours:18,contours:{coloring:'heatmap',showlabels:false},line:{width:0.6,color:'#C4D4E4'},hovertemplate:'w₁ = %{x:.2f}<br>w₂ = %{y:.2f}<extra>点击设置起点</extra>',showlegend:false},
    {type:'scatter',mode:'markers+text',x:getMinima().map(p=>p.x),y:getMinima().map(p=>p.y),text:getMinima().map(p=>p.id),textposition:'bottom right',textfont:{color:'#6F91AF',size:10},name:'全局谷底',marker:{symbol:'diamond',size:7,color:'#6F91AF',line:{color:'#fff',width:1}},showlegend:false,visible:display.minima,hovertemplate:'谷底 %{text}<br>(%{x:.3f}, %{y:.3f})<extra></extra>'},
    {type:'scatter',mode:'markers',x:[x],y:[y],name:'共同起点',marker:{size:7,color:ink,line:{color:'#fff',width:1.5}},showlegend:false,hovertemplate:'共同起点 (%{x:.2f}, %{y:.2f})<extra></extra>'},
    ...runs.map((r,i)=>pathTrace(r,i,2)),...runs.map((r,i)=>miniHeadTrace(r,i))
  ];
}
const axis2d={tickfont:{...font,size:9},gridcolor:'#EBEFF5',zeroline:false,ticks:'',showline:false,fixedrange:true};
function contourLayout(){return {margin:{l:39,r:19,t:10,b:34},font,paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'#FAFCFE',xaxis:{...axis2d,range:[-5,5],title:{text:'w₁',font},tickvals:[-4,-2,0,2,4]},yaxis:{...axis2d,range:[-5,5],title:{text:'w₂',font},tickvals:[-4,-2,0,2,4],scaleanchor:'x',scaleratio:1,constrain:'domain'},showlegend:false,dragmode:false,hovermode:'closest',hoverlabel:{font:{...font,color:ink},bgcolor:'#fff',bordercolor:'#D6DFEB'}};}
function lossData(){return runs.map((r,i)=>({type:'scatter',mode:'lines',name:r.name,x:r.points.map(p=>p.t),y:r.points.map(p=>getObjective().kind==='custom'?p.loss:Math.max(1e-16,p.loss)),customdata:r.points.map(p=>p.loss),line:{color:METHODS[i].color,width:2.2},visible:shown(r.name),showlegend:false,hovertemplate:'<b>%{fullData.name}</b><br>t = %{x}<br>L = %{customdata:.4g}<extra></extra>'}));}
function cursorShape(){return {type:'line',xref:'x',yref:'paper',x0:step,x1:step,y0:0,y1:1,line:{color:'#718CAA',width:1,dash:'dot'}};}
function lossLayout(experiment){
  if(experiment.function?.kind==='custom')return {margin:{l:58,r:22,t:19,b:34},font,paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'#fff',xaxis:{...axis2d,range:[0,experiment.config.iterations],title:{text:'更新次数 t',font}},yaxis:{...axis2d,type:'linear',autorange:true,title:{text:'真实函数值 L',font}},hovermode:'x unified',showlegend:false,shapes:[cursorShape()]};
  const maxima=Math.max(1,...runs.flatMap(r=>r.points.map(p=>p.loss)));
  return {margin:{l:53,r:22,t:19,b:34},font,paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'#fff',xaxis:{...axis2d,range:[0,experiment.config.iterations],title:{text:'更新次数 t',font},nticks:6},yaxis:{...axis2d,type:'log',range:[-16,Math.ceil(Math.log10(maxima))+0.3],title:{text:'真实损失 L',font},tickvals:[1e-16,1e-12,1e-8,1e-4,1,1e4,1e8,1e12],ticktext:['10⁻¹⁶','10⁻¹²','10⁻⁸','10⁻⁴','1','10⁴','10⁸','10¹²']},hovermode:'x unified',showlegend:false,shapes:[cursorShape(),{type:'line',xref:'paper',yref:'y',x0:0,x1:1,y0:1e-6,y1:1e-6,line:{color:'#C6D4E3',width:1,dash:'dash'}}],annotations:[{xref:'paper',yref:'y',x:1,y:1e-6,text:'L = 10⁻⁶',showarrow:false,xanchor:'right',yanchor:'bottom',font:{...font,size:8},bgcolor:'#fff'}],hoverlabel:{font:{...font,color:ink},bgcolor:'#fff',bordercolor:'#D6DFEB'}};
}

export async function renderPlots(experiment,options={}) {
  lastExperiment=experiment;view=options.viewMode??view;
  raw=grid.map(y=>grid.map(x=>loss(x,y)));logarithmic=raw.map(row=>row.map(v=>displayHeight(v)));
  colorMode=options.colorMode??colorMode;dragMode=options.dragMode??dragMode;
  mode=options.heightMode??mode;style=options.surfaceStyle??style;radius=options.radius??radius;samples=options.samples??samples;
  display={...display,...options.display};
  if(options.studyTarget&&options.studyTarget!==studyTarget)studySide=options.studyTarget==='A'?-1:1;
  studyTarget=options.studyTarget??studyTarget;studyRadius=options.studyRadius??studyRadius;
  byId('scene-view').classList.toggle('has-study',studyTarget!=='hover');
  requestedFocus=options.focus??requestedFocus;
  const region=resolveRegion(experiment.runs.filter(r=>shown(r.name)),requestedFocus,radius);focus=region.focus;
  terrain=buildTerrain(focus,radius,mode);runs=experiment.runs;projectedRuns=runs.map(r=>projectPath(r.points));step=options.step??experiment.config.iterations;
  const fn=first?'newPlot':'react';
  await Promise.all([
    Plotly[fn](byId('surface'),mainData(),mainLayout(),surfaceConfig()),
    Plotly[fn](byId('contour'),contourData(experiment),contourLayout(),miniConfig),
    Plotly[fn](byId('loss-chart'),lossData(),lossLayout(experiment),miniConfig)
  ]);
  first=false;
  updateOverview();
  bindHoverInspection();
  await refreshStudy();
}
export async function updateStep(t){
  preserveCamera(byId('surface'));
  step=t;
  updateOverview();
  const traces=runs.flatMap((r,i)=>[pathTrace(r,i,view==='top'?2:3),pathTrace(r,i,view==='top'?2:3,true),pathTrace(r,i,view==='top'?2:3,false,'samples')]);
  const indices=runs.flatMap((r,i)=>[3+i,7+i,11+i]);
  const mapTraces=runs.flatMap((r,i)=>[pathTrace(r,i,2),miniHeadTrace(r,i)]);
  const overlays=motionData(),overlayIndices=overlays.map((_,i)=>15+i);
  const animated=[...traces,...overlays],allIndices=[...indices,...overlayIndices];
  if(studyTarget==='head'){animated.push(studyFrame());allIndices.push(27);}
  const keys=['x','y','customdata','text','visible',...(view==='3d'?['z','u','v','w']:[])];
  const data=Object.fromEntries(keys.map(key=>[key,animated.map(trace=>trace[key])]));
  if(view==='top')data['marker.angle']=animated.map(trace=>trace.marker?.angle);
  await Promise.all([
    Plotly.restyle(byId('surface'),data,allIndices),
    Plotly.restyle(byId('contour'),{x:mapTraces.map(p=>p.x),y:mapTraces.map(p=>p.y),customdata:mapTraces.map(p=>p.customdata),text:mapTraces.map(p=>p.text),visible:mapTraces.map(p=>p.visible)},runs.flatMap((r,i)=>[3+i,7+i])),
    Plotly.relayout(byId('loss-chart'),{'shapes[0].x0':t,'shapes[0].x1':t})
  ]);
  await refreshStudy();
}
export async function setVisibility(name,visible){
  if(visible) hidden.delete(name);else hidden.add(name);
  const i=METHODS.findIndex(m=>m.name===name);
  await Promise.all([
    Plotly.restyle(byId('surface'),{visible:[visible,visible,visible&&samples]},[3+i,7+i,11+i]),
    Plotly.restyle(byId('contour'),{visible},[3+i,7+i]),
    Plotly.restyle(byId('loss-chart'),{visible},[i])
  ]);
}
export function setActiveMethods(names){hidden=new Set(METHODS.filter(m=>!names.includes(m.name)).map(m=>m.name));}
function updateOverview(){
  const el=byId('trajectory-overview');if(!el)return;
  el.hidden=requestedFocus==='all';if(el.hidden)return;
  const px=x=>80+x*11.5,py=y=>73-y*11.5;
  const paths=display.trails?runs.filter(r=>shown(r.name)).map(r=>`<polyline points="${r.points.filter(p=>p.t<=step).map(p=>`${px(p.x)},${py(p.y)}`).join(' ')}" fill="none" stroke="${METHODS.find(m=>m.name===r.name).color}" stroke-width="1.8"/>`).join(''):'';
  const minima=display.minima?getMinima().map(p=>`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="2" fill="#718CAA"/><text x="${px(p.x)+4}" y="${py(p.y)-4}" fill="#718CAA" font-size="9">${p.id}</text>`).join(''):'';
  const p=getMinima().find(m=>m.id===requestedFocus);
  el.innerHTML=`<span>全程轨迹 <small>t ≤ ${step}</small></span><svg viewBox="0 0 160 140" aria-label="所选优化器的完整轨迹总览"><defs><clipPath id="overview-clip"><rect x="20" y="13" width="120" height="120"/></clipPath></defs><rect x="20" y="13" width="120" height="120" rx="3" fill="#F2F6FB"/><g clip-path="url(#overview-clip)">${paths}${minima}${p?`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="${Math.max(5,radius*11.5)}" fill="none" stroke="#18243B" stroke-width="1" stroke-dasharray="3 2"/>`:''}</g></svg>`;
}
export function setCamera(target){
  return Plotly.relayout(byId('surface'),target==='top'?{'xaxis.range':terrain.xRange,'yaxis.range':terrain.yRange}:{'scene.camera':camera3d});
}
export function setInteractionMode(target){
  dragMode=target;
  return Plotly.relayout(byId('surface'),view==='top'?{dragmode:'pan'}:{'scene.dragmode':target});
}
export function setInspectionInteraction(active){
  if(!active){preserveCamera(byId('surface'));preserveCamera(byId('hover-inspector')?.querySelector?.('[data-inspect-scene]'));}
  inspectionInteracting=active;
  if(active&&studyTarget==='hover')hideInspection();
}
export function zoomCamera(factor){
  preserveCamera(byId('surface'));
  if(view==='top'){
    const el=byId('surface'),scale=range=>{const mid=(range[0]+range[1])/2,half=(range[1]-range[0])*factor/2;return [mid-half,mid+half];};
    return Plotly.relayout(el,{'xaxis.range':scale(el.layout.xaxis.range),'yaxis.range':scale(el.layout.yaxis.range)});
  }
  const el=byId('surface'),camera=el.layout.scene.camera??camera3d;
  const eye=camera.eye??camera3d.eye,magnitude=Math.hypot(eye.x,eye.y,eye.z);
  const scale=Math.max(0.25,Math.min(5,magnitude*factor))/magnitude;
  return Plotly.relayout(el,{'scene.camera':{...camera,eye:{x:eye.x*scale,y:eye.y*scale,z:eye.z*scale}}});
}
export async function resizeSurface(){
  const el=byId('surface');if(!el.layout)return;
  await Plotly.Plots.resize(el);
  if(view!=='top')return Plotly.relayout(el,{'scene.annotations':surfaceLayout().scene.annotations});
  const layout=topLayout();return Plotly.relayout(el,{'xaxis.domain':layout.xaxis.domain,'yaxis.domain':layout.yaxis.domain});
}
export function showInspection(x,y,label){
  if(studyTarget!=='hover'||inspectionInteracting)return;
  if(view==='top'){
    const el=byId('surface'),xa=el._fullLayout?.xaxis;
    if(xa)byId('hover-inspector').classList.toggle('on-left',xa._offset>el.clientWidth-xa._offset-xa._length);
  }
  hoverPoint={x,y,label};if(hoverFrame)return;
  hoverFrame=requestAnimationFrame(()=>{
    hoverFrame=0;const p=hoverPoint;if(p)drawInspection(p.x,p.y,p.label);
  });
}
export function hideInspection(){hoverPoint=null;cancelInspection();byId('hover-inspector').hidden=true;}
function studyCenter(){
  if(studyTarget==='head'){
    const run=runs.find(r=>shown(r.name)),p=run?.points.findLast(p=>p.t<=step);
    return p?{...p,label:`${run.name} · 第 ${p.t} 步`}:null;
  }
  const p=getMinima().find(p=>p.id===studyTarget);
  return p?{...p,label:`谷底 ${p.id} 附近的路径`}:hoverPoint;
}
function studyFrame(){
  const p=studyTarget==='hover'?null:studyCenter(),x=[],y=[],z=[];
  if(p){
    const r=studyRadius,corners=[[p.x-r,p.y-r],[p.x+r,p.y-r],[p.x+r,p.y+r],[p.x-r,p.y+r],[p.x-r,p.y-r]];
    for(let j=0;j<4;j++)for(let k=0;k<=20;k++){
      const u=k/20,a=corners[j],b=corners[j+1],px=a[0]+(b[0]-a[0])*u,py=a[1]+(b[1]-a[1])*u;
      x.push(px);y.push(py);z.push(height(loss(px,py),mode)+lift()*5);
    }
  }
  const trace={type:view==='top'?'scatter':'scatter3d',mode:'lines',name:'侧视片段范围',x,y,line:{color:style==='science'?'#FFFFFF':'#355D83',width:3,dash:'dash'},hoverinfo:'skip',showlegend:false,visible:!!p};
  if(view==='3d')trace.z=z;return trace;
}
function drawInspection(x,y,label){
  const card=byId('hover-inspector');card.classList.toggle('is-pinned',studyTarget!=='hover');
  if(inspectionInteracting)return;
  fillInspection(card,x,y,runs.filter(r=>shown(r.name)),step,label,studyRadius,mode,style,{...display,side:studySide,colorMode}).catch(error=>{console.error(error);hideInspection();});
}
function refreshStudy(updateFrame=false){
  if(studyTarget==='hover')return;
  const p=studyCenter();if(!p)return;
  drawInspection(p.x,p.y,p.label);
  if(updateFrame&&studyTarget==='head'){
    const trace=studyFrame();return Plotly.restyle(byId('surface'),{x:[trace.x],y:[trace.y],...(view==='3d'?{z:[trace.z]}:{})},[27]);
  }
}
export function turnInspection(side){studySide=side;const p=studyCenter();if(p)drawInspection(p.x,p.y,p.label);}
function bindHoverInspection(){
  if(hoverBound)return;hoverBound=true;
  const el=byId('surface');
  el.on('plotly_hover',event=>{
    const p=event.points?.[0];if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))showInspection(p.x,p.y,p.data?.name&&p.data.name!=='全局最小值'?`${p.data.name}${p.text!==undefined?` · t=${p.text}`:''}`:'悬浮细看');
  });
  el.addEventListener('pointermove',e=>{
    byId('hover-inspector').classList.toggle('on-left',e.clientX>el.getBoundingClientRect().left+el.clientWidth*0.6);
    if(view!=='top'||studyTarget!=='hover')return;
    const l=el._fullLayout;if(!l?.xaxis)return;
    const r=el.getBoundingClientRect(),xa=l.xaxis,ya=l.yaxis,px=e.clientX-r.left-xa._offset,py=e.clientY-r.top-ya._offset;
    if(px<0||py<0||px>xa._length||py>ya._length){hideInspection();return;}
    showInspection(xa.p2d(px),ya.p2d(py));
  });
  el.addEventListener('pointerleave',()=>{if(studyTarget==='hover')hideInspection();});
}
export function bindMapSelection(callback){
  // Use pointer geometry so every point of the map is selectable, including flat contour interiors.
  const el=byId('contour');
  // Plotly consumes pointerup on its drag layer. Capture click before that layer handles it.
  el.addEventListener('click',e=>{
    const layout=el._fullLayout;if(!layout) return;
    const rect=el.getBoundingClientRect(),xa=layout.xaxis,ya=layout.yaxis;
    const px=e.clientX-rect.left-xa._offset,py=e.clientY-rect.top-ya._offset;
    if(px<0||py<0||px>xa._length||py>ya._length) return;
    const x=xa.p2d(px),y=ya.p2d(py);
    if(Number.isFinite(x)&&Number.isFinite(y)) callback(Math.max(-5,Math.min(5,x)),Math.max(-5,Math.min(5,y)));
  },true);
}
