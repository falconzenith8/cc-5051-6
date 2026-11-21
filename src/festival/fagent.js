// 庆典访客：状态机 + 路点跟随 + 事件台账（对账与反向追踪的依据）
let nextId = 1;

export const STATE_CODE = { waiting: 0, queue: 1, inside: 2, held: 3, refund: 4, done: 5 };

export class FAgent {
  constructor(spec) {
    this.id = nextId++;
    this.specId = spec.id;
    this.team = spec.team;
    this.batchId = spec.batchId;
    this.slow = spec.slow;
    this.radius = spec.radius;
    this.maxSpeed = spec.maxSpeed;
    this.maxAccel = spec.maxAccel;
    this.pos = { ...spec.spawn };
    this.anchor = { ...spec.spawn }; // 未叫到时在等候区守着的位置
    this.vel = { x: 0, y: 0 };
    this.preferred = { x: 0, y: 0 };

    this.detour = spec.detour;
    this.divertEligible = spec.divertEligible;
    this.diverted = false;
    this.isStopper = !!spec.isStopper;
    this.isCompanion = !!spec.isCompanion;

    this.state = 'waiting'; // waiting|toGate|atGate|entering|inside|refunding
    this.present = false; // 预约到访：批次提前 arriveEarly 秒到等候区
    this.arriveTick = spec.arriveTick ?? 0;
    this.holding = false;
    this.holdSince = -1;
    this.dwellUntil = -1; // 观景台驻留到这一拍
    this.dwellDone = false;
    this.wp = [];
    this.wpIndex = 0;
    this.queueRank = -1;

    this.calledTick = -1;
    this.admitTick = -1;
    this.exitTick = -1;
    this.refundTick = -1;
    this.done = false;
    this.refunded = false;

    this.waitTicks = 0; // 叫到之后在场内的低速拍数（排队/拥堵）
    this.queueWaitTicks = 0; // 叫到到过闸的拍数（对账里的"等待"）
    this.maxWaitRun = 0;
    this._waitRun = 0;
    this.collisionTicks = 0;
    this.touchTicks = 0;
    this.events = [];
    this.eventLimit = 160;
    this.lastTick = 0;
  }

  log(tick, text, type = 'info') {
    this.events.push({ tick, text, type });
    if (this.events.length > this.eventLimit) this.events.splice(0, this.events.length - this.eventLimit);
  }

  get alive() {
    return this.present && !this.done && !this.refunded;
  }

  get called() {
    return this.calledTick >= 0;
  }

  get admitted() {
    return this.admitTick >= 0;
  }

  get stateCode() {
    if (this.done || this.refunded) return STATE_CODE.done;
    if (this.holding) return STATE_CODE.held;
    if (this.state === 'waiting') return STATE_CODE.waiting;
    if (this.state === 'refunding') return STATE_CODE.refund;
    if (this.state === 'inside' || this.state === 'entering') return STATE_CODE.inside;
    return STATE_CODE.queue;
  }
}

export function resetFIds() {
  nextId = 1;
}
