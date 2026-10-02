// 复算 WallStrip 的三角形绕序 -> 顶点法线，检查外壁法线是否真的朝城外
import * as THREE from 'three';

const hU = (m) => m / 100, vU = (m) => m / 30;
const WALL_H = 20, WALL_BASE = 20, WALL_TOP = 7, WALL_SINK = 1.5;
const bh = WALL_BASE / 2, th = WALL_TOP / 2;

function stationPoint(nx, nz, x, z, y, t, h) {
  return [x + nx * hU(t), y + vU(h), z + nz * hU(t)];
}
// 直线墙：沿 +Z 走，外法线 +X
const stations = [];
for (let i = 0; i < 2; i++) {
  stations.push({ x: 0, z: i * 3, nx: 1, nz: 0, y: 0 });
}

function face(ta, ha, tb, hb, flip) {
  const pos = [], idx = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const s = stations[i], s2 = stations[i + 1];
    pos.push(...stationPoint(s.nx, s.nz, s.x, s.z, s.y, ta, ha),
      ...stationPoint(s.nx, s.nz, s.x, s.z, s.y, tb, hb),
      ...stationPoint(s2.nx, s2.nz, s2.x, s2.z, s2.y, tb, hb),
      ...stationPoint(s2.nx, s2.nz, s2.x, s2.z, s2.y, ta, ha));
    const o = i * 4;
    idx.push(...(flip ? [o, o + 2, o + 1, o, o + 3, o + 2] : [o, o + 1, o + 2, o, o + 2, o + 3]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const outward = { 外壁: [1, 0, 0], 内壁: [-1, 0, 0], 城顶: [0, 1, 0] };
  const grp = [];
  for (const [k, want] of Object.entries(outward)) {
    let okN = 0;
    for (let i = 0; i < n.count; i++) {
      const dot = n.getX(i) * want[0] + n.getY(i) * want[1] + n.getZ(i) * want[2];
      if (dot > 0.3) okN++; else if (okN >= 4) break;
    }
    grp.push(`${k} 朝外顶点 ${okN}/${n.count}`);
  }
  console.log(flip ? '[翻转后]' : '[原始]  ', grp.join('  |  '));
}

face(th, WALL_H, bh, -WALL_SINK, false);
face(th, WALL_H, bh, -WALL_SINK, true);
console.log('--- 内壁：内底 -> 内顶 ---');
face(-bh, -WALL_SINK, -th, WALL_H, false);
face(-bh, -WALL_SINK, -th, WALL_H, true);
console.log('--- 城顶：内低 -> 外高 ---');
face(-th, WALL_H - 0.4, th, WALL_H + 0.4, false);
face(-th, WALL_H - 0.4, th, WALL_H + 0.4, true);
