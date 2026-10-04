// 信号灯相位模型(车流智能):props.js 的灯珠变色与 city.js 的车流停车共用这一份真值,
// 车停的那盏灯和灯珠显示的颜色永远一致。纯 JS 无 three 依赖,node 侧 smoke 可安全 import。
//
// 相位表(全周期 CYCLE=26 s):
//   A 路:绿 0-11 / 黄 11-13 / 红 13-26
//   B 路:红 0-13 / 绿 13-24 / 黄 24-26
// 每个路口按坐标哈希取相位偏移,全城不会同拍齐闪。

export const CYCLE = 26;
const A_GREEN = 11, A_YELLOW = 2, B_GREEN = 11, B_YELLOW = 2;

/** 路口相位偏移(0..CYCLE):坐标确定性哈希,车流与灯珠两侧调用天然同源 */
export function phaseOffset(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return (h - Math.floor(h)) * CYCLE;
}

/** 某时刻某路口两轴的灯色:{ a: 'green'|'yellow'|'red', b: … } */
export function phaseFor(junction, t) {
  const p = (((t + phaseOffset(junction.x, junction.z)) % CYCLE) + CYCLE) % CYCLE;
  const a = p < A_GREEN ? 'green' : p < A_GREEN + A_YELLOW ? 'yellow' : 'red';
  const b = p < A_GREEN + A_YELLOW ? 'red'
    : p < A_GREEN + A_YELLOW + B_GREEN ? 'green' : 'yellow';
  return { a, b };
}

/** 某轴「受保护剩余秒数」：红灯剩余 + 黄灯预告（黄灯即视为即将受保护，行人可提前起步；
 * 车流/灯珠仍用 phaseFor 瞬时色，两套口径互不干扰）。行人放行判据的唯一真源——
 * 行人 Phase 2 用它决定「现在过街来得及吗」（need = 跨距/过街速度 + 安全余量）。 */
export function axisRemain(junction, axis, t) {
  const p = (((t + phaseOffset(junction.x, junction.z)) % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'b') {
    if (p < A_GREEN + A_YELLOW) return A_GREEN + A_YELLOW - p;            // B 红(0-13)剩余
    if (p >= CYCLE - B_YELLOW) return CYCLE - p + A_GREEN + A_YELLOW;     // B 黄(24-26)预告
    return 0;
  }
  if (p >= A_GREEN + A_YELLOW) return CYCLE - p;                          // A 红(13-26)剩余
  if (p >= A_GREEN) return A_GREEN + A_YELLOW - p + CYCLE - A_GREEN - A_YELLOW;  // A 黄(11-13)预告
  return 0;
}
