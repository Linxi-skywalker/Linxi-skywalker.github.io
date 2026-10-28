import {METHODS,displayHeight} from './engine.js';
import {sciencePaths} from './palette.js';

export function stepDirection(run,step,mode='log'){
  const index=run.points.findLastIndex(p=>p.t<=step);
  if(index<1||run.points[index].t!==step)return null;
  const p=run.points[index],a=run.points[index-1],dx=p.x-a.x,dy=p.y-a.y;
  if(Math.hypot(dx,dy)<1e-10)return null;
  const h=l=>displayHeight(l,mode);
  return {dx,dy,dz:h(p.loss)-h(a.loss)};
}

function sphere(p,rx,ry,rz,z){
  const x=[],y=[],zs=[],i=[],j=[],k=[],rows=10,columns=16;
  for(let a=0;a<=rows;a++)for(let b=0;b<=columns;b++){
    const phi=Math.PI*a/rows,theta=2*Math.PI*b/columns;
    x.push(p.x+rx*Math.sin(phi)*Math.cos(theta));
    y.push(p.y+ry*Math.sin(phi)*Math.sin(theta));
    zs.push(z+rz*Math.cos(phi));
    if(a<rows&&b<columns){const n=a*(columns+1)+b;i.push(n,n+1);j.push(n+1,n+columns+2);k.push(n+columns+1,n+columns+1);}
  }
  return {x,y,z:zs,i,j,k};
}

// Three stable traces per optimizer: ball, normalized update shaft, arrowhead.
export function buildMotionOverlays(runs,step,terrain,options={},dimension=3){
  const {balls=true,arrows=false,mode='log',style='mist',hidden=new Set()}=options;
  const sx=terrain.xRange[1]-terrain.xRange[0],sy=terrain.yRange[1]-terrain.yRange[0];
  const zr=terrain.zRange??[0,terrain.zMax],sz=Math.max(1e-12,zr[1]-zr[0]);
  const h=l=>displayHeight(l,mode);
  return runs.flatMap(run=>{
    const p=run.points.findLast(p=>p.t<=step)??run.points[0];
    const idx=METHODS.findIndex(m=>m.name===run.name),color=style==='science'?sciencePaths[idx]:METHODS[idx].color;
    const inside=p.x>=terrain.xRange[0]&&p.x<=terrain.xRange[1]&&p.y>=terrain.yRange[0]&&p.y<=terrain.yRange[1];
    const visible=inside&&!hidden.has(run.name),rz=sz*0.025/(options.aspectZ??0.65),z=h(p.loss)+rz*1.05;
    const common={name:run.name,showlegend:false,hoverinfo:'skip'};
    const ball=dimension===3?{...common,type:'mesh3d',...sphere(p,sx*0.025,sy*0.025,rz,z),color,flatshading:false,lighting:{ambient:0.45,diffuse:0.85,specular:1,roughness:0.22,fresnel:0.3},lightposition:{x:-200,y:300,z:500},visible:visible&&balls}:{...common,type:'scatter',mode:'markers',x:[p.x],y:[p.y],marker:{size:17,color,line:{color:'#fff',width:2}},visible:visible&&balls};
    const d=stepDirection(run,step,mode),norm=d?Math.hypot(d.dx/sx,d.dy/sy,dimension===3?d.dz/sz:0):0;
    const f=norm?0.115/norm:0,dx=d?d.dx*f:0,dy=d?d.dy*f:0,dz=d?d.dz*f:0;
    const end={x:p.x+dx,y:p.y+dy,z:z+dz};
    const shaft={...common,type:dimension===3?'scatter3d':'scatter',mode:'lines',x:[p.x,end.x],y:[p.y,end.y],line:{color,width:dimension===3?6:3},visible:visible&&arrows&&!!d};
    if(dimension===3)shaft.z=[z,end.z];
    const tip=dimension===3?{...common,type:'cone',x:[end.x],y:[end.y],z:[end.z],u:[dx],v:[dy],w:[dz],anchor:'tip',sizemode:'absolute',sizeref:Math.min(sx,sy)*0.045,colorscale:[[0,color],[1,color]],showscale:false,visible:visible&&arrows&&!!d}:{...common,type:'scatter',mode:'markers',x:[end.x],y:[end.y],marker:{symbol:'triangle-up',angle:90-Math.atan2(dy,dx)*180/Math.PI,size:11,color,line:{color:'#fff',width:0.8}},visible:visible&&arrows&&!!d};
    return [ball,shaft,tip];
  });
}
