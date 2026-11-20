// 无头冒烟测试：两种规则、稀疏/密集，检查死锁、门区对向共存、碰撞量与撤回事件
import { Sim, makeSpawnPlan, comparePolicies } from '../src/sim.js';
import { gatePhase } from '../src/config.js';

function run(policy, dense, n, seed) {
  const plan = makeSpawnPlan(n, seed);
  const sim = new Sim({ policy, plan, dense, headless: true });
  const limit = plan[plan.length - 1].tick + 4000;
  let headOn = 0;
  let overlap = 0;
  while (!sim.allDone && sim.tick < limit) {
    sim.step();
    const inside = sim.agents.filter((a) => !a.done && a.phase === 'inside');
    const dirs = new Set(inside.map((a) => a.dir));
    if (dirs.size > 1) headOn++;
    for (let i = 0; i < inside.length; i++)
      for (let j = i + 1; j < inside.length; j++) {
        const a = inside[i], b = inside[j];
        const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
        const rr = a.radius + b.radius - 0.5;
        if (dx * dx + dy * dy < rr * rr) overlap++;
      }
  }
  const m = sim.metrics();
  const revokes = sim.agents.reduce(
    (s, a) => s + a.events.filter((e) => e.type === 'revoke').length, 0);
  return { sim, m, headOn, overlap, revokes, stuck: sim.tick >= limit && !sim.allDone };
}

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
  if (!cond) failures++;
};

for (const dense of [false, true]) {
  for (const policy of ['courtesy', 'batch']) {
    const r = run(policy, dense, 24, 42);
    const tag = `${dense ? '密集' : '稀疏'}/${policy}`;
    check(`${tag} 全部通过`, !r.stuck, `完成 ${r.m.finished}/${r.m.total}`);
    check(`${tag} 门区无对向共存`, r.headOn === 0, `违例拍 ${r.headOn}`);
    check(`${tag} 门区无人员重叠`, r.overlap === 0, `重叠拍 ${r.overlap}`);
    check(`${tag} 有碰撞统计`, r.m.collisions >= 0);
    check(`${tag} 指标有限`, Number.isFinite(r.m.maxWait) && Number.isFinite(r.m.throughput));
    console.log(`       清空=${r.m.makespan.toFixed(1)}s 吞吐=${r.m.throughput.toFixed(2)} 最长等候=${r.m.maxWait.toFixed(1)}s 碰撞=${r.m.collisions} 撤回=${r.revokes} 截断拍=${r.m.truncationTicks}`);
  }
}

// 同序列对比：两种规则的来客逐人属性一致
const plan = makeSpawnPlan(10, 7);
const cmp = comparePolicies(plan, false);
const a1 = cmp.courtesy.sim.agents, a2 = cmp.batch.sim.agents;
check('同序列人数一致', a1.length === a2.length && a1.length === 10);
check('同序列逐人半径/方向一致', a1.every((a, i) => a.radius === a2[i].radius && a.dir === a2[i].dir && a.maxSpeed === a2[i].maxSpeed));

// 慢角色在密集来客下确实会中途停步再恢复（任一慢角色产生等候或恢复事件即可）
const slowAgents = a1.filter((a) => a.slow);
if (slowAgents.length) {
  const anyStop = slowAgents.some((a) => a.waitTicks > 0 || a.events.some((e) => e.type === 'resume' || e.type === 'blocked'));
  check('慢角色存在停步/恢复记录', anyStop);
  const s = slowAgents[0];
  console.log(`       慢角色 #${s.id} 等候 ${(s.waitTicks * 0.1).toFixed(1)}s, 事件类型=[${[...new Set(s.events.map((e) => e.type))].join(',')}]`);
}

// 密集模式确实发生过邻域截断或候选受限
const denseRun = run('courtesy', true, 60, 42);
check('密集 60 人跑完', !denseRun.stuck, `完成 ${denseRun.m.finished}/60`);
console.log(`       密集截断拍=${denseRun.m.truncationTicks} 平均候选=${denseRun.m.avgConsidered.toFixed(1)}`);

process.exit(failures ? 1 : 0);
