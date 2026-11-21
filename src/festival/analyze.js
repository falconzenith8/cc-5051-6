// 依实际行走记录（回放帧）辨认：持续等待、队列交换、穿透、狭口通量。
// 分析只读 frames，不碰仿真状态——换场景重放同一记录结果一致。
import { CFG } from './fsim.js';

const FRAME_DT = () => null; // 帧间隔由调用方给（recordEvery * dt）

// 持续等待：连续位移 < 0.8px/帧 的片段，≥ minRunFrames（默认 3 秒）
export function sustainedWaits(frames, frameDt, minRunSec = 3) {
  const minRun = Math.ceil(minRunSec / frameDt);
  const tracks = new Map(); // id -> [{t,x,y}]
  for (const f of frames) {
    for (const [id, x2, y2] of f.a) {
      if (!tracks.has(id)) tracks.set(id, []);
      tracks.get(id).push({ t: f.t, x: x2 / 2, y: y2 / 2 });
    }
  }
  const out = {};
  for (const [id, pts] of tracks) {
    const runs = [];
    let run = null;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const still = d < 0.8;
      if (still && !run) run = { t0: pts[i - 1].t, x: pts[i].x, y: pts[i].y };
      if (!still && run) {
        run.t1 = pts[i - 1].t;
        if (run.t1 - run.t0 >= minRun) runs.push(run);
        run = null;
      }
    }
    if (run) {
      run.t1 = pts[pts.length - 1].t;
      if (run.t1 - run.t0 >= minRun) runs.push(run);
    }
    if (runs.length) {
      out[id] = {
        runs,
        longest: runs.reduce((m, r) => (r.t1 - r.t0 > m.t1 - m.t0 ? r : m), runs[0]),
        total: runs.reduce((s, r) => s + (r.t1 - r.t0), 0),
      };
    }
  }
  return out;
}

// 队列交换：同队两人的东西向先后次序发生持续倒置（≥12px 间隔、连续 ≥2s 才算一次超越）
export function queueExchanges(frames, metaById, frameDt = 0.2) {
  const minHold = Math.ceil(2 / frameDt); // 连续帧数
  const pairs = new Map(); // key -> {sign, run, flipped}
  const events = [];
  for (const f of frames) {
    const byTeam = { A: [], B: [] };
    for (const [id, x2] of f.a) {
      const m = metaById.get(id);
      if (m) byTeam[m.team].push({ id, x: x2 / 2 });
    }
    for (const team of ['A', 'B']) {
      const list = byTeam[team];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const d = a.x - b.x;
          if (Math.abs(d) < 12) continue; // 迟滞带：贴在一起的不算
          const sign = d > 0 ? 1 : -1;
          const key = `${team}-${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
          let p = pairs.get(key);
          if (!p) {
            pairs.set(key, { sign, run: 0, flipped: false });
            continue;
          }
          if (sign === p.sign) {
            p.run = 0;
          } else {
            p.run++;
            if (p.run >= minHold && !p.flipped) {
              p.flipped = true;
              events.push({ tick: f.t, a: a.id, b: b.id, team });
            }
          }
        }
      }
    }
  }
  return events;
}

// 穿透：帧内两两真实半径重叠 ≥2px；返回拍数与最大深度
export function penetrations(frames, metaById) {
  let pairFrames = 0;
  let maxDepth = 0;
  let worst = null;
  for (const f of frames) {
    const pts = f.a;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const A = pts[i];
        const B = pts[j];
        const ma = metaById.get(A[0]);
        const mb = metaById.get(B[0]);
        if (!ma || !mb) continue;
        const dx = (A[1] - B[1]) / 2;
        const dy = (A[2] - B[2]) / 2;
        const depth = ma.radius + mb.radius - Math.hypot(dx, dy);
        if (depth >= 2) {
          pairFrames++;
          if (depth > maxDepth) {
            maxDepth = depth;
            worst = { tick: f.t, a: A[0], b: B[0], depth };
          }
        }
      }
    }
  }
  return { pairFrames, maxDepth, worst };
}

// 狭口通量：过线记录 → 总通量与 10s 窗口序列
export function doorThroughput(doorCrossings, windowSec = 10) {
  if (doorCrossings.length < 2) return { overall: 0, windows: [] };
  const t0 = doorCrossings[0].tick;
  const t1 = doorCrossings[doorCrossings.length - 1].tick;
  const overall = (doorCrossings.length - 1) / ((t1 - t0) * CFG.dt);
  const buckets = new Map();
  const wTicks = Math.round(windowSec / CFG.dt);
  for (const c of doorCrossings) {
    const k = Math.floor(c.tick / wTicks);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const windows = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => ({ from: k * windowSec, count: n, rate: n / windowSec }));
  return { overall, windows };
}

export function buildMeta(agents) {
  const m = new Map();
  for (const a of agents) m.set(a.specId, { team: a.team, radius: a.radius, batchId: a.batchId, slow: a.slow });
  return m;
}

export function analyzeAll(sim) {
  const frameDt = sim.recordEvery * CFG.dt;
  const meta = buildMeta(sim.agents);
  return {
    waits: sustainedWaits(sim.frames, frameDt),
    exchanges: queueExchanges(sim.frames, meta, frameDt),
    penetration: penetrations(sim.frames, meta),
    throughput: doorThroughput(sim.doorCrossings),
    meta,
  };
}
