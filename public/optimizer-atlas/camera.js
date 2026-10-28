// Plotly 3.1.0's WebGL camera saves its layout asynchronously after interaction.
// Commit it before restyle/react so playback cannot overwrite a just-finished drag.
// This adapter is specific to the vendored Plotly version; 2D plots are a no-op.
export function preserveCamera(el){
  const scene=el?._fullLayout?.scene?._scene;
  if(el?.layout&&typeof scene?.saveLayout==='function')scene.saveLayout(el.layout);
}
