// 城墙与城门共用的平面坐标架；只依赖地理数据，避免 world / gates 循环引用。
import { toV2, smoothPolyline, clamp } from './geo.js';
import { CITY_WALL } from './data.js';

export const WALL_LINE = smoothPolyline(CITY_WALL.map(([lon, lat]) => toV2(lon, lat)), 7);
export const WALL_CENTER = WALL_LINE.reduce((a, p) => [a[0] + p[0] / WALL_LINE.length, a[1] + p[1] / WALL_LINE.length], [0, 0]);

export function wallFrame(x, z) {
  let best = Infinity, tangent = [1, 0], point = [x, z], segment = 0, along = 0, length = 0;
  for (let i = 0; i < WALL_LINE.length; i++) {
    const a = WALL_LINE[i], b = WALL_LINE[(i + 1) % WALL_LINE.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (len * len), 0, 1);
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d; tangent = [dx / len, dz / len]; point = [px, pz]; segment = i; along = length + t * len;
    }
    length += len;
  }
  const normal = [-tangent[1], tangent[0]];
  const ox = x - WALL_CENTER[0], oz = z - WALL_CENTER[1], outLen = Math.hypot(ox, oz) || 1;
  return { tangent, normal, outward: [ox / outLen, oz / outLen], wallDist: best, point, segment, along, length };
}

export function gateFrame(gt) {
  const [x, z] = toV2(gt.lon, gt.lat), frame = wallFrame(x, z);
  const zOut = frame.normal[0] * frame.outward[0] + frame.normal[1] * frame.outward[1] >= 0 ? 1 : -1;
  return { x, z, ...frame, zOut, localX: [frame.normal[1], -frame.normal[0]] };
}
