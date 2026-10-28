// Shared by scientific perspective, top view and the local 3D magnifier.
export const spectrum=[[0,'#173C91'],[0.15,'#255DD3'],[0.32,'#20A5D3'],[0.48,'#3ED7BB'],[0.65,'#BBE464'],[0.8,'#F7D74E'],[0.92,'#ED8738'],[1,'#CF353F']];
export const sciencePaths=['#FF7D86','#35E1B4','#CBB0FF','#FFDC78'];

// Color is independent of vertical geometry. Tick labels always show true loss.
export function scienceColorMapping(raw,mode='contrast'){
  const min=Math.min(0,...raw.map(row=>Math.min(...row))),max=Math.max(...raw.map(row=>Math.max(...row))),span=Math.max(1e-12,max-min);
  const map=value=>mode==='linear'?(value-min)/span:Math.sqrt((value-min)/span);
  const losses=[0,0.01,0.05,0.2,0.5,1].map(t=>min+span*t);
  return {values:raw.map(row=>row.map(map)),tickvals:losses.map(map),ticktext:losses.map(v=>v===0?'0':Math.abs(v)>=100?String(Math.round(v)):Number(v.toPrecision(3)).toString())};
}
