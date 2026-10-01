const w = await import('../js/world.js');
const l = await import('../js/landmarks.js');
const THREE = await import('three');
function vertexTop(obj, baseY){
  const v=new THREE.Vector3(); let maxY=-Infinity;
  obj.updateWorldMatrix(true,true);
  obj.traverse(o=>{ if(!o.isMesh&&!o.isLineSegments) return;
    const a=o.geometry&&o.geometry.attributes&&o.geometry.attributes.position; if(!a) return;
    const idx=o.geometry.index; const n=idx?idx.count:a.count;
    for(let i=0;i<n;i++){ v.fromBufferAttribute(a, idx?idx.getX(i):i).applyMatrix4(o.matrixWorld); if(v.y>maxY)maxY=v.y; } });
  return Number.isFinite(maxY)?maxY-baseY:-Infinity;
}
const lm=l.buildLandmarks({merge:false});
for(const id of ['xuanwu','yuejianglou','presidential','museum','qixiasi','jimingsi']){
  const it=lm.items.find(i=>i.id===id);
  console.log(id.padEnd(12), 'gposY=',it.group.position.y.toFixed(3),
    'modelUnits=',vertexTop(it.group,it.group.position.y).toFixed(3),
    'modelM=',(vertexTop(it.group,it.group.position.y)*30).toFixed(1),
    'heightM=',it.heightM);
}
