// 调试：列出每个地标中最高的几个构件，定位体量失真来源
import * as THREE from 'three';
const l = await import('../js/landmarks.js');
const lm = l.buildLandmarks();
const fmt = (v) => v.toFixed(2);
for (const it of lm.items) {
  const gy = it.group.position.y;
  const rows = [];
  it.group.traverse((o) => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const b = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position);
    b.applyMatrix4(o.matrixWorld);
    rows.push([o.geometry.type, b.max.y - gy, o.scale.x, o.scale.y, o.scale.z]);
  });
  rows.sort((a, b) => b[1] - a[1]);
  console.log(it.id + ' (' + it.model + ') top=' + fmt(it.top) + 'u gy=' + fmt(gy));
  rows.slice(0, 4).forEach((r) => {
    console.log('    ' + r[0].padEnd(18) + ' maxY=' + fmt(r[1]) + ' scale=' + r.slice(2).map(fmt).join(','));
  });
}
