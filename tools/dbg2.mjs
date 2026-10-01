const w = await import('../js/world.js');
const l = await import('../js/landmarks.js');
const THREE = await import('three');
function maxY(o){ const v=new THREE.Vector3(); let m=-Infinity; o.updateWorldMatrix(true,true);
  o.traverse(c=>{ if(!c.isMesh&&!c.isLineSegments) return; const a=c.geometry&&c.geometry.attributes&&c.geometry.attributes.position; if(!a) return;
    const idx=c.geometry.index; const n=idx?idx.count:a.count;
    for(let i=0;i<n;i++){ v.fromBufferAttribute(a, idx?idx.getX(i):i).applyMatrix4(c.matrixWorld); if(v.y>m)m=v.y; } });
  return m; }
const lm=l.buildLandmarks({merge:false});
for(const id of ['qixiasi','jimingsi']){
  const it=lm.items.find(i=>i.id===id);
  const built=it.group.children[0];
  const gy=it.group.position.y;
  console.log('=== '+id+' gposY='+gy.toFixed(3)+' ===');
  for(const ch of built.children){
    console.log('  child', ch.type, (ch.name||'').slice(0,18).padEnd(18),
      'localMax=', (maxY(ch)-gy).toFixed(3));
  }
}
