// 事件生成器：同一种子生成完全一致的批次、访客与剧本事件，可入库、可重演。
import { makeRng } from '../config.js';

export const DEFAULTS = {
  seed: 42,
  releaseMode: 'receipt', // 'scheduled' 按剧本预约放行 | 'receipt' 按真实过闸/离场回执放行
  batchesPerTeam: 6,
  batchSize: 6,
  firstAt: 8, // 首批预约（秒）
  interval: 18, // 同队相邻批次预约间隔（秒）
  arriveEarly: 6, // 批次提前多少秒到等候区
  teamSpeed: { A: 1, B: 1 }, // 团体速度倍率
  door: null, // { openAt, duration } 秒；null = 侧门不开
  divertFromBatch: 3, // A 队第几批起（含）具备改道资格
  detour: null, // { team:'A', from, to } 秒：预约落在窗口内的批次临时折返
  waitEvent: false, // 团体中一名角色中途停下等同伴
};

export const PRESETS = {
  smooth: {
    label: '顺畅场',
    door: null,
    detour: null,
    waitEvent: false,
    laneLocked: false,
  },
  jammed: {
    label: '拥堵场',
    door: { openAt: 45, duration: 40 },
    divertFromBatch: 2,
    detour: { team: 'A', from: 8, to: 90 },
    waitEvent: true,
    laneLocked: true,
  },
};

// 生成剧本（纯数据，可入库）。venue 只读，不改。
export function generateScript(params = {}, venue) {
  const p = { ...DEFAULTS, ...params, teamSpeed: { ...DEFAULTS.teamSpeed, ...(params.teamSpeed ?? {}) } };
  const rng = makeRng(p.seed);
  const dt = 0.1;
  const batches = [];
  const visitors = [];
  let vid = 1;
  let batchId = 1;

  for (const team of ['A', 'B']) {
    for (let k = 0; k < p.batchesPerTeam; k++) {
      const apptSec = p.firstAt + k * p.interval + (team === 'B' ? p.interval / 2 : 0);
      const batch = {
        id: batchId++,
        team,
        size: p.batchSize,
        apptTick: Math.round(apptSec / dt),
        calledTick: null,
        detour: !!(p.detour && p.detour.team === team && apptSec >= p.detour.from && apptSec <= p.detour.to),
      };
      for (let m = 0; m < p.batchSize; m++) {
        const slow = rng() < 0.28;
        const radius = 9 + rng() * 4;
        const maxSpeed =
          (55 + rng() * 20) * (slow ? 0.55 : 1) * p.teamSpeed[team];
        const maxAccel = 300 + rng() * 120;
        // 等候区锚点槽位表：两队分踞西北/西南，远离闸机喉部与队列通道，离墙有余量
        const slot = (k * p.batchSize + m) % 16;
        const col = slot % 4;
        const row = Math.floor(slot / 4);
        const rows = team === 'A' ? [30, 56, 82, 264] : [570, 544, 518, 336];
        const ax = 18 + col * 28 + (rng() - 0.5) * 10;
        const ay = rows[row] + (rng() - 0.5) * 10;
        visitors.push({
          id: vid++,
          batchId: batch.id,
          team,
          slow,
          radius,
          maxSpeed,
          maxAccel,
          spawn: { x: ax, y: ay },
          arriveTick: Math.round((apptSec - p.arriveEarly) / dt),
          detour: batch.detour,
          divertEligible: team === 'A' && k + 1 >= (p.divertFromBatch ?? 3),
        });
      }
      batches.push(batch);
    }
  }
  batches.sort((a, b) => a.apptTick - b.apptTick || a.id - b.id);

  // 等同伴事件：B 队第 2 批，排头在狭口出口停下，等队尾最慢的一名
  let waitPair = null;
  if (p.waitEvent) {
    const batch = batches.filter((b) => b.team === 'B')[1] ?? batches[0];
    const members = visitors.filter((v) => v.batchId === batch.id);
    const stopper = members[0];
    const companion = [...members].sort((a, b) => a.maxSpeed - b.maxSpeed)[0];
    waitPair = { batchId: batch.id, stopperId: stopper.id, companionId: companion.id };
    stopper.isStopper = true;
    companion.isCompanion = true;
  }

  return {
    kind: 'script',
    seed: p.seed,
    releaseMode: p.releaseMode,
    teamSpeed: p.teamSpeed,
    batches,
    visitors,
    door: p.door
      ? {
          openTick: Math.round(p.door.openAt / dt),
          closeTick: Math.round((p.door.openAt + p.door.duration) / dt),
          openAt: p.door.openAt,
          duration: p.door.duration,
        }
      : null,
    detour: p.detour,
    waitPair,
    params: p, // 生成器参数原样保留，入库后可重建
  };
}
