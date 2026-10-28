import {loss,gradient,getMinima,getObjective,METHODS,displayHeight} from './engine.js';
import {preserveCamera} from './camera.js';
import {projectPath,clipPath,refineDisplayPath} from './terrain.js';
import {spectrum,sciencePaths,scienceColorMapping} from './palette.js';
import {buildMotionOverlays} from './motion.js';

function crossesBox(a,b,x,y,r){
  let lo=0,hi=1;
  for(const [start,delta,min,max] of [[a.x,b.x-a.x,x-r,x+r],[a.y,b.y-a.y,y-r,y+r]]){
    if(Math.abs(delta)<1e-15){if(start<min||start>max)return false;continue;}
    const u=(min-start)/delta,v=(max-start)/delta;
    lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));
    if(lo>hi)return false;
  }
  return true;
}
export function resolveRegion(runs,requested='all',radius=0.6){
  const minimum=getMinima().find(p=>p.id===requested);
  if(!minimum)return {focus:'all',requested:'all',empty:false,methods:runs.map(r=>r.name)};
  const methods=runs.filter(r=>r.points.some((p,i)=>crossesBox(p,r.points[Math.max(0,i-1)],minimum.x,minimum.y,radius))).map(r=>r.name);
  return {focus:methods.length?requested:'all',requested,empty:methods.length===0,methods};
}
export function describePoint(x,y,runs,step,radius=0.2){
  const [gx,gy]=gradient(x,y);
  const nearest=getMinima().reduce((a,b)=>!a||Math.hypot(x-b.x,y-b.y)<Math.hypot(x-a.x,y-a.y)?b:a,null);
  const nearby=runs.flatMap((run,i)=>{
    const candidates=run.points.filter(p=>p.t<=step&&Math.abs(p.x-x)<=radius&&Math.abs(p.y-y)<=radius);
    if(!candidates.length)return [];
    const p=candidates.reduce((a,b)=>Math.hypot(a.x-x,a.y-y)<Math.hypot(b.x-x,b.y-y)?a:b);
    return [{name:run.name,color:METHODS.find(m=>m.name===run.name).color,...p}];
  });
  return {x,y,loss:loss(x,y),gradNorm:Math.hypot(gx,gy),nearest,nearby};
}

export function buildInspectionScene(x,y,runs,step,radius=0.6,mode='log',style='mist',options={}){
  const xr=[x-radius,x+radius],yr=[y-radius,y+radius];
  const grid=r=>Array.from({length:49},(_,i)=>r[0]+(r[1]-r[0])*i/48);
  const xs=grid(xr),ys=grid(yr),raw=ys.map(b=>xs.map(a=>loss(a,b)));
  const z=raw.map(row=>row.map(v=>displayHeight(v,mode)));
  const min=Math.min(...z.map(row=>Math.min(...row))),max=Math.max(...z.map(row=>Math.max(...row)));
  const span=Math.max(1e-9,max-min),zRange=[min<0?min-span*0.08:Math.max(0,min-span*0.08),max+span*0.13],zMax=zRange[1],lift=span*0.012;
  const h=l=>displayHeight(l,mode);
  const color=scienceColorMapping(raw,options.colorMode??'contrast');
  const data=[{type:'surface',x:xs,y:ys,z,customdata:raw,...(style==='science'?{surfacecolor:color.values,cmin:0,cmax:1}:{}),showscale:false,colorscale:style==='science'?spectrum:[[0,'#EDF6FB'],[0.45,'#AFCDE0'],[1,'#6F97BA']],opacity:0.86,hoverinfo:'skip',contours:{z:{show:true,start:min,end:max,size:span/9,color:style==='science'?'#FFFFFF55':'#B0C9DB',highlight:false}},lighting:{ambient:0.9,diffuse:0.6,roughness:1}}];
  const methods=[];
  for(const run of runs){
    const points=run.points.filter(p=>p.t<=step),clipped=refineDisplayPath(clipPath(projectPath(points),xr,yr),radius/60);
    if(!clipped.some(Boolean))continue;
    methods.push(run.name);
    const i=METHODS.findIndex(m=>m.name===run.name),color=style==='science'?sciencePaths[i]:METHODS[i].color;
    data.push({type:'scatter3d',mode:'lines',name:run.name,x:clipped.map(p=>p?.x??null),y:clipped.map(p=>p?.y??null),z:clipped.map(p=>p?h(p.loss)+lift:null),line:{color,width:6},hoverinfo:'skip',showlegend:false,connectgaps:false,visible:options.trails!==false});
  }
  const minima=options.minima===false?[]:getMinima().filter(p=>p.x>=xr[0]&&p.x<=xr[1]&&p.y>=yr[0]&&p.y<=yr[1]);
  if(options.balls||options.arrows)data.push(...buildMotionOverlays(runs,step,{xRange:xr,yRange:yr,zRange,zMax},{...options,mode,style,aspectZ:0.85}));
  if(options.balls===false)for(const run of runs){
    const p=run.points.findLast(p=>p.t<=step);if(!p||p.x<xr[0]||p.x>xr[1]||p.y<yr[0]||p.y>yr[1])continue;
    const i=METHODS.findIndex(m=>m.name===run.name),color=style==='science'?sciencePaths[i]:METHODS[i].color;
    data.push({type:'scatter3d',mode:'markers',name:run.name,x:[p.x],y:[p.y],z:[h(p.loss)+lift],marker:{size:5,color,line:{color:'#fff',width:1}},showlegend:false,hoverinfo:'skip'});
  }
  const axis=(title,range)=>({title:{text:title,font:{size:10}},range,nticks:3,tickformat:'.2f',tickfont:{size:8,color:'#73849B'},showbackground:false,gridcolor:'#E4ECF4',showspikes:false,zeroline:false});
  const side=options.side===-1?-1:1;
  return {data,methods,xRange:xr,yRange:yr,layout:{uirevision:`local-${mode}-${radius}-${side}`,margin:{l:4,r:4,t:2,b:4},paper_bgcolor:'rgba(0,0,0,0)',font:{family:'Segoe UI, Microsoft YaHei',color:'#18243B'},showlegend:false,scene:{xaxis:axis('w₁',xr),yaxis:axis('w₂',yr),zaxis:axis(mode==='log'?'log(1+L)':'L',zRange),aspectmode:'manual',aspectratio:{x:1,y:1,z:0.85},camera:{eye:{x:1.4*side,y:-1.6*side,z:0.85},center:{x:0,y:0,z:-0.02},up:{x:0,y:0,z:1},projection:{type:'perspective'}},annotations:minima.map(p=>({x:p.x,y:p.y,z:lift,text:`${p.id} · 全局最小值<br>L = 0`,showarrow:true,ax:20,ay:25,arrowcolor:'#718CAA',bgcolor:'#FFFFFFE8',font:{size:10,color:'#18243B'}}))}}};
}

let pendingPreview=null,previewBusy=false;
export async function fillInspection(card,x,y,runs,step,label='局部立体放大',radius=0.6,mode='log',style='mist',options={}){
  pendingPreview={card,x,y,runs,step,label,radius,mode,style,options};
  if(previewBusy)return;
  previewBusy=true;
  try{
    while(pendingPreview){
      const p=pendingPreview;pendingPreview=null;
      const scene=buildInspectionScene(p.x,p.y,p.runs,p.step,p.radius,p.mode,p.style,p.options),el=p.card.querySelector('[data-inspect-scene]');
      p.card.hidden=false;
      p.card.querySelector('[data-inspect-title]').textContent=p.label&&p.label!=='局部立体放大'?`${p.label} · 侧面透视`:'路径片段 · 侧面透视';
      p.card.querySelector('[data-inspect-radius]').textContent=`半径 ${p.radius.toFixed(2)}`;
      p.card.querySelector('[data-inspect-coordinates]').textContent=`w₁: ${scene.xRange.map(v=>v.toFixed(3)).join(' ~ ')} · w₂: ${scene.yRange.map(v=>v.toFixed(3)).join(' ~ ')}`;
      p.card.querySelector('[data-inspect-paths]').textContent=scene.methods.length?`此局部路径：${scene.methods.join(' · ')} · t ≤ ${p.step}`:'此局部暂无路径经过；主图保留完整轨迹。';
      preserveCamera(el);
      await Plotly.react(el,scene.data,{...scene.layout,width:el.clientWidth,height:el.clientHeight},{displayModeBar:false,staticPlot:false,responsive:false,scrollZoom:true});
    }
  }finally{previewBusy=false;}
}
export function cancelInspection(){pendingPreview=null;}
