import {loss,getMinima,displayHeight} from './engine.js';

export function refineDisplayPath(points,maxStep){
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(a&&b){
      const n=Math.min(192,Math.max(1,Math.ceil(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))/maxStep)));
      for(let j=1;j<n;j++){
        const u=j/n,x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
        out.push({x,y,loss:loss(x,y),t:typeof b.t==='string'?b.t:typeof a.t==='string'?a.t:`${a.t} → ${b.t}`});
      }
    }
    out.push(b);
  }
  return out;
}

// Rendering-only segment clipping. New boundary points are explicitly labeled as connectors.
export function clipPath(points,xRange,yRange){
  const inside=p=>p.x>=xRange[0]&&p.x<=xRange[1]&&p.y>=yRange[0]&&p.y<=yRange[1];
  if(points.length<2)return points.map(p=>inside(p)?p:null);
  const out=[];
  const gap=()=>{if(out.length&&out.at(-1)!==null)out.push(null);};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];let lo=0,hi=1,miss=false;
    for(const [v,d,range] of [[a.x,b.x-a.x,xRange],[a.y,b.y-a.y,yRange]]){
      if(Math.abs(d)<1e-15){if(v<range[0]||v>range[1])miss=true;continue;}
      const s=(range[0]-v)/d,t=(range[1]-v)/d;
      lo=Math.max(lo,Math.min(s,t));hi=Math.min(hi,Math.max(s,t));
    }
    if(miss||lo>hi){gap();continue;}
    const at=u=>{
      if(u===0)return a;if(u===1)return b;
      const x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
      return {x,y,loss:loss(x,y),t:typeof b.t==='string'?b.t:typeof a.t==='string'?a.t:`${a.t} → ${b.t}`};
    };
    const start=at(lo),end=at(hi);
    if(lo>0)gap();
    const prev=out.at(-1);
    if(!prev||prev.x!==start.x||prev.y!==start.y)out.push(start);
    out.push(end);
    if(hi<1)gap();
  }
  return out;
}

export function projectPath(points){
  if(!points.length)return [];
  const path=[points[0]];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    for(let j=1;j<12;j++){
      const u=j/12,x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
      path.push({x,y,loss:loss(x,y),t:`${a.t} → ${b.t}`});
    }
    path.push(b);
  }
  return path;
}

// Resample the function rather than magnifying a coarse overview mesh.
export function buildTerrain(focus='all',radius=0.6,mode='log'){
  const minimum=getMinima().find(p=>p.id===focus);
  if(focus!=='all'&&!minimum)throw new RangeError('未知谷底');
  if(!Number.isFinite(radius)||radius<=0||radius>5)throw new RangeError('无效局部半径');
  const xRange=minimum?[minimum.x-radius,minimum.x+radius]:[-5,5];
  const yRange=minimum?[minimum.y-radius,minimum.y+radius]:[-5,5];
  const sample=range=>Array.from({length:121},(_,i)=>range[0]+(range[1]-range[0])*i/120);
  const x=sample(xRange),y=sample(yRange),raw=y.map(b=>x.map(a=>loss(a,b)));
  const z=raw.map(row=>row.map(v=>displayHeight(v,mode)));
  const lo=Math.min(0,...z.map(row=>Math.min(...row))),hi=Math.max(0,...z.map(row=>Math.max(...row))),span=Math.max(1e-6,hi-lo);
  const zRange=[lo<0?lo-span*0.08:0,hi+span*0.08],zMax=zRange[1];
  return {x,y,raw,z,xRange,yRange,zRange,zMax,lift:span*0.00216,minimum};
}
