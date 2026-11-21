// 庆典广场 · 源布局。布局本体是可入库的纯数据（makeVenue），
// 墙体与路线都由布局推导，因此换出口 / 锁无障碍通道后重演，队伍去向随场地实际改变。

export const PLAZA = {
  width: 960,
  height: 600,
  westX: 120, // 场界西墙（闸机所在），墙外是等候区
  eastX: 955,
  topY: 8,
  bottomY: 592,
  gateY: { A: 120, B: 480 }, // 两座检票闸机：A 队北口、B 队南口
  gateHalf: 14,
  gateStopX: 100, // 闸前停车线（未轮到不得越过）
  exitY: { E: 300, NE: 120 }, // 两处可换的出口，同一时刻只开一处，两队共用
  exitHalf: 14,
  booth: { x0: 300, x1: 380, y0: 260, y1: 340, px0: 326, px1: 354 }, // 售票亭 + 可临时打开的侧门通道
  partitionX: 480, // 广场与排队区之间的隔墙
  doorY0: 286,
  doorY1: 314, // 隔墙上的狭口（主门），两队同向汇入
  lane: { x0: 132, x1: 452, y0: 542, y1: 578 }, // 无障碍通道（南侧平直步道）
  platform: { E: { x: 860, y: 92 }, NE: { x: 860, y: 492 } }, // 折返观景台：总在与出口相反的一角
  refundPoint: { x: 24, y: 300 }, // 退票离场点
};

// 可入库的场地数据：只放作者可编辑的字段
export function makeVenue(over = {}) {
  return {
    kind: 'venue',
    name: over.name ?? '庆典广场',
    activeExit: over.activeExit ?? 'E', // 'E' | 'NE'
    laneLocked: over.laneLocked ?? false, // 锁住无障碍通道
    capacity: over.capacity ?? 44, // 场内名额：回执放行按真实离场回收
    patience: over.patience ?? 75, // 叫到后多少秒进不了场就退票
  };
}

// 由布局 + 侧门物理状态推导墙体。侧门先对路线关闭，亭内清空后才真正落闸。
export function buildWalls(venue, doorOpenPhys) {
  const P = PLAZA;
  const B = P.booth;
  const W = [];
  const seg = (x0, y0, x1, y1, tag) => W.push({ x0, y0, x1, y1, tag });

  // 场界
  seg(0, P.topY, P.eastX, P.topY, 'outer');
  seg(0, P.bottomY, P.eastX, P.bottomY, 'outer');
  seg(8, P.topY, 8, P.bottomY, 'outer');
  // 西墙（两个闸机口）
  const gA = P.gateY.A, gB = P.gateY.B, h = P.gateHalf;
  seg(P.westX, P.topY, P.westX, gA - h, 'wall');
  seg(P.westX, gA + h, P.westX, gB - h, 'wall');
  seg(P.westX, gB + h, P.westX, P.bottomY, 'wall');
  // 东墙（只开当前出口）
  const ey = P.exitY[venue.activeExit];
  const eh = P.exitHalf;
  seg(P.eastX, P.topY, P.eastX, ey - eh, 'wall');
  seg(P.eastX, ey + eh, P.eastX, P.bottomY, 'wall');
  // 售票亭：侧门打开时南北墙留口并加通道侧壁
  if (doorOpenPhys) {
    seg(B.x0, B.y0, B.px0, B.y0, 'booth');
    seg(B.px1, B.y0, B.x1, B.y0, 'booth');
    seg(B.x0, B.y1, B.px0, B.y1, 'booth');
    seg(B.px1, B.y1, B.x1, B.y1, 'booth');
    seg(B.px0, B.y0, B.px0, B.y1, 'passage');
    seg(B.px1, B.y0, B.px1, B.y1, 'passage');
  } else {
    seg(B.x0, B.y0, B.x1, B.y0, 'booth');
    seg(B.x0, B.y1, B.x1, B.y1, 'booth');
  }
  seg(B.x0, B.y0, B.x0, B.y1, 'booth');
  seg(B.x1, B.y0, B.x1, B.y1, 'booth');
  // 隔墙与狭口
  seg(P.partitionX, P.topY, P.partitionX, P.doorY0, 'wall');
  seg(P.partitionX, P.doorY1, P.partitionX, P.bottomY, 'wall');
  // 无障碍通道被锁住：南口封一段矮栏
  if (venue.laneLocked) seg(P.lane.x0, P.lane.y0 - 12, P.lane.x0, P.bottomY, 'laneBlock');
  return W;
}

const wp = (x, y, act) => ({ x, y, ...(act ? { act } : {}) });

// 场内路线：由布局实时推导。agent 上的 diverted / detour / slow 决定走哪条。
export function insideRoute(agent, venue) {
  const P = PLAZA;
  const r = [];
  if (agent.team === 'A') {
    if (agent.diverted) {
      // 侧门开放：穿过售票亭通道，在南侧狭口出口与 B 队交叉
      r.push(wp(275, 190), wp(322, 242), wp(340, 270), wp(340, 330), wp(372, 372), wp(428, 414), wp(450, 358), wp(452, 305));
    } else {
      r.push(wp(175, 150), wp(275, 190), wp(415, 215), wp(452, 300));
    }
  } else if (agent.slow && !venue.laneLocked) {
    // 无障碍通道：平直、避开售票亭人流
    r.push(wp(150, 560), wp(428, 560), wp(450, 430), wp(452, 320));
  } else {
    r.push(wp(175, 465), wp(295, 432), wp(408, 402), wp(448, 352), wp(452, 308));
  }
  // 狭口（两队共用）；等同伴事件的停驻点就在门口，能真实堵住瓶颈
  r.push(wp(482, 300, agent.isStopper ? 'hold' : undefined));
  r.push(wp(505, 300));
  // 折返：先去观景台驻留看演出再回出口
  if (agent.detour) {
    const p = P.platform[venue.activeExit];
    r.push(wp(700, venue.activeExit === 'E' ? 300 : 240));
    r.push(wp(p.x, p.y, 'dwell'));
  }
  // 共用出口
  if (venue.activeExit === 'E') r.push(wp(700, 300), wp(930, 300), wp(962, 300));
  else r.push(wp(655, 225), wp(805, 152), wp(930, 120), wp(962, 120));
  return r;
}

// 丢掉已经走过的路点（改道重排时用）
export function trimRoute(route, pos) {
  let i = 0;
  while (i < route.length - 1 && route[i].x < pos.x - 30) i++;
  return route.slice(i);
}

export function queueSlot(rank, team) {
  const gy = PLAZA.gateY[team];
  if (rank === 0) return { x: 96, y: gy };
  // 队列向场心方向扇形排开（A 队往南、B 队往北），不挡等候区与闸机喉部
  const k = rank - 1;
  const col = Math.min(Math.floor(k / 4), 3);
  const row = k % 4;
  const dy = 27 * (row + 1) * (team === 'A' ? 1 : -1);
  return { x: 96 - 24 * (col + 1), y: gy + dy };
}

export function refundRoute(team) {
  const gy = PLAZA.gateY[team];
  return [wp(56, gy), wp(PLAZA.refundPoint.x, PLAZA.refundPoint.y)];
}
