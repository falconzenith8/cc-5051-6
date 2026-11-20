import { CONFIG, WORLD, WALLS, G, stopXEast, stopXWest, gateCenterX, makeRng } from './config.js';
import { V, solveVelocity, halfPlaneVx, closestOnSegment } from './orca.js';
import { Agent, resetIds } from './agent.js';
import { Grid } from './grid.js';
import { Scheduler } from './scheduler.js';

// 生成完全确定的来客计划：两种规则跑同一份序列
export function makeSpawnPlan(n, seed) {
  const rng = makeRng(seed);
  const plan = [];
  let tick = 10;
  for (let i = 0; i < n; i++) {
    const dir = rng() < 0.5 ? 'east' : 'west';
    const side = rng() < 0.5 ? 'north' : 'south';
    const radius = CONFIG.baseRadius[0] + rng() * (CONFIG.baseRadius[1] - CONFIG.baseRadius[0]);
    const slow = rng() < CONFIG.slowFraction;
    const maxSpeed =
      (CONFIG.baseMaxSpeed[0] + rng() * (CONFIG.baseMaxSpeed[1] - CONFIG.baseMaxSpeed[0])) *
      (slow ? CONFIG.slowFactor : 1);
    const maxAccel = CONFIG.accelRange[0] + rng() * (CONFIG.accelRange[1] - CONFIG.accelRange[0]);
    const spawn =
      dir === 'east'
        ? { x: 30 + rng() * 30, y: (side === 'north' ? 1 : -1) * (60 + rng() * (WORLD.corridorHalf - 90)) }
        : { x: WORLD.width - 30 - rng() * 30, y: (side === 'north' ? 1 : -1) * (60 + rng() * (WORLD.corridorHalf - 90)) };
    const target =
      dir === 'east'
        ? { x: WORLD.width - 70 - rng() * 20, y: (rng() - 0.5) * 30 }
        : { x: 70 + rng() * 20, y: (rng() - 0.5) * 30 };
    plan.push({ tick, dir, side, radius, slow, maxSpeed, maxAccel, spawn, target });
    tick += 8 + Math.floor(rng() * 22);
  }
  return plan;
}

export class Sim {
  constructor({ policy = 'courtesy', plan, dense = false, seed = 42, headless = false }) {
    resetIds();
    this.policy = policy;
    this.plan = plan;
    this.dense = dense;
    this.seed = seed;
    this.headless = headless;
    this.tick = 0;
    this.agents = [];
    this.scheduler = new Scheduler(policy);
    this.neighborCap = dense ? CONFIG.denseNeighborCap : CONFIG.sparseCap;
    this.eventLimit = dense ? CONFIG.eventRingDense : CONFIG.eventRingSparse;
    this.truncationTicks = 0;
    this.totalConsidered = 0;
    this.stuckReason = '';
  }

  spawnDue() {
    for (const spec of this.plan) {
      if (spec.tick === this.tick) {
        const a = new Agent(spec, this.eventLimit);
        a.lastTick = this.tick;
        a.log(this.tick, `出生：${a.dir === 'east' ? '向东' : '向西'}，半径 ${a.radius.toFixed(1)}，加速度上限 ${a.maxAccel.toFixed(0)}，${a.slow ? '行动较慢' : '正常速度'}，目标 ${a.dir === 'east' ? '东' : '西'}侧出口`, 'spawn');
        this.agents.push(a);
      }
    }
  }

  // 全局路线给出的行走意图：朝门心/出口走；未获准且接近停车线时意图停下。
  // 叠加一个由角色 id 决定的稳定侧向偏置，打破正面对称、让绕让方向一致不振荡。
  preferredVelocity(a) {
    let base;
    if (a.phase === 'before') {
      const stopX = a.dir === 'east' ? stopXEast(a.radius) : stopXWest(a.radius);
      const atStop =
        (a.dir === 'east' && a.pos.x >= stopX - a.maxSpeed * CONFIG.dt * 2.5) ||
        (a.dir === 'west' && a.pos.x <= stopX + a.maxSpeed * CONFIG.dt * 2.5);
      if (!a.permit && atStop) return { x: 0, y: 0 };
      const aim = { x: gateCenterX(), y: 0 };
      base = V.scale(V.norm(V.sub(aim, a.pos)), a.maxSpeed);
    } else {
      base = V.scale(V.norm(V.sub(a.target, a.pos)), a.maxSpeed);
    }
    // 东向者偏北(y+)、西向者偏南(y-)，天然左右分流；同 id 符号恒定。
    // 过门后温和外移，离开门线排队区。
    const sideSign = a.dir === 'east' ? 1 : -1;
    const biasStrength = a.phase === 'after' ? 0.18 : 0.12;
    const bias = { x: 0, y: sideSign * a.maxSpeed * biasStrength };
    return V.clampLen(V.add(base, bias), a.maxSpeed);
  }

  // 硬几何保证：门区被对向占用（门内有人或对向者已持证）时，未持证者在门线被挡住
  gateBarrierLine(a) {
    if (a.phase !== 'before' || a.permit) return null;
    const opposingLocked =
      (this.scheduler.occupantDir && this.scheduler.occupantDir !== a.dir) ||
      this.agents.some(
        (o) =>
          !o.done &&
          o.id !== a.id &&
          o.dir !== a.dir &&
          o.permit &&
          o.phase === 'before'
      );
    if (!opposingLocked) return null;
    const lineX = a.dir === 'east' ? G.x0 - a.radius : G.x1 + a.radius;
    const near =
      (a.dir === 'east' && a.pos.x >= lineX - a.maxSpeed * CONFIG.dt * 4) ||
      (a.dir === 'west' && a.pos.x <= lineX + a.maxSpeed * CONFIG.dt * 4);
    if (!near) return null;
    const cap = (lineX - a.pos.x) / CONFIG.dt;
    return halfPlaneVx(cap, a.dir === 'east' ? false : true);
  }

  // 同向跟车硬约束：门内或门外贴近门线时，后随者前进速度不得贴上前方同行者。
  // 覆盖门外排队，保证进门前已保持车距，避免跨入门口瞬间重叠。
  gateFollowLine(a) {
    if (a.phase === 'after') return null;
    const leader = this.agents
      .filter((o) => {
        if (o.done || o.id === a.id || o.dir !== a.dir) return false;
        if (o.phase === 'after') return false;
        // 门内者，或门外已持证的同向领头
        return o.phase === 'inside' || (o.phase === 'before' && o.permit);
      })
      .map((o) => ({ o, ahead: a.dir === 'east' ? o.pos.x - a.pos.x : a.pos.x - o.pos.x }))
      .filter((x) => x.ahead > 0)
      .sort((x, y) => x.ahead - y.ahead)[0];
    if (!leader) return null;
    // 门外只在贴近领头时才约束，避免过早限制正常行走
    if (a.phase === 'before' && leader.ahead > leader.o.radius + a.radius + CONFIG.gateSpacing * 3) return null;
    const minGap = leader.o.radius + a.radius + CONFIG.gateSpacing;
    const slack = leader.ahead - minGap;
    const cap = a.dir === 'east'
      ? leader.o.vel.x + slack / (CONFIG.dt * 2)
      : leader.o.vel.x - slack / (CONFIG.dt * 2);
    return halfPlaneVx(cap, a.dir === 'east' ? false : true);
  }

  extraLines(a) {
    const lines = [];
    if (a.phase === 'inside') {
      // 门内 vx 界限合并为单一硬约束，避免防后退与跟车两条半平面反复投影振荡
      const east = a.dir === 'east';
      let cap = 0; // 防后退：东向 vx>=0，西向 vx<=0
      const follow = this.gateFollowLine(a);
      if (follow) cap = follow.point.x; // 跟车上/下限已包含不后退方向
      lines.push(halfPlaneVx(cap, east));
      return lines;
    }
    if (a.phase !== 'before') return lines;
    const follow = this.gateFollowLine(a);
    if (follow) lines.push(follow);
    const stopX = a.dir === 'east' ? stopXEast(a.radius) : stopXWest(a.radius);
    const near =
      (a.dir === 'east' && a.pos.x >= stopX - a.maxSpeed * CONFIG.dt * 3) ||
      (a.dir === 'west' && a.pos.x <= stopX + a.maxSpeed * CONFIG.dt * 3);
    if (!a.permit && near) {
      // 无许可不得越过停车线：东向约束 vx<=cap，西向约束 vx>=cap
      const cap = (stopX - a.pos.x) / CONFIG.dt;
      lines.push(halfPlaneVx(cap, a.dir === 'east' ? false : true));
    }
    const barrier = this.gateBarrierLine(a);
    if (barrier) lines.push(barrier);
    return lines;
  }

  nearbyWalls(a) {
    const out = [];
    for (const w of WALLS) {
      const q = closestOnSegment(a.pos, w);
      if (V.len2(V.sub(q, a.pos)) <= (a.radius + CONFIG.neighborRadius) ** 2) out.push(q);
    }
    return out;
  }

  step() {
    this.tick++;
    this.spawnDue();
    for (const a of this.agents) a.lastTick = this.tick;
    this.scheduler.update(this);

    const active = this.agents.filter((a) => !a.done);
    const grid = new Grid(active, CONFIG.cellSize);
    let anyTruncated = false;

    for (const a of active) {
      a.updatePhase();
      a.preferred = this.preferredVelocity(a);
      const q = grid.query(a.pos, CONFIG.neighborRadius, this.neighborCap);
      if (q.truncated) anyTruncated = true;
      this.totalConsidered += q.considered;
      a.lastQuery = { count: q.neighbors.length, considered: q.considered, truncated: q.truncated, cap: this.neighborCap };
      const neighbors = q.neighbors
        .filter((o) => o.id !== a.id)
        .map((o) => ({
          pos: o.pos,
          vel: o.vel,
          dir: o.dir,
          // ORCA 用放大的个人空间半径保持间隙；物理碰撞统计仍用真实 radius
          radius: o.radius + CONFIG.personalSpace,
          priority: o.phase === 'inside',
        }));

      const { velocity, feasible } = solveVelocity(
        a,
        neighbors,
        this.nearbyWalls(a),
        this.extraLines(a),
        CONFIG.dt,
        CONFIG.timeHorizon,
        CONFIG.timeHorizonObst
      );

      if (!feasible) {
        a.infeasibleStreak++;
        if (a.infeasibleStreak === 1 || a.infeasibleStreak % 10 === 0) {
          a.log(this.tick, `局部无可行速度（连续 ${a.infeasibleStreak} 拍）`, 'blocked');
        }
      } else if (a.infeasibleStreak > 0) {
        a.log(this.tick, '恢复可行速度，继续行走', 'resume');
        a.infeasibleStreak = 0;
      }

      a.vel = velocity;
      a.pos = V.add(a.pos, V.scale(velocity, CONFIG.dt));
      a.updatePhase();

      const speed = V.len(velocity);
      if (speed < a.maxSpeed * 0.08) {
        a.waitTicks++;
        a._waitRun++;
        a.maxWaitRun = Math.max(a.maxWaitRun, a._waitRun);
      } else {
        a._waitRun = 0;
      }
    }

    // 碰撞统计：区分轻微相切(<2px)与有意义穿透(>=2px)，并记录最大穿透深度
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const penetration = a.radius + b.radius - V.len(V.sub(a.pos, b.pos));
        if (penetration > 0.5) {
          a.touchTicks++;
          b.touchTicks++;
        }
        if (penetration >= 2) {
          a.collisionTicks++;
          b.collisionTicks++;
          this.maxPenetration = Math.max(this.maxPenetration ?? 0, penetration);
        }
      }
    }

    // 到达目标出口：过门后贴近自己一侧的出口区域即完成
    for (const a of active) {
      if (a.phase !== 'after') continue;
      const reachedX = a.dir === 'east' ? a.pos.x >= a.target.x - CONFIG.arrivalRadius : a.pos.x <= a.target.x + CONFIG.arrivalRadius;
      const closeY = Math.abs(a.pos.y - a.target.y) <= 50;
      if (reachedX && closeY) {
        a.done = true;
        a.finishTick = this.tick;
        a.log(this.tick, `抵达目标出口，结束（等候共 ${a.waitTicks} 拍）`, 'finish');
      }
    }

    if (anyTruncated) this.truncationTicks++;
  }

  get finishedCount() {
    return this.agents.filter((a) => a.done).length;
  }

  get allDone() {
    return this.agents.length === this.plan.length && this.agents.every((a) => a.done);
  }

  get aliveCount() {
    return this.agents.filter((a) => !a.done).length;
  }

  metrics() {
    const done = this.agents.filter((a) => a.done);
    const waits = this.agents.map((a) => a.waitTicks * CONFIG.dt);
    const maxWait = Math.max(0, ...waits);
    const worst = [...this.agents].sort((a, b) => b.waitTicks - a.waitTicks).slice(0, 5);
    return {
      policy: this.policy,
      total: this.plan.length,
      finished: done.length,
      makespan: (done.length ? Math.max(...done.map((a) => a.finishTick)) : 0) * CONFIG.dt,
      throughput: done.length / Math.max(1, this.tick * CONFIG.dt),
      maxWait,
      avgWait: waits.reduce((s, x) => s + x, 0) / Math.max(1, waits.length),
      collisions: this.agents.reduce((s, a) => s + a.collisionTicks, 0) / 2,
      touches: this.agents.reduce((s, a) => s + a.touchTicks, 0) / 2,
      maxPenetration: this.maxPenetration ?? 0,
      truncationTicks: this.truncationTicks,
      avgConsidered: this.totalConsidered / Math.max(1, this.tick),
      worst: worst.map((a) => ({
        id: a.id,
        dir: a.dir,
        slow: a.slow,
        wait: a.waitTicks * CONFIG.dt,
        done: a.done,
      })),
      destinations: this.agents.map((a) => ({
        id: a.id,
        dir: a.dir,
        slow: a.slow,
        finish: a.finishTick >= 0 ? a.finishTick * CONFIG.dt : null,
      })),
    };
  }
}

// 同一份来客序列跑两种规则，做公平对比
export function comparePolicies(plan, dense) {
  const out = {};
  for (const policy of ['courtesy', 'batch']) {
    const sim = new Sim({ policy, plan, dense, headless: true });
    const limit = plan[plan.length - 1].tick + 4000;
    while (!sim.allDone && sim.tick < limit) sim.step();
    if (!sim.allDone) sim.stuckReason = `${sim.aliveCount} 人在 ${limit * CONFIG.dt}s 内未能通过`;
    out[policy] = { metrics: sim.metrics(), sim, stuck: sim.stuckReason };
  }
  return out;
}
