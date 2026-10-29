/** Deterministic full-gradient optimizers. No clipping, noise, or hidden learning-rate schedules. */
import {compileExpression,validateExpression} from './expression.js';
export const DEFAULTS = Object.freeze({x:-4,y:4,lr:0.01,iterations:200,momentum:0.9,beta1:0.9,beta2:0.999,alpha:0.99,epsilon:1e-8});
export const METHODS = Object.freeze([
  {name:'SGD',color:'#D84F57',tag:'跟随当下的坡度'},
  {name:'Momentum',color:'#16877E',tag:'带着惯性向前'},
  {name:'RMSprop',color:'#A57316',tag:'为每个方向调步幅'},
  {name:'Adam',color:'#7854BA',tag:'记忆与自适应'},
]);
export const MINIMA = Object.freeze([
  {id:'A',x:3,y:2},
  {id:'B',x:-2.805118086952745,y:3.131312518250573},
  {id:'C',x:-3.779310253377747,y:-3.28318599128617},
  {id:'D',x:3.5844283403304917,y:-1.8481265269644036},
]);
export const CRITERIA = Object.freeze({loss:1e-6,gradNorm:1e-3,window:10,maxLoss:1e12});
export const HIMMELBLAU_EXPRESSION='(x^2+y-11)^2+(x+y^2-7)^2';
export const PRESET_MINIMA=Object.freeze({
  bowl:{name:'椭圆碗',minimumValue:0,minima:[{id:'G',x:0,y:0}]},
  rosenbrock:{name:'Rosenbrock 香蕉函数',minimumValue:0,minima:[{id:'G',x:1,y:1}]},
  ripples:{name:'波纹地形',minimumValue:-0.8878628265737075,minima:[{id:'G',x:-0.7137758893822974,y:0}]}
});
let objective=null;
let objectiveInfo=null;
export function setObjective(expression,start){
  const next=expression===null?null:validateExpression(compileExpression(expression),start);
  const key=next?.expression.replace(/\s/g,'').replaceAll('**','^');
  const presets={
    'x^2+4*y^2':'bowl',
    '(1-x)^2+100*(y-x^2)^2':'rosenbrock',
    '0.2*(x^2+y^2)+sin(2*x)*cos(2*y)':'ripples'
  };
  objective=next;objectiveInfo=next?PRESET_MINIMA[presets[key]]??null:null;
}
export function getObjective(){return {kind:objective?(objectiveInfo?'preset':'custom'):'himmelblau',name:objectiveInfo?.name??(objective?'自定义函数':'Himmelblau'),expression:objective?.expression??HIMMELBLAU_EXPRESSION,minimumValue:objectiveInfo?.minimumValue??0,knownGlobal:Boolean(objectiveInfo),signed:objectiveInfo?.minimumValue<0};}
export function getMinima(){return objective?(objectiveInfo?.minima??[]):MINIMA;}
export function displayHeight(value,mode='log'){return mode==='log'?Math.sign(value)*Math.log1p(Math.abs(value)):value;}

export function loss(x,y) {
  if(objective)return objective.value(x,y);
  return (x*x+y-11)**2+(x+y*y-7)**2;
}
export function gradient(x,y) {
  if(objective)return objective.gradient(x,y);
  const a=x*x+y-11,b=x+y*y-7;
  return [4*x*a+2*b,2*a+4*y*b];
}
export function validateConfig(c) {
  for(const k of Object.keys(DEFAULTS)) if(!Number.isFinite(c[k])) throw new RangeError(`${k} 必须是有限数值`);
  if(Math.abs(c.x)>5 || Math.abs(c.y)>5) throw new RangeError('起点坐标应在 [-5,5] 内');
  if(c.lr<=0 || c.lr>0.1) throw new RangeError('学习率应在 (0,0.1] 内');
  if(!Number.isInteger(c.iterations)||c.iterations<1||c.iterations>1000) throw new RangeError('更新次数应为 1–1000 的整数');
  for(const k of ['momentum','beta1','beta2','alpha']) if(c[k]<0||c[k]>=1) throw new RangeError(`${k} 应在 [0,1) 内`);
  if(c.epsilon<=0) throw new RangeError('epsilon 必须大于零');
}
function point(t,x,y) { return {t,x,y,loss:loss(x,y),gradNorm:Math.hypot(...gradient(x,y))}; }

export function simulate(name, config={}) {
  if(!METHODS.some(m=>m.name===name)) throw new RangeError('未知优化器');
  const c={...DEFAULTS,...config}; validateConfig(c);
  let x=c.x,y=c.y;
  const velocity=[0,0],m=[0,0],v=[0,0],points=[point(0,x,y)];
  if(![points[0].loss,points[0].gradNorm].every(Number.isFinite)||Math.abs(points[0].loss)>CRITERIA.maxLoss)throw new RangeError('当前起点处的函数或梯度无效，请更换起点。');
  const run={name,points,diverged:false,reason:null,failedAt:null,function:getObjective()};
  for(let t=1;t<=c.iterations;t++) {
    const g=gradient(x,y),delta=[0,0];
    for(let i=0;i<2;i++) {
      if(name==='SGD') delta[i]=c.lr*g[i];
      if(name==='Momentum') {
        velocity[i]=c.momentum*velocity[i]+g[i];
        delta[i]=c.lr*velocity[i];
      }
      if(name==='Adam') {
        m[i]=c.beta1*m[i]+(1-c.beta1)*g[i];
        v[i]=c.beta2*v[i]+(1-c.beta2)*g[i]*g[i];
        const mh=m[i]/(1-c.beta1**t),vh=v[i]/(1-c.beta2**t);
        delta[i]=c.lr*mh/(Math.sqrt(vh)+c.epsilon);
      }
      if(name==='RMSprop') {
        v[i]=c.alpha*v[i]+(1-c.alpha)*g[i]*g[i];
        delta[i]=c.lr*g[i]/(Math.sqrt(v[i])+c.epsilon);
      }
    }
    const next=point(t,x-delta[0],y-delta[1]);
    if(![next.x,next.y,next.loss,next.gradNorm].every(Number.isFinite)||Math.abs(next.loss)>CRITERIA.maxLoss) {
      run.diverged=true; run.reason='下一步 |L| 超过 10¹²，或函数 / 梯度不再有限';run.failedAt=t;break;
    }
    x=next.x;y=next.y;points.push(next);
  }
  return run;
}

export function summarize(run) {
  const p=run.points,final=p.at(-1);
  const known=Boolean(run.function?.knownGlobal),custom=run.function?.kind==='custom';
  const qualifies=q=>(custom||Math.abs(q.loss-(run.function?.minimumValue??0))<CRITERIA.loss)&&q.gradNorm<CRITERIA.gradNorm;
  let suffix=p.length;
  while(suffix>0&&qualifies(p[suffix-1])) suffix--;
  const stationary=!run.diverged&&qualifies(final),converged=known&&stationary;
  const stableAt=stationary&&p.length-suffix>=CRITERIA.window?p[suffix].t:null;
  let uphill=0,pathLength=0;
  for(let i=1;i<p.length;i++) {
    if(p[i].loss-p[i-1].loss>1e-10*Math.max(1,Math.abs(p[i-1].loss))) uphill++;
    pathLength+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y);
  }
  const ordered=getMinima().map(q=>({...q,distance:Math.hypot(final.x-q.x,final.y-q.y)})).sort((a,b)=>a.distance-b.distance);
  return {final,converged,stationary,stableAt,nearest:ordered[0]?.id??null,distance:ordered[0]?.distance??null,uphill,pathLength};
}
export function runExperiment(config={}) {
  const resolved={...DEFAULTS,...config};
  const runs=METHODS.map(m=>simulate(m.name,resolved));
  return {config:resolved,runs,summaries:runs.map(summarize),criteria:{...CRITERIA,mode:getObjective().knownGlobal?'known-global-minimum':'stationary-gradient'},function:getObjective()};
}
