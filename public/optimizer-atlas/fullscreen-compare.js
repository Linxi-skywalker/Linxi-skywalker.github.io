import {displayHeight,getMinima,getObjective,METHODS,simulate} from './engine.js';
import {buildTerrain,clipPath,projectPath,refineDisplayPath} from './terrain.js';

const ink='#18243B',muted='#8694A8',font={family:'Segoe UI, Microsoft YaHei, sans-serif',size:10,color:muted};
const mist=[[0,'#F1F6FB'],[0.22,'#DCE9F3'],[0.45,'#BBD3E6'],[0.67,'#A8C7DD'],[0.85,'#99B4D0'],[1,'#879EBD']];
const palette=[[0,'#FBFCFE'],[0.25,'#EDF3F9'],[0.5,'#DCE7F2'],[0.75,'#CADBEA'],[1,'#B8CADE']];
const camera={eye:{x:-1.08,y:1.28,z:1.18},center:{x:0,y:0,z:-0.08},up:{x:0,y:0,z:1},projection:{type:'perspective'}};
const defaultValue={x:-4,y:4,lr:0.01,iterations:200,momentum:0.9,beta1:0.9,beta2:0.999,alpha:0.99,epsilon:1e-8};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');

function cardMarkup(side,method,c){
  const methods=METHODS.map(m=>`<option value="${m.name}" ${m.name===method?'selected':''}>${m.name}</option>`).join('');
  return `<article class="compare-card" data-compare-side="${side}" style="--method-color:${METHODS.find(m=>m.name===method).color}">
    <header class="compare-card-heading"><div><span>${side==='left'?'LEFT LANDSCAPE':'RIGHT LANDSCAPE'}</span><h3 data-compare-title>${method}</h3></div><select data-key="method" aria-label="${side==='left'?'左图':'右图'}优化器">${methods}</select></header>
    <div class="compare-controls">
      <label>学习率 η<input data-key="lr" type="number" min="0.0001" max="0.1" step="any" value="${c.lr}"></label>
      <label>起点 w₁<input data-key="x" type="number" min="-5" max="5" step="0.1" value="${c.x}"></label>
      <label>起点 w₂<input data-key="y" type="number" min="-5" max="5" step="0.1" value="${c.y}"></label>
      <label>更新步数<input data-key="iterations" type="number" min="1" max="1000" step="1" value="${c.iterations}"></label>
    </div>
    <details class="compare-advanced"><summary>优化器超参数 <small data-param-summary></small></summary><div class="compare-hyperparams">
      <label data-param="momentum">动量 μ<input data-key="momentum" type="number" min="0" max="0.99" step="0.01" value="${c.momentum}"></label>
      <label data-param="beta1">Adam β₁<input data-key="beta1" type="number" min="0" max="0.99" step="0.01" value="${c.beta1}"></label>
      <label data-param="beta2">Adam β₂<input data-key="beta2" type="number" min="0.9" max="0.9999" step="0.0001" value="${c.beta2}"></label>
      <label data-param="alpha">RMSprop α<input data-key="alpha" type="number" min="0.8" max="0.999" step="0.001" value="${c.alpha}"></label>
    </div></details>
    <div class="compare-chart" role="img" aria-label="${side==='left'?'左图':'右图'}优化器轨迹"></div>
    <p class="compare-result" aria-live="polite">正在计算路径…</p>
  </article>`;
}

function readConfig(card){
  const c={};
  for(const input of card.querySelectorAll('[data-key]')){
    const key=input.dataset.key;
    if(key==='method'){c.method=input.value;continue;}
    c[key]=Number(input.value);
  }
  return c;
}
function syncParamLabels(card,method){
  card.style.setProperty('--method-color',METHODS.find(m=>m.name===method).color);
  card.querySelector('[data-compare-title]').textContent=method;
  for(const label of card.querySelectorAll('[data-param]'))label.hidden=label.dataset.param!==({Momentum:'momentum',Adam:'beta1',RMSprop:'alpha'}[method]||'');
  if(method==='Adam')card.querySelector('[data-param="beta2"]').hidden=false;
  card.querySelector('[data-param-summary]').textContent=method==='Momentum'?'μ':method==='Adam'?'β₁ · β₂':method==='RMSprop'?'α':'无需额外参数';
}
function chartData(run,method,view,terrain){
  const color=METHODS.find(m=>m.name===method).color;
  const path=refineDisplayPath(clipPath(projectPath(run.points),terrain.xRange,terrain.yRange),(terrain.xRange[1]-terrain.xRange[0])/160);
  const minima=getMinima();
  if(view==='top'){
    return [
      {type:'contour',x:terrain.x,y:terrain.y,z:terrain.raw.map(row=>row.map(v=>displayHeight(v))),colorscale:palette,showscale:false,ncontours:22,contours:{coloring:'heatmap',showlabels:false},line:{width:0.55,color:'#B9CBDE'},hoverinfo:'skip'},
      ...(minima.length?[{type:'scatter',mode:'markers+text',name:'全局最小值',x:minima.map(p=>p.x),y:minima.map(p=>p.y),text:minima.map(p=>p.id),textposition:'top right',textfont:{color:ink,size:11},marker:{symbol:'diamond',size:9,color:'#fff',line:{color:'#426B95',width:2}},hovertemplate:'谷底 %{text}<br>(%{x:.4f}, %{y:.4f})<extra></extra>'}]:[]),
      {type:'scatter',mode:'lines',name:method,x:path.map(p=>p?.x??null),y:path.map(p=>p?.y??null),connectgaps:false,line:{color,width:3},hovertemplate:`<b>${method}</b><br>w₁=%{x:.5f}<br>w₂=%{y:.5f}<extra></extra>`},
      {type:'scatter',mode:'markers',name:'当前位置',x:[run.points.at(-1).x],y:[run.points.at(-1).y],marker:{size:9,color,line:{color:'#fff',width:2}},hovertemplate:'当前位置<br>(%{x:.5f}, %{y:.5f})<extra></extra>'}
    ];
  }
  return [
    {type:'surface',x:terrain.x,y:terrain.y,z:terrain.z,customdata:terrain.raw,colorscale:mist,showscale:false,hovertemplate:'w₁=%{x:.4f}<br>w₂=%{y:.4f}<br>L=%{customdata:.5g}<extra></extra>',contours:{z:{show:true,color:'#AFC5D9',width:1,highlight:false}},lighting:{ambient:0.95,diffuse:0.7,roughness:0.8,specular:0.15}},
    ...(minima.length?[{type:'scatter3d',mode:'markers+text',name:'全局最小值',x:minima.map(p=>p.x),y:minima.map(p=>p.y),z:minima.map(()=>terrain.lift),text:minima.map(p=>p.id),textposition:'top center',textfont:{color:ink,size:10},marker:{symbol:'diamond',size:5,color:'#fff',line:{color:'#426B95',width:2}},hovertemplate:'谷底 %{text}<br>(%{x:.4f}, %{y:.4f})<extra></extra>'}]:[]),
    {type:'scatter3d',mode:'lines',name:method,x:path.map(p=>p?.x??null),y:path.map(p=>p?.y??null),z:path.map(p=>p?displayHeight(p.loss)+terrain.lift*4:null),connectgaps:false,line:{color,width:7},hovertemplate:`<b>${method}</b><br>t=%{text}<br>w₁=%{x:.5f}<br>w₂=%{y:.5f}<br>L=%{customdata:.5g}<extra></extra>`,text:path.map(p=>p?.t??null),customdata:path.map(p=>p?.loss??null)},
    {type:'scatter3d',mode:'markers',name:'当前位置',x:[run.points.at(-1).x],y:[run.points.at(-1).y],z:[displayHeight(run.points.at(-1).loss)+terrain.lift*4],marker:{size:5,color,line:{color:'#fff',width:2}},hovertemplate:'当前位置<br>(%{x:.5f}, %{y:.5f})<extra></extra>'}
  ];
}
function layoutFor(view,iterations){
  const axis={tickfont:{...font,size:9},gridcolor:'#DDE5EF',zeroline:false};
  if(view==='top')return {margin:{l:42,r:18,t:8,b:38},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'#FAFCFE',font,xaxis:{...axis,range:[-5,5],title:{text:'w₁',font},tickvals:[-4,-2,0,2,4]},yaxis:{...axis,range:[-5,5],title:{text:'w₂',font},tickvals:[-4,-2,0,2,4],scaleanchor:'x',scaleratio:1},showlegend:false,hovermode:'closest'};
  return {margin:{l:0,r:0,t:5,b:0},paper_bgcolor:'rgba(0,0,0,0)',font,showlegend:false,uirevision:'fullscreen-compare',scene:{bgcolor:'rgba(0,0,0,0)',xaxis:{...axis,title:{text:'w₁',font},range:[-5,5]},yaxis:{...axis,title:{text:'w₂',font},range:[-5,5]},zaxis:{...axis,title:{text:'高度',font}},aspectmode:'manual',aspectratio:{x:1,y:1,z:0.58},camera,dragmode:'orbit'},hoverlabel:{bgcolor:'#fff',font:{...font,color:ink}}};
}
function statusText(run,method){
  const p=run.points.at(-1),s=run.points.length-1;
  return `${method} · ${s} 步${run.diverged?' · 数值发散':''}　位置 (${p.x.toFixed(3)}, ${p.y.toFixed(3)})　L = ${p.loss.toExponential(2)}`;
}
async function renderCard(card,view){
  const c=readConfig(card),chart=card.querySelector('.compare-chart'),result=card.querySelector('.compare-result');
  try{
    syncParamLabels(card,c.method);
    const run=simulate(c.method,{...defaultValue,...c});
    const terrain=buildTerrain('all',0.6,'log');
    const traces=chartData(run,c.method,view,terrain);
    const layout=layoutFor(view,c.iterations);
    if(chart.data)await Plotly.react(chart,traces,layout,{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:true});
    else await Plotly.newPlot(chart,traces,layout,{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:true});
    result.textContent=statusText(run,c.method);result.dataset.error='false';
  }catch(error){result.textContent=error.message;result.dataset.error='true';}
}
export function createFullscreenCompare(root,config,view='3d'){
  let currentView=view;
  root.innerHTML=cardMarkup('left','SGD',config)+cardMarkup('right','Adam',config);
  const cards=[...root.querySelectorAll('[data-compare-side]')];
  for(const card of cards){
    syncParamLabels(card,readConfig(card).method);
    card.addEventListener('change',()=>renderCard(card,currentView));
    renderCard(card,view);
  }
  return {
    resize:()=>cards.forEach(card=>Plotly.Plots.resize(card.querySelector('.compare-chart'))),
    setView:nextView=>{currentView=nextView;cards.forEach(card=>renderCard(card,currentView));}
  };
}
