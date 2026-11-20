import { G, gatePhase } from './config.js';

let nextId = 1;

export class Agent {
  constructor(spec, eventLimit) {
    this.id = nextId++;
    this.dir = spec.dir; // east: 左→右；west: 右→左
    this.side = spec.side; // 走北/南侧汇入
    this.pos = { ...spec.spawn };
    this.vel = { x: 0, y: 0 };
    this.preferred = { x: 0, y: 0 };
    this.target = { ...spec.target };
    this.radius = spec.radius;
    this.maxSpeed = spec.maxSpeed;
    this.maxAccel = spec.maxAccel;
    this.slow = spec.slow;
    this.spawnTick = spec.tick;

    this.phase = gatePhase(this.pos, this.dir);
    this.permit = false;
    this.permitTick = -1;
    this.done = false;
    this.finishTick = -1;
    this.infeasibleStreak = 0;
    this.collisionTicks = 0;
    this.touchTicks = 0;
    this.waitTicks = 0;
    this.maxWaitRun = 0;
    this._waitRun = 0;
    this.events = [];
    this.eventLimit = eventLimit;
    this.lastQuery = null;
  }

  log(tick, text, type = 'info') {
    this.events.push({ tick, text, type });
    if (this.events.length > this.eventLimit) this.events.splice(0, this.events.length - this.eventLimit);
  }

  updatePhase() {
    const p = gatePhase(this.pos, this.dir);
    // 滞回：已在门内时，只要身体（含半径）仍压着门的纵向跨度，就保持 inside，
    // 避免贴门线的单帧位置抖动把相位切到 before/after 而丢失门内约束
    if (this.phase === 'inside' && p !== 'inside') {
      const bodySpans = this.dir === 'east'
        ? this.pos.x - this.radius < G.x1
        : this.pos.x + this.radius > G.x0;
      if (bodySpans && Math.abs(this.pos.y) <= G.halfH + 1) return;
    }
    if (p !== this.phase) {
      if (p === 'inside') this.log(this.lastTick ?? 0, '进入门区', 'gate');
      this.phase = p;
    }
  }

  get color() {
    if (this.done) return '#7a8a99';
    if (this.phase === 'inside') return '#f5a623';
    if (this.permit) return '#3ecf8e';
    if (this.infeasibleStreak > 0) return '#e05c5c';
    return this.dir === 'east' ? '#4f8ff7' : '#b06ff2';
  }
}

export function resetIds() {
  nextId = 1;
}

