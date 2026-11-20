import { CONFIG, G } from './config.js';

// 路口调度：每拍 ORCA 之前决定通行许可。
// 硬底线：门区（含身体尚未完全离开门线者）同一时间只锁定一个方向；
// 门内者保有许可不被撤回，门外排队者连续局部无解则撤回。
export class Scheduler {
  constructor(policy) {
    this.policy = policy; // 'courtesy' | 'batch'
    this.activeDir = 'east';
    this.dirEmptyTicks = 0;
    this.batchRemaining = CONFIG.batchSize;
    this.occupantDir = null; // 持续占用门区的方向，直到身体完全离开
  }

  // 身体（含半径）是否仍压在门的纵向范围内
  bodyInGateSpan(a) {
    if (a.dir === 'east') return a.pos.x - a.radius < G.x1;
    return a.pos.x + a.radius > G.x0;
  }

  update(sim) {
    const t = sim.tick;
    const agents = sim.agents;

    // 1) 撤回：仅门外排队者的许可可因连续局部无解失效
    for (const a of agents) {
      if (a.permit && a.phase === 'before' && a.infeasibleStreak >= CONFIG.infeasibleLimit) {
        a.permit = false;
        a.log(t, `许可撤回：连续 ${a.infeasibleStreak} 拍局部无解，回到停车线后重新排队`, 'revoke');
      }
    }

    // 2) 门内者自动保有通行权
    for (const a of agents) {
      if (!a.done && a.phase === 'inside') a.permit = true;
    }

    // 3) 持续门区占用：门内者，或刚过门线但身体仍未完全离开者
    const spanning = agents.filter((a) => !a.done && this.bodyInGateSpan(a) && a.phase !== 'before');
    const spanDirs = new Set(spanning.map((a) => a.dir));
    if (spanDirs.size > 0) {
      this.occupantDir = [...spanDirs][0];
    } else if (!agents.some((a) => !a.done && a.permit && a.phase === 'before')) {
      this.occupantDir = null;
    }

    const inside = agents.filter((a) => !a.done && a.phase === 'inside');
    const reserved = agents.filter((a) => !a.done && a.permit && a.phase === 'before');
    const lockHolders = [...inside, ...reserved];
    const locked = this.occupantDir ?? (lockHolders.length ? lockHolders[0].dir : null);

    const pending = (dir) =>
      agents
        .filter((a) => !a.done && a.dir === dir && a.phase === 'before')
        .sort((a, b) =>
          dir === 'east' ? b.pos.x - a.pos.x : a.pos.x - b.pos.x
        );

    // 4) 换向只在门区完全清空且无持证排队者后进行
    if (!locked) {
      if (this.policy === 'courtesy') this.updateCourtesy(pending);
      else this.updateBatch(pending);
    } else {
      this.dirEmptyTicks = 0;
      this.activeDir = locked;
    }

    // 5) 发许可：门区已锁方向时，对向绝不开闸；单拍至多一张
    this.grant(t, agents, locked);
  }

  updateCourtesy(pending) {
    this.dirEmptyTicks++;
    const same = pending(this.activeDir);
    const other = pending(this.activeDir === 'east' ? 'west' : 'east');
    const canSwitch = this.dirEmptyTicks >= CONFIG.courtesySwitchDelay;
    if ((same.length === 0 && other.length > 0) || (canSwitch && other.length > 0)) {
      this.activeDir = this.activeDir === 'east' ? 'west' : 'east';
      this.dirEmptyTicks = 0;
    }
  }

  updateBatch(pending) {
    const same = pending(this.activeDir);
    const other = pending(this.activeDir === 'east' ? 'west' : 'east');
    const batchDone = this.batchRemaining <= 0;
    if (batchDone || (same.length === 0 && other.length > 0)) {
      if (other.length > 0 && (batchDone || same.length === 0)) {
        this.activeDir = this.activeDir === 'east' ? 'west' : 'east';
        this.batchRemaining = CONFIG.batchSize;
        this.dirEmptyTicks = 0;
      } else if (same.length > 0 && batchDone) {
        this.batchRemaining = CONFIG.batchSize; // 同向还有人，开新一批
      }
    }
  }

  grant(t, agents, locked) {
    const queue = agents
      .filter((a) => !a.done && !a.permit && a.phase === 'before' && a.dir === this.activeDir)
      .sort((a, b) =>
        this.activeDir === 'east' ? b.pos.x - a.pos.x : a.pos.x - b.pos.x
      );
    if (queue.length === 0) return;
    if (locked && locked !== this.activeDir) return; // 门区锁了对向
    if (this.policy === 'batch' && this.batchRemaining <= 0) return;

    // 窄门单列：只要门内已有同向者，或门外领头持证者没拉开身位，就不再放新票
    const insideSame = agents.some((a) => !a.done && a.phase === 'inside' && a.dir === this.activeDir);
    if (insideSame) return;

    const leader = agents
      .filter((a) => !a.done && a.permit && a.dir === this.activeDir && a.id !== queue[0].id)
      .sort((a, b) =>
        this.activeDir === 'east' ? b.pos.x - a.pos.x : a.pos.x - b.pos.x
      )[0];
    if (leader && leader.phase === 'before') {
      const clearGap = leader.radius + queue[0].radius + CONFIG.gateSpacing;
      const separated =
        this.activeDir === 'east'
          ? leader.pos.x - queue[0].pos.x >= clearGap
          : queue[0].pos.x - leader.pos.x >= clearGap;
      if (!separated) return;
    }

    this.issue(queue[0], t);
    if (this.policy === 'batch') this.batchRemaining--;
  }

  issue(a, t) {
    a.permit = true;
    a.permitTick = t;
    a.log(
      t,
      `${a.dir === 'east' ? '向东' : '向西'}获准通行（${
        this.policy === 'courtesy' ? '双向礼让' : '分批放行'
      }）`,
      'grant'
    );
  }

  statusText() {
    const dirName = this.activeDir === 'east' ? '东向' : '西向';
    if (this.policy === 'courtesy') return `礼让制：当前让 ${dirName}，空门 ${this.dirEmptyTicks} 拍`;
    return `分批制：${dirName} 批次剩余 ${Math.max(0, this.batchRemaining)} 个名额`;
  }
}
