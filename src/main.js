import { WORLD, CONFIG } from './config.js';
import { Sim, makeSpawnPlan, comparePolicies } from './sim.js';
import { drawWorld, pickAgent } from './renderer.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
canvas.width = WORLD.width;
canvas.height = WORLD.height;

const state = {
  sim: null,
  plan: null,
  running: false,
  speed: 2,
  selectedId: null,
  compare: null,
};

const $ = (id) => document.getElementById(id);

function buildPlan() {
  const n = parseInt($('count').value, 10);
  const seed = parseInt($('seed').value, 10);
  const dense = $('dense').checked;
  return { plan: makeSpawnPlan(n, seed), dense, n, seed };
}

function newSim() {
  const { plan, dense } = buildPlan();
  state.plan = plan;
  state.sim = new Sim({ policy: $('policy').value, plan, dense });
  state.selectedId = null;
  state.compare = null;
  $('comparePanel').innerHTML = '';
  renderInspector();
  updateHud();
}

function runCompare() {
  const { plan, dense } = buildPlan();
  state.plan = plan;
  $('comparePanel').innerHTML = '<div class="muted">正在以相同来客序列跑两种规则…</div>';
  // 让浏览器先绘制提示
  setTimeout(() => {
    state.compare = comparePolicies(plan, dense);
    state.sim = state.compare[$('policy').value].sim;
    state.selectedId = null;
    renderCompare();
    updateHud();
  }, 30);
}

function fmt(x, d = 1) {
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}

function renderCompare() {
  const c = state.compare;
  if (!c) return;
  const row = (label, a, b, better) => {
    const cls = better === 'a' ? 'good' : better === 'b' ? 'good2' : '';
    return `<tr><td>${label}</td><td class="${cls}">${a}</td><td class="${cls}">${b}</td></tr>`;
  };
  const m1 = c.courtesy.metrics;
  const m2 = c.batch.metrics;
  let html = `
    <table>
      <tr><th>指标（同序列 ${m1.total} 人）</th><th>双向礼让</th><th>分批放行</th></tr>
      ${row('完成人数', `${m1.finished}/${m1.total}`, `${m2.finished}/${m2.total}`)}
      ${row('清空耗时 s', fmt(m1.makespan), fmt(m2.makespan), m1.makespan <= m2.makespan ? 'a' : 'b')}
      ${row('吞吐 人/s', fmt(m1.throughput, 2), fmt(m2.throughput, 2), m1.throughput >= m2.throughput ? 'a' : 'b')}
      ${row('最长等候 s（个人）', fmt(m1.maxWait), fmt(m2.maxWait), m1.maxWait <= m2.maxWait ? 'a' : 'b')}
      ${row('平均等候 s', fmt(m1.avgWait), fmt(m2.avgWait))}
      ${row('碰撞次数（穿透≥2px 拍/2）', m1.collisions, m2.collisions, m1.collisions <= m2.collisions ? 'a' : 'b')}
      ${row('轻微相切（<2px 拍/2）', m1.touches, m2.touches)}
      ${row('最大穿透深度 px', fmt(m1.maxPenetration), fmt(m2.maxPenetration), m1.maxPenetration <= m2.maxPenetration ? 'a' : 'b')}
      ${row('邻域截断拍数', m1.truncationTicks, m2.truncationTicks)}
      ${row('每拍平均候选邻居', fmt(m1.avgConsidered, 1), fmt(m2.avgConsidered, 1))}
    </table>
    <div class="worst">
      <h4>等候最久的 5 个人（防止平均值遮住过不了门的少数人）</h4>
      <div class="worst-cols">
        <div><b>礼让</b><ol>${m1.worst.map((w) => `<li class="${w.done ? '' : 'undone'}">#${w.id} ${w.dir === 'east' ? '东' : '西'}${w.slow ? '·慢' : ''}：等候 ${fmt(w.wait)}s ${w.done ? '已通过' : '未通过'}</li>`).join('')}</ol></div>
        <div><b>分批</b><ol>${m2.worst.map((w) => `<li class="${w.done ? '' : 'undone'}">#${w.id} ${w.dir === 'east' ? '东' : '西'}${w.slow ? '·慢' : ''}：等候 ${fmt(w.wait)}s ${w.done ? '已通过' : '未通过'}</li>`).join('')}</ol></div>
      </div>
      <h4>每个人的最终去向</h4>
      <div class="dests">${m1.destinations
        .map((d, i) => {
          const d2 = m2.destinations[i];
          return `<span class="dest ${d.finish === null || d2.finish === null ? 'undone' : ''}">#${d.id} ${d.dir === 'east' ? '→东出口' : '→西出口'}：礼让 ${d.finish === null ? '滞留' : fmt(d.finish) + 's'} / 分批 ${d2.finish === null ? '滞留' : fmt(d2.finish) + 's'}</span>`;
        })
        .join('')}</div>
      ${c.courtesy.stuck || c.batch.stuck ? `<p class="warn">${c.courtesy.stuck || ''} ${c.batch.stuck || ''}</p>` : ''}
    </div>`;
  $('comparePanel').innerHTML = html;
}

function renderInspector() {
  const a = state.sim?.agents.find((x) => x.id === state.selectedId);
  if (!a) {
    $('inspector').innerHTML = '<p class="muted">点击画布上的角色，回看它等待 / 获准 / 撤回的依据。</p>';
    return;
  }
  const phaseName = { before: '门区外排队', inside: '门区内', after: '已过门' }[a.phase];
  const evs = [...a.events].reverse();
  $('inspector').innerHTML = `
    <h4>角色 #${a.id} ${a.slow ? '<span class="tag slow">行动较慢</span>' : '<span class="tag">正常</span>'}</h4>
    <ul class="kv">
      <li>方向：${a.dir === 'east' ? '向东，目标东出口' : '向西，目标西出口'}</li>
      <li>半径：${a.radius.toFixed(1)} px</li>
      <li>加速度上限：${a.maxAccel.toFixed(0)} px/s²</li>
      <li>最大速度：${a.maxSpeed.toFixed(0)} px/s</li>
      <li>位置阶段：${phaseName}</li>
      <li>通行许可：${a.permit ? '已获准（第 ' + a.permitTick + ' 拍）' : '未获准'}</li>
      <li>局部无解连续拍：${a.infeasibleStreak}（阈值 ${CONFIG.infeasibleLimit}）</li>
      <li>累计等候：${(a.waitTicks * CONFIG.dt).toFixed(1)} s</li>
      <li>碰撞拍数（穿透≥2px）：${a.collisionTicks}，轻微相切：${a.touchTicks}</li>
      <li>上一拍邻域：${a.lastQuery ? `${a.lastQuery.count} 人（候选 ${a.lastQuery.considered}，上限 ${a.lastQuery.cap}${a.lastQuery.truncated ? '，已截断' : ''}）` : '—'}</li>
    </ul>
    <h4>依据记录${a.events.length >= a.eventLimit ? `（环形缓冲，仅留最近 ${a.eventLimit} 条）` : ''}</h4>
    <ol class="events">
      ${evs
        .map((e) => `<li class="ev-${e.type}"><span class="tick">t=${(e.tick * CONFIG.dt).toFixed(1)}s</span> ${e.text}</li>`)
        .join('')}
    </ol>`;
}

function updateHud() {
  const sim = state.sim;
  if (!sim) return;
  $('hud').innerHTML = `
    <span>拍 t=${(sim.tick * CONFIG.dt).toFixed(1)}s</span>
    <span>在场 ${sim.aliveCount} 人</span>
    <span>已通过 ${sim.finishedCount}/${sim.plan.length}</span>
    <span>${sim.scheduler.statusText()}</span>
    <span class="${sim.dense ? 'warn' : ''}">${sim.dense ? `密集模式：邻域上限 ${sim.neighborCap}，记录 ${sim.eventLimit} 条` : `稀疏精确模式：邻域上限 ${sim.neighborCap}`}</span>
    <span>截断 ${sim.truncationTicks} 拍</span>`;
}

// 主循环：按选定倍速每帧推进若干拍
function loop() {
  if (state.running && state.sim) {
    const stepsPerFrame = state.speed;
    for (let i = 0; i < stepsPerFrame; i++) {
      if (state.sim.allDone) {
        state.running = false;
        $('runBtn').textContent = '继续';
        break;
      }
      state.sim.step();
    }
    drawWorld(ctx, state.sim, state.selectedId);
    updateHud();
    renderInspector();
  } else if (state.sim) {
    drawWorld(ctx, state.sim, state.selectedId);
  }
  requestAnimationFrame(loop);
}

// 事件绑定
$('newBtn').addEventListener('click', () => {
  state.running = false;
  $('runBtn').textContent = '运行';
  newSim();
});
$('runBtn').addEventListener('click', () => {
  if (!state.sim) newSim();
  state.running = !state.running;
  $('runBtn').textContent = state.running ? '暂停' : '继续';
});
$('stepBtn').addEventListener('click', () => {
  if (!state.sim) newSim();
  state.running = false;
  $('runBtn').textContent = '继续';
  state.sim.step();
  drawWorld(ctx, state.sim, state.selectedId);
  updateHud();
  renderInspector();
});
$('speed').addEventListener('change', (e) => {
  state.speed = parseInt(e.target.value, 10);
});
$('policy').addEventListener('change', () => {
  if (state.compare) {
    state.sim = state.compare[$('policy').value].sim;
    renderInspector();
    updateHud();
  } else {
    newSim();
  }
});
$('compareBtn').addEventListener('click', runCompare);

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const hit = pickAgent(state.sim, px, py);
  state.selectedId = hit ? hit.id : null;
  drawWorld(ctx, state.sim, state.selectedId);
  renderInspector();
});

newSim();
loop();
