// 世界几何与全局参数。窄口（门区）高度只容单人单列通过。
export const WORLD = {
  width: 960,
  height: 600,
  gate: {
    x0: 463,
    x1: 497,
    halfH: 14, // 门区半高，内高 28：最大个体(半径13)贴墙可过，但任意两人半径和≥18无法并排，强制单列
  },
  corridorHalf: 260, // 上下走廊半高
};

export const G = WORLD.gate;

// 墙体：上、下两段外墙夹出中间的门
export const WALLS = [
  { x0: 0, y0: G.halfH, x1: G.x0, y1: G.halfH },
  { x0: G.x1, y0: G.halfH, x1: WORLD.width, y1: G.halfH },
  { x0: 0, y0: -G.halfH, x1: G.x0, y1: -G.halfH },
  { x0: G.x1, y0: -G.halfH, x1: WORLD.width, y1: -G.halfH },
];

export const CONFIG = {
  dt: 0.1,
  timeHorizon: 1.6,
  timeHorizonObst: 0.8,
  neighborRadius: 55,
  personalSpace: 3, // ORCA 避让时给每个邻居额外留出的个人间隙（px），物理半径不变
  baseRadius: [9, 13],
  baseMaxSpeed: [55, 75], // px/s，慢角色乘 0.55
  slowFactor: 0.55,
  slowFraction: 0.28,
  accelRange: [300, 420],
  arrivalRadius: 16,
  stopGap: 6, // 停车线到墙体的间距
  infeasibleLimit: 15, // 局部连续无解多少拍后撤回许可
  courtesySwitchDelay: 12, // 礼让：本向清空后多少拍换向
  batchSize: 3, // 分批：每批人数
  gateSpacing: 10, // 窄门单列：相邻持证者的最小身位间隙
  cellSize: 56,
  denseNeighborCap: 8,
  sparseCap: 24,
  eventRingSparse: 200,
  eventRingDense: 60,
};

// 方向感知的门区阶段：before=尚未进入自己一侧的门线，inside=门内，after=已穿过
export function gatePhase(p, dir) {
  if (p.x >= G.x0 && p.x <= G.x1 && Math.abs(p.y) <= G.halfH + 1) return 'inside';
  if (dir === 'east') return p.x < G.x0 ? 'before' : 'after';
  return p.x > G.x1 ? 'before' : 'after';
}

// 东向停车线（从西侧接近门）
export function stopXEast(r) {
  return G.x0 - r - CONFIG.stopGap;
}
// 西向停车线（从东侧接近门）
export function stopXWest(r) {
  return G.x1 + r + CONFIG.stopGap;
}

export function gateCenterX() {
  return (G.x0 + G.x1) / 2;
}

// 确定性 LCG，保证两种规则跑出来客序列完全一致
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
