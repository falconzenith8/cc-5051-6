// 反向打开：从一个真正开始滞留的角色，倒查影响它的邻居与剧本事件，
// 把线索分成「场地」与「演出节奏」两组，作者据此决定改哪边。
import { CFG } from './fsim.js';

export function traceAgent(sim, analysis, specId) {
  const a = sim.agents.find((x) => x.specId === specId);
  if (!a) return null;
  const batch = sim.batchOf(a.batchId);
  const waitInfo = analysis?.waits?.[specId] ?? null;
  const longest = waitInfo?.longest ?? null;
  const t0 = longest ? longest.t0 : Math.max(0, a.calledTick);
  const t1 = longest ? longest.t1 : t0 + a.maxWaitRun;

  // 1) 滞留窗口中段的实际邻居（从行走记录里找，不是现在的快照）
  let blockers = [];
  if (analysis && sim.frames.length) {
    const mid = Math.round((t0 + t1) / 2);
    let frame = sim.frames[0];
    for (const f of sim.frames) {
      if (f.t <= mid) frame = f;
      else break;
    }
    const me = frame.a.find((r) => r[0] === specId);
    if (me) {
      blockers = frame.a
        .filter((r) => r[0] !== specId)
        .map((r) => {
          const m = analysis.meta.get(r[0]);
          return {
            id: r[0],
            team: m?.team,
            batchId: m?.batchId,
            d: Math.hypot((r[1] - me[1]) / 2, (r[2] - me[2]) / 2),
          };
        })
        .filter((b) => b.d < 70)
        .sort((x, y) => x.d - y.d)
        .slice(0, 6);
    }
  }

  // 2) 窗口前 20s 起的剧本/闸机事件（含本批叫号，因果不只看同时刻）
  const events = sim.events.filter((e) => e.tick >= t0 - 200 && e.tick <= t1 + 10);
  const callEv = sim.events.find((e) => e.type === 'call' && e.text.includes(`批次 #${a.batchId} `));
  if (callEv && !events.includes(callEv)) events.unshift(callEv);

  // 3) 归因线索：场地 vs 节奏
  const venue = [];
  const rhythm = [];
  const s = sim.script;
  const inWindow = (tick) => tick >= t0 - 50 && tick <= t1 + 10;
  if (s.door && (inWindow(s.door.openTick) || inWindow(s.door.closeTick) || (s.door.openTick < t0 && s.door.closeTick > t1))) {
    venue.push(`侧门在滞留窗口内${s.door.openTick < t0 ? '保持' : ''}开放（${s.door.openAt}s 起 ${s.door.duration}s），A 队改道与 B 队交叉`);
  }
  if (sim.venue.laneLocked) venue.push('无障碍通道已锁，慢角色汇入普通队伍');
  if (sim.venue.activeExit === 'NE') venue.push('出口在东北角，路线更长，场内占用时间更久');
  venue.push(`场内名额 ${sim.venue.capacity}，当前余量 ${sim.credit()}`);
  if (batch.detour) rhythm.push(`批次 #${batch.id} 在折返窗口内，绕观景台，回执更晚`);
  if (s.waitPair && s.waitPair.batchId === a.batchId) rhythm.push(`本批有等同伴事件（#${s.waitPair.stopperId} 等 #${s.waitPair.companionId}）`);
  else if (s.waitPair) rhythm.push(`B 队批次 #${s.waitPair.batchId} 的等同伴事件可能堵在狭口`);
  rhythm.push(`批次预约间隔 ${s.params.interval}s、每批 ${s.params.batchSize} 人、${s.releaseMode === 'receipt' ? '回执放行' : '预约放行'}`);
  if (a.slow) rhythm.push('本人行动较慢');

  return {
    id: specId,
    team: a.team,
    batchId: a.batchId,
    batch,
    wait: longest ? { from: +(longest.t0 * CFG.dt).toFixed(1), to: +(longest.t1 * CFG.dt).toFixed(1), at: { x: Math.round(longest.x), y: Math.round(longest.y) } } : null,
    totalWait: +(a.waitTicks * CFG.dt).toFixed(1),
    blockers,
    events,
    venue,
    rhythm,
  };
}
