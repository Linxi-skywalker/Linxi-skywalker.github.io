import {DEFAULTS,METHODS,MINIMA,CRITERIA,runExperiment,summarize,getMinima,getObjective,setObjective,validateConfig,HIMMELBLAU_EXPRESSION} from './engine.js';
import {renderPlots,updateStep,setCamera,setVisibility,setActiveMethods,bindMapSelection,zoomCamera,resizeSurface,showInspection,hideInspection,turnInspection,setInteractionMode,setInspectionInteraction} from './plots.js';
import {resolveRegion} from './inspection.js';

const $=id=>document.getElementById(id);
let experiment=runExperiment(),current=200,playing=false,frame=0,playOrigin=0,originStep=0,lastDraw=0,busy=false,rendering=false;
let desiredStep=null,pendingRefresh=null,toastTimer,debounceTimer,playVersion=0,playbackRate=35;
let drawCompletion=Promise.resolve();
const viewGestures=new Set();
let viewHoldStart=null,dragMode='orbit';
const visible=new Set(METHODS.map(m=>m.name));
let surfaceStyle='mist';
const fmt=n=>n===0?'0':Math.abs(n)<0.001?n.toExponential(2):n<10000?n.toFixed(4):n.toExponential(2);
const lrText=n=>n>=0.001?n.toFixed(3):n.toFixed(4);

function paintRange(el){const n=Number(el.value),min=Number(el.min),max=Number(el.max);el.style.setProperty('--fill',`${100*(n-min)/(max-min)}%`);}
function updateLabels(){
  $('lr-value').textContent=lrText(10**Number($('lr').value));
  $('iterations-value').textContent=$('iterations').value;
  for(const [id,digits] of [['momentum',2],['beta1',2],['beta2',4],['alpha',3]]) $(id+'-value').textContent=Number($(id).value).toFixed(digits);
  document.querySelectorAll('input[type=range]').forEach(paintRange);
}
function configFromInputs(){return {...DEFAULTS,x:Number($('start-x').value),y:Number($('start-y').value),lr:10**Number($('lr').value),iterations:Number($('iterations').value),momentum:Number($('momentum').value),beta1:Number($('beta1').value),beta2:Number($('beta2').value),alpha:Number($('alpha').value)};}
function putConfig(c){
  $('start-x').value=c.x;$('start-y').value=c.y;$('lr').value=Math.log10(c.lr);$('iterations').value=c.iterations;
  for(const key of ['momentum','beta1','beta2','alpha']) $(key).value=c[key];
  syncStartPreset();updateLabels();
}
function syncStartPreset(){const value=`${Number($('start-x').value)},${Number($('start-y').value)}`;const opts=Array.from($('start-preset').options).map(o=>o.value);$('start-preset').value=opts.includes(value)?value:'custom';}
function stopPlayback(){playing=false;playVersion++;cancelAnimationFrame(frame);$('play-icon').textContent='▶';$('play-label').textContent='播放';$('play').setAttribute('aria-label','播放路径');}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}

function prefixRun(run){return {...run,points:run.points.filter(p=>p.t<=current),diverged:run.diverged&&current>=run.failedAt};}
function selectedExperiment(){const runs=experiment.runs.filter(r=>visible.has(r.name));return {...experiment,runs,summaries:runs.map(summarize)};}
function syncOptimizerControls(){
  $('optimizer-select').value=visible.size===4?'all':visible.size===1?[...visible][0]:'custom';
  document.querySelectorAll('[data-method]').forEach(b=>b.setAttribute('aria-pressed',String(visible.has(b.dataset.method))));
}
async function applyOptimizerSelection(choice){
  const names=choice==='all'?METHODS.map(m=>m.name):[choice];
  if(names.some(n=>!METHODS.some(m=>m.name===n)))throw new RangeError('未知优化器');
  visible.clear();names.forEach(n=>visible.add(n));syncOptimizerControls();
  setActiveMethods([...visible]);await refreshExperiment({preserveStep:true});
}
function updateResults(){
  const custom=experiment.function?.kind==='custom';
  const partial=experiment.runs.map(prefixRun),summaries=partial.map(summarize);
  $('results-body').innerHTML=summaries.map((s,i)=>{
    const r=partial[i],m=METHODS[i],status=r.diverged?'数值发散':custom?(s.stationary?'梯度足够小':current===0?'起点':'尚未稳定'):s.converged?'已收敛':current===0?'起点':'尚未收敛';
    if(!visible.has(m.name))return '';
    return `<tr style="--method-color:${m.color}"><td><span class="table-dot"></span>${m.name}</td><td>(${s.final.x.toFixed(3)}, ${s.final.y.toFixed(3)})</td><td>${fmt(s.final.loss)}</td><td>${fmt(s.final.gradNorm)}</td><td><span class="status-chip ${r.diverged?'diverged':s.converged?'converged':''}">${status}</span><span class="basin-label">${custom?'全局最优性未验证':`${s.nearest} · d=${s.distance.toFixed(3)}`}</span></td><td>${s.stableAt===null?'—':s.stableAt}</td><td>${s.uphill}</td><td>${s.pathLength.toFixed(2)}</td></tr>`;
  }).join('');
  $('result-step').textContent=`t = ${current}`;
  if(current===0){$('finding-text').textContent='所选优化器从共同起点出发。播放路径，观察每次更新如何改变位置和损失。';return;}
  const active=summaries.map((s,i)=>({...s,name:METHODS[i].name,diverged:partial[i].diverged})).filter(s=>visible.has(s.name));
  if(custom){
    const valid=active.filter(s=>!s.diverged).sort((a,b)=>a.final.loss-b.final.loss),stable=active.filter(s=>s.stableAt!==null);
    $('finding-text').textContent=`第 ${current} 步。${valid.length?`${valid[0].name} 的当前函数值最低（${fmt(valid[0].final.loss)}）。`:'所选优化器均触发数值保护。'}${stable.length?`${stable.map(s=>s.name).join('、')} 已连续至少 10 步保持小梯度。`:'尚未出现持续稳定的小梯度。'}驻点也可能是鞍点或极大值，不能仅凭梯度接近零判定全局最小。`;
    return;
  }
  if(active.length===1){
    const s=active[0];$('finding-text').textContent=`正在单独观察 ${s.name}：第 ${current} 步，损失为 ${fmt(s.final.loss)}，最近谷底为 ${s.nearest}，损失上升 ${s.uphill} 次。${s.diverged?'本次已触发数值发散保护。':s.stableAt!==null?`从第 ${s.stableAt} 步起持续稳定。`:s.converged?'当前满足收敛判据。':'当前尚未满足严格收敛判据。'}`;return;
  }
  const stable=active.filter(s=>s.stableAt!==null).sort((a,b)=>a.stableAt-b.stableAt);
  const ranking=active.filter(s=>!s.diverged).sort((a,b)=>a.final.loss-b.final.loss);
  const bits=[];
  if(stable.length){bits.push(`截至第 ${current} 步，${stable[0].name} 最早进入持续稳定状态（从第 ${stable[0].stableAt} 步起），接近谷底 ${stable[0].nearest}。`);}else{bits.push(`截至第 ${current} 步，还没有优化器满足持续稳定的判据。${ranking.length?`${ranking[0].name} 的当前损失最低（${fmt(ranking[0].final.loss)}）。`:''}`);}
  const mo=summaries[1];
  if(visible.has('Momentum')&&mo.uphill>0){bits.push(`Momentum 已出现 ${mo.uphill} 次损失上升，惯性并不保证路径更平滑${visible.has('SGD')&&mo.nearest!==summaries[0].nearest?'，它与 SGD 还接近了不同的谷底':''}。`);}
  const adam=METHODS.findIndex(method=>method.name==='Adam');
  if(visible.has('Adam')&&visible.has('SGD')&&stable[0]?.name!=='Adam'&&summaries[adam].final.loss>summaries[0].final.loss&&!partial[0].diverged){bits.push('相同学习率下，Adam 在这次实验中没有领先 SGD。');}
  const unstable=active.filter(s=>!s.converged).map(s=>s.name);
  if(current===experiment.config.iterations&&unstable.length)bits.push(`${unstable.join('、')} 尚未满足严格收敛判据；到达预算不等于收敛。`);
  $('finding-text').textContent=bits.join(' ');
}
function syncTimeline(){
  const max=experiment.config.iterations;
  $('timeline').max=max;$('timeline').value=current;$('step-current').textContent=current;
  $('step-max').textContent=max;$('timeline-end').textContent=`${max} 步`;$('timeline-mid').textContent=Math.round(max/2);paintRange($('timeline'));
  $('step').disabled=rendering||current>=max;$('step-back').disabled=rendering||current<=0;
  $('replay').disabled=rendering||current<=0;
}
function notices(){
  const messages=[];
  for(const r of experiment.runs){
    if(!visible.has(r.name))continue;
    if(r.diverged) messages.push(`${r.name} 在第 ${r.failedAt} 次更新触发发散保护，保留前 ${r.points.length-1} 次有效更新。`);
    if(r.points.some(p=>Math.abs(p.x)>5||Math.abs(p.y)>5))messages.push(`${r.name} 的路径曾超出曲面范围 [−5,5]²；固定视域可能无法显示全部路径，导出数据完整保留。`);
  }
  $('run-notice').hidden=messages.length===0;$('run-notice').textContent=messages.join(' ');
}
async function showStep(t){
  desiredStep=Math.max(0,Math.min(experiment.config.iterations,Math.round(t)));
  if(rendering) return;
  if(busy) return drawCompletion;
  busy=true;
  drawCompletion=(async()=>{
    try{
      while(desiredStep!==null&&!rendering){
        current=desiredStep;desiredStep=null;syncTimeline();updateResults();
        await updateStep(current);
      }
    }catch(error){console.error(error);stopPlayback();toast('图形更新失败，请刷新页面。');}
    finally{
      busy=false;
      if(pendingRefresh&&!rendering){const options=pendingRefresh;pendingRefresh=null;await refreshExperiment(options);}
    }
  })();
  return drawCompletion;
}
async function refreshExperiment({preserveStep=false}={}){
  stopPlayback();
  if(rendering||busy){pendingRefresh={preserveStep};return;}
  rendering=true;
  $('apply-function').disabled=true;
  const requestedStep=desiredStep;
  $('play').disabled=true;$('step').disabled=true;$('step-back').disabled=true;$('replay').disabled=true;
  try{
    const c=configFromInputs();
    if($('start-x').value.trim()===''||$('start-y').value.trim()==='')throw new RangeError('请填写两个起点坐标。');
    experiment=runExperiment(c);current=requestedStep!==null?Math.min(requestedStep,c.iterations):preserveStep?Math.min(current,c.iterations):c.iterations;
    syncFunctionUI();
    desiredStep=null;
    $('parameter-error').hidden=true;
    const top=$('view-top').getAttribute('aria-pressed')==='true';
    $('height-mode').disabled=top;
    $('scale-label').textContent='高度';$('color-control').hidden=surfaceStyle!=='science';
    const colorNote=$('color-mode').value==='linear'?'颜色与损失成正比':'颜色采用平方根映射，增强谷底层次';
    $('height-caption').textContent=(top?'等比例俯视坐标':$('height-mode').value==='log'?(getObjective().kind==='custom'?'高度 sign(L)·log(1+|L|)':'高度 log(1 + L)'):'高度为真实损失 L')+(surfaceStyle==='science'?` · ${colorNote}`:'');
    $('scene-kind').textContent=`${getObjective().name} / ${top?'TOP VIEW':'SURFACE'}`;
    $('scene-instructions').textContent=top?'鼠标悬浮细看 · 滚轮放大 · 拖动平移':'鼠标悬浮细看 · 拖动旋转 · 滚轮缩放';
    syncViewControls();
    updateFocusNote();
    syncTimeline();updateResults();notices();
    hideInspection();
    await renderPlots(experiment,{heightMode:$('height-mode').value,colorMode:$('color-mode').value||'contrast',dragMode,step:current,surfaceStyle,focus:$('focus-region').value||'all',radius:Number($('focus-radius').value)||0.6,samples:$('path-samples').checked,viewMode:top?'top':'3d',display:{balls:$('marker-mode').value!=='point',trails:$('show-trails').checked!==false,minima:$('show-minima').checked!==false,arrows:$('show-arrows').checked===true},studyTarget:$('study-target').value||'hover',studyRadius:Number($('study-radius').value)||1.2});
    $('plot-loading').hidden=true;
  }catch(error){
    if(!(error instanceof RangeError))console.error(error);$('parameter-error').textContent=error instanceof RangeError?error.message:'图形未能加载，请确认浏览器支持 WebGL 并刷新页面。';$('parameter-error').hidden=false;
  }finally{
    rendering=false;$('play').disabled=false;$('apply-function').disabled=false;syncTimeline();
    if(pendingRefresh){const options=pendingRefresh;pendingRefresh=null;await refreshExperiment(options);}
    else if(desiredStep!==null)await showStep(desiredStep);
  }
}
function scheduleRefresh(){updateLabels();clearTimeout(debounceTimer);stopPlayback();debounceTimer=setTimeout(refreshExperiment,160);}
function setSpeed(value){
  const candidate=String(value).trim()===''?NaN:Number(value);
  const rate=Number.isFinite(candidate)?Math.max(0.25,Math.min(120,candidate)):playbackRate;
  if(playing){
    const now=viewHoldStart??performance.now();
    // Preserve fractional elapsed progress when changing rate, including a pending plot draw.
    originStep=Math.min(experiment.config.iterations,originStep+(now-playOrigin)/1000*playbackRate);
    playOrigin=now;
  }
  playbackRate=rate;$('speed').value=rate;$('speed-number').value=rate;
  $('speed').setAttribute('aria-valuetext',`${rate} 步每秒`);paintRange($('speed'));
}
function beginViewInteraction(key){
  if(viewGestures.has(key))return;
  if(viewGestures.size===0){viewHoldStart=performance.now();setInspectionInteraction(true);}
  viewGestures.add(key);
  $('view-control-status').textContent=playing?'正在调整视角 · 松开后继续播放':'正在调整视角';
}
function endViewInteraction(key){
  if(!viewGestures.delete(key)||viewGestures.size)return;
  if(playing&&viewHoldStart!==null)playOrigin+=performance.now()-viewHoldStart;
  viewHoldStart=null;setInspectionInteraction(false);syncViewControls();
}
function syncViewControls(){
  const top=$('view-top').getAttribute('aria-pressed')==='true';
  $('camera-orbit').disabled=top;
  $('camera-orbit').setAttribute('aria-pressed',String(!top&&dragMode==='orbit'));
  $('camera-pan').setAttribute('aria-pressed',String(top||dragMode==='pan'));
  $('view-control-status').textContent=top||dragMode==='pan'?'拖动画面平移 · 滚轮缩放':'拖动画面旋转 · 滚轮缩放';
}
async function viewAction(action){
  if(rendering)return;
  const key=Symbol('camera');beginViewInteraction(key);
  try{await drawCompletion;await action();}
  catch(error){console.error(error);toast('视角调整未完成，请重试。');}
  finally{endViewInteraction(key);}
}
function stepOnce(direction){
  stopPlayback();
  return showStep((desiredStep??current)+direction);
}
function tick(now){
  if(!playing)return;
  if(viewGestures.size){frame=requestAnimationFrame(tick);return;}
  const t=Math.min(experiment.config.iterations,Math.floor(originStep+(now-playOrigin)/1000*playbackRate));
  if(now-lastDraw>85&&t!==current){lastDraw=now;showStep(t);}
  if(t>=experiment.config.iterations){showStep(t);stopPlayback();return;}
  frame=requestAnimationFrame(tick);
}
async function togglePlay(){
  if(rendering)return;
  if(playing){stopPlayback();return;}
  const intent=++playVersion;
  playing=true;
  $('play-icon').textContent='Ⅱ';$('play-label').textContent='暂停';$('play').setAttribute('aria-label','暂停路径');
  if(current>=experiment.config.iterations)await showStep(0);
  if(!playing||intent!==playVersion)return;
  originStep=current;playOrigin=performance.now();lastDraw=0;
  if(viewGestures.size)viewHoldStart=playOrigin;
  frame=requestAnimationFrame(tick);
}
function download(contents,type,extension){
  const blob=new Blob([contents],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`optimizer-atlas-${extension==='json'?'experiment':'paths'}.${extension}`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出完整实验，包含当前参数与全部有效路径。');
}
function exportCSV(){
  const c=experiment.config;
  const expression='"L(x,y) = '+experiment.function.expression.replaceAll('"','""')+'"';
  const rows=['optimizer,step,w1,w2,loss,gradient_norm,learning_rate,momentum,beta1,beta2,rmsprop_alpha,epsilon,budget,diverged,failed_at,function_expression'];
  for(const run of selectedExperiment().runs)for(const p of run.points)rows.push([run.name,p.t,p.x,p.y,p.loss,p.gradNorm,c.lr,c.momentum,c.beta1,c.beta2,c.alpha,c.epsilon,c.iterations,run.diverged,run.failedAt??'',expression].join(','));
  download('\uFEFF'+rows.join('\r\n'),'text/csv;charset=utf-8','csv');
}

const functionExamples={
  himmelblau:{expression:HIMMELBLAU_EXPRESSION,x:-4,y:4,lr:0.01,iterations:200},
  // Use a start/step budget suited to each landscape's gradient scale and curvature.
  bowl:{expression:'x^2 + 4*y^2',x:-3,y:2,lr:0.01,iterations:1000},
  rosenbrock:{expression:'(1-x)^2 + 100*(y-x^2)^2',x:-1.2,y:1,lr:0.003,iterations:1000},
  ripples:{expression:'0.2*(x^2+y^2) + sin(2*x)*cos(2*y)',x:2,y:2,lr:0.01,iterations:500}
};
function syncFunctionUI(){
  const fn=getObjective(),custom=fn.kind==='custom';
  $('function-status').textContent=`当前：${fn.name}`;
  $('surface').setAttribute('aria-label',`${fn.name} 函数曲面与优化路径`);
  for(const id of ['minima-heading','minima-list','minima-key'])$(id).hidden=custom;
  $('custom-minima-note').hidden=!custom;$('show-minima').disabled=custom;$('focus-region').disabled=custom;
  document.querySelectorAll('#study-target option').forEach(option=>{if(['A','B','C','D'].includes(option.value))option.disabled=custom;});
  $('loss-scale-label').textContent=custom?'线性刻度 · 保留负值':'纵轴对数刻度';
  $('criteria-description').textContent=custom?'自定义函数：‖∇L‖ < 10⁻³ 记为“梯度足够小”；连续至少 10 个记录点满足且保持到当前步，才记为稳定。驻点可能是鞍点或极大值，全局最优性未验证。损失上升次数衡量爬坡，路径长度在参数平面中计算。':'收敛：L < 10⁻⁶ 且 ‖∇L‖ < 10⁻³。稳定：连续至少 10 个记录点满足条件，且保持至当前步。损失上升次数衡量爬坡，不等同于方向震荡。路径长度在参数平面中计算。';
}
async function applyFunction(restore=false){
  if(rendering)return;
  stopPlayback();clearTimeout(debounceTimer);await drawCompletion;
  $('function-error').hidden=true;
  try{
    const c=configFromInputs();
    if($('start-x').value.trim()===''||$('start-y').value.trim()==='')throw new RangeError('请先填写两个起点坐标。');
    if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||Math.abs(c.x)>5||Math.abs(c.y)>5)throw new RangeError('请先将起点设在 [-5,5]² 内。');
    validateConfig(c);
    const draft=restore?HIMMELBLAU_EXPRESSION:$('function-expression').value;
    const original=draft.replace(/\s/g,'')===HIMMELBLAU_EXPRESSION;
    setObjective(original?null:draft,c);
    if(restore){$('function-expression').value=HIMMELBLAU_EXPRESSION;$('function-preset').value='himmelblau';updateFormulaPreview();}
    $('focus-region').value='all';$('study-target').value='hover';hideInspection();
    desiredStep=null;await refreshExperiment();
    $('function-expression').setAttribute('aria-invalid','false');
    toast(original?'已恢复 Himmelblau 题目函数。':'已应用新函数，曲面与优化路径已重新计算。');
  }catch(error){
    $('function-error').textContent=error.message;$('function-error').hidden=false;
    $('function-expression').setAttribute('aria-invalid','true');
  }
}
function updateFormulaPreview(){
  const el=$('formula-preview');el.replaceChildren();
  const expression=$('function-expression').value.replaceAll('**','^').replaceAll('*','·');
  const pattern=/\^(-?\d+(?:\.\d+)?)/g;let start=0,match;
  while((match=pattern.exec(expression))){el.append(document.createTextNode(expression.slice(start,match.index)));const sup=document.createElement('sup');sup.textContent=match[1];el.append(sup);start=pattern.lastIndex;}
  el.append(document.createTextNode(expression.slice(start)||(!expression?'在下方输入表达式':'')));
}
function bindFunctionControls(){
  updateFormulaPreview();
  $('function-form').addEventListener('submit',e=>{e.preventDefault();applyFunction();});
  $('restore-function').addEventListener('click',()=>applyFunction(true));
  $('function-preset').addEventListener('change',()=>{
    const example=functionExamples[$('function-preset').value];
    if(!example)return;
    $('function-expression').value=example.expression;
    putConfig({...configFromInputs(),x:example.x,y:example.y,lr:example.lr,iterations:example.iterations});
    updateFormulaPreview();
    $('function-status').textContent=`已载入建议配置 · 起点 (${example.x}, ${example.y}) · η=${example.lr} · ${example.iterations} 步`;
  });
  $('function-expression').addEventListener('input',()=>{updateFormulaPreview();$('function-preset').value='custom';$('function-status').textContent='有未应用的修改';$('function-error').hidden=true;$('function-expression').setAttribute('aria-invalid','false');});
  $('function-expression').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();applyFunction();}});
}

function bindControls(){
  bindFunctionControls();
  bindDetailControls();
  $('legend').innerHTML=METHODS.map(m=>`<button data-method="${m.name}" aria-label="显示或隐藏 ${m.name} 路径" aria-pressed="true" style="--method-color:${m.color}"><span class="legend-line"></span>${m.name}</button>`).join('');
  $('optimizer-select').addEventListener('change',()=>applyOptimizerSelection($('optimizer-select').value));
  $('legend').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const name=b.dataset.method,on=!visible.has(name);if(!on&&visible.size===1){toast('请至少保留一种优化器，也可以在选择器中切换。');return;}if(on)visible.add(name);else visible.delete(name);syncOptimizerControls();setActiveMethods([...visible]);await refreshExperiment({preserveStep:true});});
  for(const id of ['lr','iterations','momentum','beta1','beta2','alpha'])$(id).addEventListener('input',scheduleRefresh);
  for(const id of ['start-x','start-y'])$(id).addEventListener('input',()=>{syncStartPreset();scheduleRefresh();});
  $('start-preset').addEventListener('change',()=>{if($('start-preset').value==='custom'){$('start-x').focus();return;}const [x,y]=$('start-preset').value.split(',');$('start-x').value=x;$('start-y').value=y;scheduleRefresh();});
  $('height-mode').addEventListener('change',()=>refreshExperiment({preserveStep:true}));
  $('reset-all').addEventListener('click',()=>{putConfig(DEFAULTS);applyOptimizerSelection('all');toast('已恢复题目默认参数。');});
  $('play').addEventListener('click',togglePlay);
  $('step').addEventListener('click',()=>stepOnce(1));
  $('step-back').addEventListener('click',()=>stepOnce(-1));
  $('replay').addEventListener('click',()=>{stopPlayback();showStep(0);});
  $('timeline').addEventListener('input',()=>{stopPlayback();showStep(Number($('timeline').value));});
  $('speed').addEventListener('input',()=>setSpeed($('speed').value));
  $('speed-number').addEventListener('change',()=>setSpeed($('speed-number').value));
  $('speed-number').addEventListener('keydown',e=>{if(e.key==='Enter'){setSpeed($('speed-number').value);$('speed-number').blur();}});
  setSpeed(playbackRate);
  const camera=view=>{$('view-3d').classList.toggle('selected',view==='3d');$('view-top').classList.toggle('selected',view==='top');$('view-3d').setAttribute('aria-pressed',String(view==='3d'));$('view-top').setAttribute('aria-pressed',String(view==='top'));refreshExperiment({preserveStep:true});};
  $('view-3d').addEventListener('click',()=>camera('3d'));$('view-top').addEventListener('click',()=>camera('top'));$('reset-camera').addEventListener('click',()=>viewAction(()=>setCamera($('view-top').getAttribute('aria-pressed')==='true'?'top':'3d')));
  bindMapSelection((x,y)=>{if(rendering)return;$('start-x').value=x.toFixed(2);$('start-y').value=y.toFixed(2);syncStartPreset();scheduleRefresh();toast(`共同起点已设为 (${x.toFixed(2)}, ${y.toFixed(2)})。`);});
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea,button,summary,a,[contenteditable="true"]'))return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    if(!rendering&&(e.code==='ArrowRight'||e.code==='ArrowLeft')){e.preventDefault();stepOnce(e.code==='ArrowRight'?1:-1);}
  });
  $('export-csv').addEventListener('click',exportCSV);
  $('export-json').addEventListener('click',()=>download(JSON.stringify({title:`Optimizer Atlas · ${getObjective().name}`,generatedAt:new Date().toISOString(),...selectedExperiment(),notes:{selectedOptimizers:[...visible],gradient:getObjective().kind==='custom'?'forward automatic differentiation':'deterministic full analytic gradient',heightDisplay:$('height-mode').value,stableDefinition:'At least 10 qualifying recorded states that persist to the current end',displayFloor:getObjective().kind==='custom'?null:1e-16}},null,2),'application/json;charset=utf-8','json'));
  document.querySelectorAll('[data-experiment]').forEach(b=>b.addEventListener('click',async()=>{
    const type=b.dataset.experiment,c={...DEFAULTS};
    if(type==='rate')c.lr=0.03;if(type==='momentum')c.momentum=0;if(type==='basin'){c.x=4;c.y=-4;}
    putConfig(c);
    if(type==='momentum')$('momentum').closest('details').open=true;
    $('lab').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    await refreshExperiment();
    toast(type==='rate'?'实验 A：学习率 0.03。观察过冲与发散。':type==='momentum'?'实验 B：动量为 0。试着逐渐增大 μ。':'实验 C：起点 (4, −4)。观察谷底选择。');
  }));
}

function updateFocusNote(){
    const id=$('focus-region').value,p=MINIMA.find(p=>p.id===id),radius=Number($('focus-radius').value);
    $('radius-control').hidden=!p;$('focus-note').hidden=!p;
    const region=resolveRegion(selectedExperiment().runs,id,radius);
    $('focus-note').textContent=p?(region.empty?`所选路径没有经过谷底 ${id} 的半径 ${radius} 范围，主图保留完整轨迹。悬浮此谷底，可查看局部三维地形。`:`谷底 ${id} · 半径 ${radius}；经过此范围：${region.methods.join('、')}。左下角保留全程轨迹，悬浮可看局部立体放大。`):'';
    $('focus-note').classList.toggle('unvisited',region.empty);
    document.querySelectorAll('[data-minimum]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.minimum===id)));
}
function bindDetailControls(){
  const local=()=>{refreshExperiment({preserveStep:true});};
  let wheelTimer;
  for(const el of [$('surface'),$('hover-inspector')]){
    el.addEventListener('pointerdown',e=>{if(!e.target.closest('button,select,input'))beginViewInteraction(`pointer-${e.pointerId}`);},true);
    el.addEventListener('wheel',()=>{beginViewInteraction('wheel');clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>endViewInteraction('wheel'),180);},{passive:true,capture:true});
  }
  for(const event of ['pointerup','pointercancel'])document.addEventListener(event,e=>endViewInteraction(`pointer-${e.pointerId}`),true);
  window.addEventListener('blur',()=>{for(const key of [...viewGestures])endViewInteraction(key);});
  for(const [id,mode] of [['camera-orbit','orbit'],['camera-pan','pan']])$(id).addEventListener('click',()=>viewAction(async()=>{dragMode=mode;await setInteractionMode(mode);syncViewControls();}));
  $('view-options').addEventListener('toggle',()=>requestAnimationFrame(()=>resizeSurface()));
  $('minima-list').innerHTML=MINIMA.map(p=>`<button data-minimum="${p.id}" aria-pressed="false" aria-label="放大全局最小值 ${p.id}"><span class="minimum-id">${p.id}</span><span><strong>(${p.x.toFixed(4)}, ${p.y.toFixed(4)})</strong><small>全局最小值 · L = 0</small></span><span class="minimum-arrow">↗</span></button>`).join('');
  document.querySelectorAll('[data-minimum]').forEach(b=>{
    const p=MINIMA.find(p=>p.id===b.dataset.minimum);
    b.addEventListener('click',()=>{$('focus-region').value=b.dataset.minimum;local();});
    const inspect=()=>showInspection(p.x,p.y,`全局最小值 ${p.id} · L=0`);
    b.addEventListener('pointerenter',inspect);b.addEventListener('focus',inspect);
    b.addEventListener('pointerleave',hideInspection);b.addEventListener('blur',hideInspection);
  });
  $('focus-region').addEventListener('change',local);$('focus-radius').addEventListener('change',local);
  $('path-samples').addEventListener('change',()=>refreshExperiment({preserveStep:true}));
  for(const id of ['marker-mode','show-trails','show-minima','show-arrows','study-target','study-radius','color-mode'])$(id).addEventListener('change',local);
  $('inspect-left').addEventListener('click',()=>turnInspection(-1));
  $('inspect-right').addEventListener('click',()=>turnInspection(1));
  $('inspect-close').addEventListener('click',()=>{$('study-target').value='hover';hideInspection();local();});
  for(const name of ['mist','science'])$('style-'+name).addEventListener('click',()=>{
    if(rendering)return;surfaceStyle=name;
    for(const id of ['mist','science']){$('style-'+id).classList.toggle('selected',name===id);$('style-'+id).setAttribute('aria-pressed',String(name===id));}
    $('height-mode').value=name==='science'?'raw':'log';
    refreshExperiment({preserveStep:true});
  });
  $('zoom-in').addEventListener('click',()=>viewAction(()=>zoomCamera(0.8)));
  $('zoom-out').addEventListener('click',()=>viewAction(()=>zoomCamera(1.25)));
  const scene=$('scene-view'),home=document.createComment('scene home'),dialog=$('terrain-dialog');
  scene.before(home);
  $('expand-scene').addEventListener('click',()=>{
    $('dialog-scene').append(scene);$('expand-scene').hidden=true;
    dialog.showModal();document.body.classList.add('scene-expanded');
    requestAnimationFrame(()=>resizeSurface());
  });
  $('close-scene').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    home.after(scene);$('expand-scene').hidden=false;document.body.classList.remove('scene-expanded');
    requestAnimationFrame(()=>resizeSurface());$('expand-scene').focus();
  });
}

async function init(){
  const start=performance.now();
  while(!window.Plotly){if(performance.now()-start>20000){$('plot-loading').textContent='绘图库未加载。请通过本地服务器打开页面，并确认 vendor 文件完整。';return;}await new Promise(r=>setTimeout(r,60));}
  bindControls();putConfig(DEFAULTS);await refreshExperiment();
}
init().catch(error=>{console.error(error);$('plot-loading').textContent='实验加载失败，请刷新页面。';});
