// tools/floorcalc.mjs — 按公开层高推算紫峰各功能层标高，定出形体分段转折点
// 依据：1-6F 商场 6m；8-9F 健身；10-41F 办公 4.2m；42-71F 酒店 3.8m；
//      72F 观光厅（实测 281.8 m，用于校准）；机械层/避难层：11-12、42-43、73-75、85-86F
const rows = [];
let y = 0;
const push = (name, h) => { rows.push({ name, from: y, to: y + h }); y += h; };
push('1F-7F 商场/宴会 (7层x6m)', 7 * 6);
push('8-9F 健身/泳池/SPA', 2 * 4.2);
push('10F 办公', 4.2);
push('11-12F 机械层+避难层', 2 * 5.0);
push('15-41F 办公 (27层x4.2m)', 27 * 4.2);
push('42-43F 机械层', 2 * 5.0);
push('45-46F 空中大堂/餐厅', 2 * 3.8);
push('47F 咖啡吧', 3.8);
push('49-71F 酒店客房 (23层x3.8m)', 23 * 3.8);
push('72F 观光厅', 3.8);
push('73-75F 机械层', 3 * 5.0);
push('76-79F 餐厅', 4 * 3.8);
push('80-81F 行政套房', 2 * 3.8);
push('82F MOUNT CLUB', 3.8);
push('83F 水箱层', 5.0);
push('85-86F 机械层', 2 * 5.0);
push('87-89F 灯塔', 3 * 5.0);
console.log('功能层                          起(m)    止(m)');
for (const r of rows) console.log(r.name.padEnd(32) + r.from.toFixed(1).padStart(7) + r.to.toFixed(1).padStart(7));
console.log('');
console.log('推算屋顶 = ' + y.toFixed(1) + ' m （实测 381 m）');
console.log('但 72F 观光厅推算起始 286.8 m vs 实测 281.8 m → 用实测反推更准：');
const k = 281.8 / 286.8;
console.log('校准系数 k = ' + k.toFixed(4));
console.log('');
console.log('校准后形体分段转折点（★ = 机械层/避难层/观光厅，形体的阶梯收进点）：');
const pts = [
  ['第1转折 11-12F 机械层+避难层', 54.6],
  ['第2转折 42-43F 机械层（办公→酒店）', 178.0],
  ['第3转折 47F 咖啡吧（酒店段起）', 195.6],
  ['★ 72F 观光厅（酒店→观光，实测 281.8 m）', 286.8],
  ['第4转折 73-75F 机械层', 290.6],
  ['顶部机械层 85-86F', 337.2],
  ['87-89F 灯塔段', 347.2],
  ['屋顶 381 m（实测）', 381],
];
for (const [n, h] of pts) console.log('  ' + n.padEnd(40) + (h * k).toFixed(0).padStart(5) + ' m');
console.log('');
console.log('屋顶：推算 ' + (y * k).toFixed(1) + ' m / 实测 381 m → 末端再线性拉伸补足 ' + (381 / (y * k)).toFixed(4));
