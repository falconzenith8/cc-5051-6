// 庆典关卡仿真：检票闸机按真实离场回执回收名额；侧门/折返/等同伴都是剧本事件；
// 每一拍记录行走帧，供事后辨认持续等待、队列交换与穿透。
import { V, solveVelocity, halfPlaneVx, closestOnSegment } from '../orca.js';
import { Grid } from '../grid.js';
import { PLAZA, buildWalls, insideRoute, trimRoute, queueSlot, refundRoute } from './venue.js';
import { FAgent, resetFIds } from './fagent.js';

export const CFG = {
  dt: 0.1,
  timeHorizon: 1.6,
  timeHorizonObst: 0.8,
  neighborRadius: 55,
  personalSpace: 3,
  cellSize: 56,
  neighborCap: 24,
  gateInterval: 7, // 闸机最快每 0.7s 过一人
  arriveR: 13,
  holdRadius: 50, // 等同伴：同伴进入此半径即汇合
  holdGiveUp: 400, // 等 40s 仍不到则放弃继续走
};

export class FestivalSim {
  constructor({ venue, script, recordEvery = 2 }) {
    resetFIds();
    this.venue = venue;
    this.script = script;
    this.recordEvery = recordEvery;
    this.tick = 0;
    this.agents = script.visitors.map((v) => new FAgent(v));
    this.bySpecId = new Map(this.agents.map((a) => [a.specId, a]));

    this.doorOpenRoute = false; // 剧本上的侧门开（决定改道资格）
    this.doorOpenPhys = false; // 物理落闸：亭内清空后才真正关
    this.walls = buildWalls(venue, false);
    this.lastAdmit = { A: -999, B: -999 };
    this.receipts = 0; // 真实离场回执数
    this.doorCrossings = []; // 狭口过线 {id, tick}
    this.events = []; // 全场事件（剧本/闸机/退票）
    this.frames = []; // 行走记录帧
    this.maxPenetration = 0;
  }

  log(tick, text, type = 'info') {
    this.events.push({ tick, text, type });
  }

  // 场内名额余量 = 容量 - 已在场内 - 已叫到还没进场的（退票会归还名额）
  credit() {
    let inside = 0;
    let calledNotIn = 0;
    for (const a of this.agents) {
      if (!a.present) continue;
      if (a.admitted && a.alive) inside++;
      else if (a.called && !a.admitted && !a.refunded) calledNotIn++;
    }
    return this.venue.capacity - inside - calledNotIn;
  }

  // 预约到访：批次成员在预约前 arriveEarly 秒到场；等候区每队至多 14 人，超出者在场外等位
  spawnDue() {
    for (const a of this.agents) {
      if (a.present || a.arriveTick > this.tick) continue;
      const onSite = this.agents.filter((x) => x.present && !x.called && x.team === a.team).length;
      if (onSite >= 14) continue;
      a.present = true;
      a.log(this.tick, `到场，在等候区等待批次 #${a.batchId} 叫号`, 'spawn');
    }
  }

  batchOf(id) {
    return this.script.batches.find((b) => b.id === id);
  }

  // ---- 剧本事件：侧门开/关 ----
  updateDoor() {
    const d = this.script.door;
    if (!d) return;
    if (this.tick === d.openTick && !this.doorOpenRoute) {
      this.doorOpenRoute = true;
      this.log(this.tick, `侧门打开（${d.openAt}s）：A 队第 ${this.script.params.divertFromBatch} 批起改道穿售票亭`, 'door');
      this.rerouteDivert(true);
    }
    if (this.tick === d.closeTick && this.doorOpenRoute) {
      this.doorOpenRoute = false;
      this.log(this.tick, '侧门关闭：未进通道者回到原路线，亭内清空后落闸', 'door');
      this.rerouteDivert(false);
    }
    // 物理落闸等亭内无人
    const boothBusy = this.agents.some(
      (a) => a.alive && a.pos.x > PLAZA.booth.x0 - 16 && a.pos.x < PLAZA.booth.x1 + 16 && a.pos.y > PLAZA.booth.y0 - 16 && a.pos.y < PLAZA.booth.y1 + 16
    );
    const phys = this.doorOpenRoute || boothBusy;
    if (phys !== this.doorOpenPhys) {
      this.doorOpenPhys = phys;
      this.walls = buildWalls(this.venue, phys);
    }
  }

  rerouteDivert(opening) {
    for (const a of this.agents) {
      if (!a.alive || a.team !== 'A' || !a.divertEligible) continue;
      if (a.state !== 'inside' && a.state !== 'entering') continue;
      if (a.pos.x >= PLAZA.booth.px0 - 16) continue; // 已到通道口的维持原路线
      const want = opening && this.doorOpenRoute;
      if (a.diverted === want) continue;
      a.diverted = want;
      a.wp = trimRoute(insideRoute(a, this.venue), a.pos);
      a.wpIndex = 0;
      a.log(this.tick, opening ? '侧门开放：改道穿售票亭，与 B 队在狭口交叉' : '侧门将关：回到绕行售票亭的原路线', 'reroute');
    }
  }

  // ---- 闸机叫号：预约 vs 回执 ----
  updateCalls() {
    for (const team of ['A', 'B']) {
      const batch = this.script.batches
        .filter((b) => b.team === team && b.calledTick === null)
        .sort((x, y) => x.apptTick - y.apptTick)[0];
      if (!batch || this.tick < batch.apptTick) continue;
      const members = this.agents.filter((a) => a.batchId === batch.id);
      if (!members.every((a) => a.present)) continue; // 等全批到场
      if (this.script.releaseMode === 'receipt' && this.credit() < batch.size) continue; // 名额没回收，等真实离场
      batch.calledTick = this.tick;
      for (const a of members) {
        a.state = 'toGate';
        a.calledTick = this.tick;
        a.log(this.tick, `批次 #${batch.id} 叫到，前往闸机`, 'call');
      }
      const mode = this.script.releaseMode === 'receipt' ? '回执放行' : '预约放行';
      this.log(this.tick, `批次 #${batch.id}（${team} 队 ${batch.size} 人）叫到（${mode}，余名额 ${this.credit()}）`, 'call');
    }
  }

  // ---- 闸机物理放行：排头贴近闸口且闸区清空才走 ----
  updateGates() {
    for (const team of ['A', 'B']) {
      const queue = this.agents
        .filter((a) => a.alive && a.team === team && (a.state === 'toGate' || a.state === 'atGate'))
        .sort((a, b) => a.calledTick - b.calledTick || a.specId - b.specId);
      queue.forEach((a, rank) => {
        a.queueRank = rank;
        const slot = queueSlot(rank, team);
        if (Math.hypot(a.pos.x - slot.x, a.pos.y - slot.y) < 12) a.state = 'atGate';
      });
      const head = queue[0];
      if (!head) continue;
      const gy = PLAZA.gateY[team];
      const zoneBusy = this.agents.some(
        (a) => a.alive && a.pos.x > 104 && a.pos.x < 142 && Math.abs(a.pos.y - gy) < 24
      );
      const nearGate = Math.hypot(head.pos.x - 96, head.pos.y - gy) < 30;
      if (!zoneBusy && nearGate && this.tick - this.lastAdmit[team] >= CFG.gateInterval) {
        head.state = 'entering';
        head.wp = insideRoute(head, this.venue);
        head.wpIndex = 0;
        this.lastAdmit[team] = this.tick;
        head.log(this.tick, '排头过闸', 'gate');
      }
    }
  }

  // ---- 等同伴 ----
  updateHolds() {
    const pair = this.script.waitPair;
    if (!pair) return;
    const stopper = this.bySpecId.get(pair.stopperId);
    const companion = this.bySpecId.get(pair.companionId);
    if (!stopper || !stopper.holding) return;
    const dist = companion && companion.alive ? Math.hypot(companion.pos.x - stopper.pos.x, companion.pos.y - stopper.pos.y) : Infinity;
    if (dist < CFG.holdRadius) {
      stopper.holding = false;
      stopper.log(this.tick, `同伴 #${pair.companionId} 汇合，继续走`, 'resume');
      this.log(this.tick, `#${pair.stopperId} 等到同伴，狭口停驻结束（停了 ${((this.tick - stopper.holdSince) * CFG.dt).toFixed(1)}s）`, 'hold');
    } else if (this.tick - stopper.holdSince > CFG.holdGiveUp || (companion && !companion.alive)) {
      stopper.holding = false;
      stopper.log(this.tick, '等不到同伴，先走', 'resume');
      this.log(this.tick, `#${pair.stopperId} 等不到同伴，放弃等待`, 'hold');
    }
  }

  // ---- 退票：叫到后超过耐心仍没进场 ----
  updateRefunds() {
    const patienceTicks = Math.round(this.venue.patience / CFG.dt);
    for (const a of this.agents) {
      if (!a.alive || !a.called || a.admitted) continue;
      if (a.state === 'refunding') continue;
      if (this.tick - a.calledTick > patienceTicks) {
        a.state = 'refunding';
        a.wp = refundRoute(a.team);
        a.wpIndex = 0;
        a.refundTick = this.tick;
        a.log(this.tick, `等 ${this.venue.patience}s 没进场，退票`, 'refund');
        this.log(this.tick, `#${a.specId}（批次 #${a.batchId}）退票，名额归还`, 'refund');
      }
    }
  }

  preferredVelocity(a) {
    const P = PLAZA;
    if (a.holding) return { x: 0, y: 0 };
    if (a.dwellUntil > this.tick) return { x: 0, y: 0 }; // 观景台驻留看演出
    if (a.state === 'waiting') {
      const d = Math.hypot(a.anchor.x - a.pos.x, a.anchor.y - a.pos.y);
      if (d < 6) return { x: 0, y: 0 };
      return V.clampLen(V.scale(V.norm(V.sub(a.anchor, a.pos)), a.maxSpeed * 0.4), a.maxSpeed);
    }
    if (a.state === 'toGate' || a.state === 'atGate') {
      const slot = queueSlot(Math.max(0, a.queueRank), a.team);
      return V.clampLen(V.scale(V.norm(V.sub(slot, a.pos)), a.maxSpeed), a.maxSpeed);
    }
    // entering / inside：靠近出口或路点耗尽时直接对准出口豁口，防止贴墙卡死
    if (a.state === 'entering' || a.state === 'inside') {
      const ey = P.exitY[this.venue.activeExit];
      if (a.pos.x > 885 || a.wpIndex >= a.wp.length) {
        const tx = a.pos.x >= 944 ? 962 : 948;
        return V.clampLen(V.scale(V.norm(V.sub({ x: tx, y: ey }, a.pos)), a.maxSpeed), a.maxSpeed);
      }
      const wp = a.wp[a.wpIndex];
      if (!wp) return { x: 0, y: 0 };
      return V.clampLen(V.scale(V.norm(V.sub(wp, a.pos)), a.maxSpeed), a.maxSpeed);
    }
    // refunding
    const wp = a.wp[a.wpIndex];
    if (!wp) return { x: 0, y: 0 };
    return V.clampLen(V.scale(V.norm(V.sub(wp, a.pos)), a.maxSpeed), a.maxSpeed);
  }

  advanceWaypoints(a) {
    const wp = a.wp[a.wpIndex];
    if (!wp) return;
    const arriveR = wp.act === 'hold' ? 6 : CFG.arriveR; // 停驻点要踩准，才堵得住狭口
    if (Math.hypot(wp.x - a.pos.x, wp.y - a.pos.y) < arriveR) {
      if (wp.act === 'hold' && a.isStopper && !a.holding && !a.holdDone) {
        a.holding = true;
        a.holdDone = true;
        a.holdSince = this.tick;
        a.holdPos = { ...a.pos }; // 站定位置：剧本停驻期间钉住，不被人群挤走
        a.log(this.tick, '在狭口出口停下等同伴', 'hold');
        this.log(this.tick, `#${a.specId} 在狭口出口停下等同伴（剧本事件）`, 'hold');
      }
      if (wp.act === 'dwell' && !a.dwellDone) {
        a.dwellDone = true;
        a.dwellUntil = this.tick + 900; // 观景台驻留 90s：折返队回执因此推迟，名额被压住
        a.log(this.tick, '观景台驻留看演出（90s）', 'dwell');
        this.log(this.tick, `#${a.specId} 观景台驻留，离场回执推迟`, 'dwell');
      }
      a.wpIndex++;
    }
  }

  extraLines(a) {
    // 闸前停车线：叫到但非排头，不得越过停车线
    if (a.state === 'toGate' || a.state === 'atGate') {
      const stopX = PLAZA.gateStopX;
      if (a.pos.x < stopX - 46) return [];
      const cap = (stopX - a.pos.x) / CFG.dt;
      return [halfPlaneVx(cap, false)];
    }
    // 等候区的人不得被挤进闸机喉部
    if (a.state === 'waiting' && a.pos.x > 66) {
      const cap = (88 - a.pos.x) / CFG.dt;
      return [halfPlaneVx(cap, false)];
    }
    // 狭口有人停驻等同伴：后来者在门西停车线排队，不许硬挤
    if (a.state === 'inside' && !a.holding && this.holdActive && a.pos.x > 396 && a.pos.x < 466) {
      const cap = (466 - a.pos.x) / CFG.dt;
      return [halfPlaneVx(cap, false)];
    }
    return [];
  }

  get holdActive() {
    return this.agents.some((a) => a.alive && a.holding);
  }

  nearbyWalls(a) {
    const out = [];
    for (const w of this.walls) {
      const q = closestOnSegment(a.pos, w);
      const dx = q.x - a.pos.x;
      const dy = q.y - a.pos.y;
      if (dx * dx + dy * dy <= (a.radius + CFG.neighborRadius) ** 2) out.push(q);
    }
    return out;
  }

  step() {
    this.tick++;
    const t = this.tick;
    for (const a of this.agents) a.lastTick = t;

    this.spawnDue();
    this.updateDoor();
    this.updateCalls();
    this.updateGates();
    this.updateHolds();
    this.updateRefunds();

    const active = this.agents.filter((a) => a.alive);
    const grid = new Grid(active, CFG.cellSize);

    for (const a of active) {
      if (a.state === 'entering' || a.state === 'inside' || a.state === 'refunding') this.advanceWaypoints(a);
      a.preferred = this.preferredVelocity(a);
      const q = grid.query(a.pos, CFG.neighborRadius, CFG.neighborCap);
      const neighbors = q.neighbors
        .filter((o) => o.id !== a.id)
        .map((o) => ({ pos: o.pos, vel: o.vel, radius: o.radius + CFG.personalSpace, priority: false }));
      const { velocity } = solveVelocity(a, neighbors, this.nearbyWalls(a), this.extraLines(a), CFG.dt, CFG.timeHorizon, CFG.timeHorizonObst);
      a.vel = velocity;
      a.prevX = a.pos.x;
      a.pos = V.add(a.pos, V.scale(velocity, CFG.dt));
      if (a.holding && a.holdPos) {
        // 剧本停驻：钉在原地，人群只能从狭口两侧绕（绕不动就排队）
        a.pos.x = a.holdPos.x;
        a.pos.y = a.holdPos.y;
        a.vel = { x: 0, y: 0 };
      }
      // 物理兜底：任何情况下都不许穿出场地外包络（离场判定在 x≥955，故 x 上限放宽）
      a.pos.x = Math.min(970, Math.max(10, a.pos.x));
      a.pos.y = Math.min(590, Math.max(10, a.pos.y));

      const speed = V.len(velocity);
      const slowNow = speed < Math.max(4, a.maxSpeed * 0.08);
      if (slowNow) {
        a._waitRun++;
        a.maxWaitRun = Math.max(a.maxWaitRun, a._waitRun);
        if (a.called && !a.done) a.waitTicks++;
        if (a.called && !a.admitted) a.queueWaitTicks++;
      } else {
        a._waitRun = 0;
      }
    }

    // 穿透统计（真实半径）
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const pen = a.radius + b.radius - Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        if (pen > 0.5) {
          a.touchTicks++;
          b.touchTicks++;
        }
        if (pen >= 2) {
          a.collisionTicks++;
          b.collisionTicks++;
          this.maxPenetration = Math.max(this.maxPenetration, pen);
        }
      }
    }

    this.crossings();

    if (t % this.recordEvery === 0) {
      this.frames.push({
        t,
        a: active.map((a) => [a.specId, Math.round(a.pos.x * 2), Math.round(a.pos.y * 2), a.stateCode]),
      });
    }
  }

  crossings() {
    const P = PLAZA;
    const ey = P.exitY[this.venue.activeExit];
    for (const a of this.agents) {
      if (!a.alive) continue;
      // 过闸入场（含被挤入的兜底：补发路线，绝不让入场者无路可走）
      if (a.called && !a.admitted && a.pos.x >= P.westX + 4 && Math.abs(a.pos.y - P.gateY[a.team]) < 26) {
        a.admitTick = this.tick;
        a.state = 'inside';
        if (a.wp.length === 0) {
          a.wp = insideRoute(a, this.venue);
          a.wpIndex = 0;
          a.log(this.tick, '被队伍挤入闸口，补发行走路线', 'gate');
        }
        a.log(this.tick, `实际入场（叫到后 ${((this.tick - a.calledTick) * CFG.dt).toFixed(1)}s）`, 'admit');
      }
      // 狭口过线
      if (a.prevX !== undefined && a.prevX < P.partitionX && a.pos.x >= P.partitionX && Math.abs(a.pos.y - 300) < 16) {
        this.doorCrossings.push({ id: a.specId, tick: this.tick });
      }
      // 离场回执
      if (!a.done && a.pos.x >= P.eastX && Math.abs(a.pos.y - ey) < P.exitHalf + 4) {
        a.done = true;
        a.exitTick = this.tick;
        this.receipts++;
        a.log(this.tick, `从出口 ${this.venue.activeExit} 离场，回执回收名额`, 'exit');
      }
      // 退票离场
      if (a.state === 'refunding' && Math.hypot(a.pos.x - P.refundPoint.x, a.pos.y - P.refundPoint.y) < 16) {
        a.refunded = true;
        a.log(this.tick, '退票离场', 'refund');
      }
    }
  }

  get allDone() {
    const allCalled = this.script.batches.every((b) => b.calledTick !== null);
    return allCalled && this.agents.every((a) => !a.present || a.done || a.refunded);
  }

  get aliveCount() {
    return this.agents.filter((a) => a.alive).length;
  }

  metrics() {
    const admitted = this.agents.filter((a) => a.admitted);
    const done = this.agents.filter((a) => a.done);
    const refunded = this.agents.filter((a) => a.refunded);
    const waits = admitted.map((a) => (a.admitTick - a.calledTick) * CFG.dt);
    const lastTick = Math.max(0, ...this.agents.map((a) => Math.max(a.exitTick, a.refundTick, 0)));
    const dc = this.doorCrossings;
    return {
      mode: this.script.releaseMode,
      visitors: this.agents.length,
      entered: admitted.length,
      exited: done.length,
      refunded: refunded.length,
      receipts: this.receipts,
      makespan: lastTick * CFG.dt,
      avgWait: waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : 0,
      maxWait: waits.length ? Math.max(...waits) : 0,
      doorCrossings: dc.length,
      doorThroughput: dc.length > 1 ? (dc.length - 1) / ((dc[dc.length - 1].tick - dc[0].tick) * CFG.dt) : 0,
      collisions: this.agents.reduce((s, a) => s + a.collisionTicks, 0) / 2,
      maxPenetration: this.maxPenetration,
    };
  }
}

// 无头跑到结束
export function runToEnd(venue, script, { maxTicks = 20000, recordEvery = 2 } = {}) {
  const sim = new FestivalSim({ venue, script, recordEvery });
  while (!sim.allDone && sim.tick < maxTicks) sim.step();
  return sim;
}
