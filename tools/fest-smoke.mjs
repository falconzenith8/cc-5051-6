// 庆典关卡无头冒烟：种子一致性、确定性、两种放行只在折返时不同、
// 等待事件压通量、换出口改去向、记录辨认、库往返、影响链。
import { makeVenue } from '../src/festival/venue.js';
import { generateScript, PRESETS } from '../src/festival/script.js';
import { runToEnd, CFG } from '../src/festival/fsim.js';
import { analyzeAll } from '../src/festival/analyze.js';
import { reconcileModes } from '../src/festival/reconcile.js';
import { traceAgent } from '../src/festival/trace.js';
import { Library } from '../src/festival/library.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
  if (!cond) failures++;
};

const base = { seed: 42, releaseMode: 'receipt' };

// 1) 同种子两场：访客逐人属性一致（密度相近），剧本不同
{
  const s1 = generateScript({ ...base, ...PRESETS.smooth });
  const s2 = generateScript({ ...base, ...PRESETS.jammed });
  const same =
    s1.visitors.length === s2.visitors.length &&
    s1.visitors.every((v, i) => {
      const w = s2.visitors[i];
      return v.team === w.team && v.radius === w.radius && v.maxSpeed === w.maxSpeed && v.slow === w.slow;
    });
  check('同种子两场访客逐人一致', same, `${s1.visitors.length} 人`);
  check('两场剧本事件不同', !s1.door && !!s2.door && !!s2.detour && !!s2.waitPair);
}

// 2) 顺畅场跑完 + 确定性
{
  const venue = makeVenue();
  const a = runToEnd(venue, generateScript({ ...base, ...PRESETS.smooth }, venue));
  const b = runToEnd(venue, generateScript({ ...base, ...PRESETS.smooth }, venue));
  const m = a.metrics();
  check('顺畅场全部有去向', a.allDone, `入场 ${m.entered}/${m.visitors} 退票 ${m.refunded}`);
  check('确定性：两次重演逐人离场时刻一致', a.agents.every((x, i) => x.exitTick === b.agents[i].exitTick && x.admitTick === b.agents[i].admitTick));
  console.log(`       顺畅: 清空=${m.makespan.toFixed(1)}s 狭口通量=${m.doorThroughput.toFixed(2)}/s 退票=${m.refunded} 穿透=${m.collisions}`);
}

// 3) 两种放行：无折返应一致，有折返应不同
{
  const venue = makeVenue();
  const noDetour = { ...base, door: null, detour: null, waitEvent: false };
  const s1 = runToEnd(venue, generateScript({ ...noDetour, releaseMode: 'scheduled' }, venue));
  const r1 = runToEnd(venue, generateScript({ ...noDetour, releaseMode: 'receipt' }, venue));
  const sameNoDetour = s1.script.batches.every((b, i) => b.calledTick === r1.script.batches[i].calledTick);
  check('无折返：预约与回执逐批叫到时刻一致', sameNoDetour);

  const withDetour = { ...noDetour, detour: { team: 'A', from: 8, to: 90 } };
  const s2 = runToEnd(venue, generateScript({ ...withDetour, releaseMode: 'scheduled' }, venue));
  const r2 = runToEnd(venue, generateScript({ ...withDetour, releaseMode: 'receipt' }, venue));
  const diffDetour = s2.script.batches.some((b, i) => b.calledTick !== r2.script.batches[i].calledTick);
  check('有折返：两模式叫到时刻出现分歧', diffDetour);
  const rows = reconcileModes(s2, r2);
  const refundDiff = rows.filter((x) => x.scheduled.refund || x.receipt.refund).length;
  console.log(`       折返: 对账差异行=${rows.filter((x) => x.scheduled.called !== x.receipt.called).length} 退票行=${refundDiff} 回执退票=${r2.metrics().refunded}`);
}

// 4) 等同伴事件压低同一瓶颈通量（比较停驻窗口内的狭口过线数）
{
  const venue = makeVenue({ laneLocked: true });
  const p = { ...base, ...PRESETS.jammed, seed: 42 };
  const withW = runToEnd(venue, generateScript({ ...p, waitEvent: true }, venue));
  const without = runToEnd(venue, generateScript({ ...p, waitEvent: false }, venue));
  const stopper = withW.agents.find((a) => a.isStopper);
  check('停驻者产生了停驻记录', stopper && stopper.events.some((e) => e.type === 'hold'));
  const holdStart = withW.events.find((e) => e.type === 'hold')?.tick ?? 0;
  const holdEndEv = withW.events.filter((e) => e.type === 'hold').pop();
  const holdEnd = holdEndEv?.tick ?? holdStart;
  const inWindow = (sim) => sim.doorCrossings.filter((c) => c.tick >= holdStart && c.tick <= holdEnd).length;
  const wIn = inWindow(withW);
  const woIn = inWindow(without);
  check('停驻窗口内狭口通量被压低', wIn < woIn * 0.5, `窗口 ${(holdEnd - holdStart) / 10}s：有等待 ${wIn} 人次 / 无等待 ${woIn} 人次`);
}

// 5) 换出口：重新生成后去向改变
{
  const v1 = makeVenue({ activeExit: 'E' });
  const v2 = makeVenue({ activeExit: 'NE' });
  const p = { ...base, ...PRESETS.smooth };
  const r1 = runToEnd(v1, generateScript(p, v1));
  const r2 = runToEnd(v2, generateScript(p, v2));
  const t1 = r1.agents.filter((a) => a.done).every((a) => Math.abs(a.pos.y - 300) < 30);
  const t2 = r2.agents.filter((a) => a.done).every((a) => Math.abs(a.pos.y - 120) < 30);
  check('换出口后队伍最终去向随场地改变', t1 && t2 && r1.metrics().exited > 0 && r2.metrics().exited > 0);
}

// 6) 拥堵场：记录辨认出持续等待与队列交换；影响链可用
{
  const venue = makeVenue({ laneLocked: true });
  const sim = runToEnd(venue, generateScript({ ...base, ...PRESETS.jammed }, venue));
  const an = analyzeAll(sim);
  const m = sim.metrics();
  check('拥堵场跑完', sim.allDone, `入场 ${m.entered}/${m.visitors} 退票 ${m.refunded}`);
  check('辨认出持续等待', Object.keys(an.waits).length > 0, `${Object.keys(an.waits).length} 人`);
  check('辨认出队列交换', an.exchanges.length > 0, `${an.exchanges.length} 次`);
  console.log(`       拥堵: 清空=${m.makespan.toFixed(1)}s 通量=${m.doorThroughput.toFixed(2)}/s 穿透拍=${an.penetration.pairFrames} 最深=${an.penetration.maxDepth.toFixed(1)}px`);
  const stuckId = Object.entries(an.waits).sort((a, b) => b[1].total - a[1].total)[0]?.[0];
  if (stuckId) {
    const tr = traceAgent(sim, an, +stuckId);
    check('影响链返回邻居与事件', tr && tr.events.length >= 0 && Array.isArray(tr.blockers), `邻居 ${tr.blockers.length} 事件 ${tr.events.length}`);
    check('影响链区分场地与节奏', tr.venue.length > 0 && tr.rhythm.length > 0);
  } else {
    check('影响链返回邻居与事件', false, '没有滞留者');
  }
}

// 7) 库：布局/生成器/回放三类往返
{
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const lib = new Library(storage);
  const venue = makeVenue({ activeExit: 'NE', laneLocked: true });
  lib.save('layout', '测试布局', venue);
  const script = generateScript({ ...base, ...PRESETS.jammed }, venue);
  lib.save('generator', '测试生成器', { params: script.params });
  const sim = runToEnd(venue, generateScript({ ...base, ...PRESETS.smooth }, venue));
  lib.save('replay', '测试回放', { venue, scriptParams: script.params, frames: sim.frames, meta: [], events: sim.events });
  const list = lib.list();
  check('库三类条目都在', list.length === 3, list.map((e) => e.kind).join(','));
  const g = lib.get(list.find((e) => e.kind === 'generator').id);
  const rebuilt = generateScript(g.payload.params, makeVenue());
  check('生成器入库后可重建同一剧本', rebuilt.visitors.length === script.visitors.length && rebuilt.batches.every((b, i) => b.apptTick === script.batches[i].apptTick));
  const round = lib.import(lib.export(list[0].id));
  check('导出再导入', !!round && lib.list().length === 4);
}

// 8) 退票确实会发生（回执 + 折返 + 小容量）
{
  const venue = makeVenue({ capacity: 24, patience: 40 });
  const p = { ...base, detour: { team: 'A', from: 20, to: 90 }, interval: 14 };
  const sim = runToEnd(venue, generateScript(p, venue));
  check('回执+折返+小容量出现退票', sim.metrics().refunded > 0, `退票 ${sim.metrics().refunded}`);
}

process.exit(failures ? 1 : 0);
