// 庆典关卡主界面：广场编辑器 + 重演 + 对比 + 对账 + 辨认 + 入库 + 回放 + 反向影响链
import { makeVenue, PLAZA, buildWalls } from './venue.js';
import { generateScript, PRESETS } from './script.js';
import { FestivalSim, runToEnd, CFG } from './fsim.js';
import { analyzeAll } from './analyze.js';
import { reconcileOne, reconcileModes } from './reconcile.js';
import { traceAgent } from './trace.js';
import { Library } from './library.js';
import { drawPlaza, pickVisitor } from './frender.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const library = new Library();

const state = {
  sim: null,
  analysis: null,
  running: false,
  speed: 2,
  selectedId: null,
  batchId: null,
  traceId: null,
  replay: null, // {payload, frameIdx, playing}
};

// ---------- 编辑器 → 参数 ----------
function editorParams() {
  const doorOn = $('doorOn').checked;
  return {
    seed: parseInt($('seed').value, 10) || 1,
    releaseMode: $('releaseMode').value,
    batchSize: parseInt($('batchSize').value, 10) || 6,
    interval: parseInt($('interval').value, 10) || 18,
    teamSpeed: { A: parseFloat($('speedA').value), B: parseFloat($('speedB').value) },
    door: doorOn ? { openAt: +$('doorOpenAtTxt').textContent, duration: parseInt($('doorDur').value, 10) || 40 } : null,
    divertFromBatch: parseInt($('divertFrom').value, 10) || 2,
    detour: $('detourOn').checked
      ? { team: 'A', from: parseInt($('detourFrom').value, 10) || 0, to: parseInt($('detourTo').value, 10) || 90 }
      : null,
    waitEvent: $('waitEvent').checked,
  };
}

function editorVenue() {
  return makeVenue({
    activeExit: $('exitSel').value,
    laneLocked: $('laneLocked').checked,
    capacity: parseInt($('capacity').value, 10) || 34,
    patience: parseInt($('patience').value, 10) || 75,
  });
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  $('doorOn').checked = !!p.door;
  if (p.door) {
    $('doorOpenAtTxt').textContent = p.door.openAt;
    $('doorDur').value = p.door.duration;
  }
  $('divertFrom').value = p.divertFromBatch ?? 2;
  $('detourOn').checked = !!p.detour;
  if (p.detour) {
    $('detourFrom').value = p.detour.from;
    $('detourTo').value = p.detour.to;
  }
  $('waitEvent').checked = !!p.waitEvent;
  $('laneLocked').checked = !!p.laneLocked;
  drawTimeline();
}

// ---------- 重演 ----------
function rebuild() {
  const venue = editorVenue();
  const script = generateScript(editorParams(), venue);
  state.sim = new FestivalSim({ venue, script });
  state.analysis = null;
  state.selectedId = null;
  state.batchId = null;
  state.traceId = null;
  state.replay = null;
  $('replayBar').classList.add('hidden');
  renderInspector();
  renderLedger();
  renderDetect();
  updateHud();
  drawTimeline();
}

// ---------- 主循环 ----------
function loop() {
  if (state.replay) {
    const r = state.replay;
    if (r.playing) {
      r.frameIdx = Math.min(r.frameIdx + state.speed, r.payload.frames.length - 1);
      $('replayScrub').value = r.frameIdx;
    }
    drawReplayFrame();
    requestAnimationFrame(loop);
    return;
  }
  if (state.running && state.sim) {
    for (let i = 0; i < state.speed; i++) {
      if (state.sim.allDone) {
        state.running = false;
        $('runBtn').textContent = '继续';
        state.analysis = analyzeAll(state.sim);
        renderDetect();
        renderLedger();
        break;
      }
      state.sim.step();
    }
    drawPlaza(ctx, state.sim, { selectedId: state.selectedId, batchId: state.batchId });
    updateHud();
    if (state.selectedId != null || state.traceId != null) renderInspector();
  } else if (state.sim) {
    drawPlaza(ctx, state.sim, { selectedId: state.selectedId, batchId: state.batchId });
  }
  requestAnimationFrame(loop);
}

function updateHud() {
  const sim = state.sim;
  if (!sim) return;
  const m = { in: sim.agents.filter((a) => a.admitted && a.alive).length };
  $('hud').innerHTML = `
    <span>t=${(sim.tick * CFG.dt).toFixed(1)}s</span>
    <span>在场 ${m.in} / 名额 ${sim.venue.capacity}（余 ${sim.credit()}）</span>
    <span>已入场 ${sim.agents.filter((a) => a.admitted).length} · 离场回执 ${sim.receipts} · 退票 ${sim.agents.filter((a) => a.refunded).length}</span>
    <span>狭口过线 ${sim.doorCrossings.length} 人次</span>
    <span>${sim.script.releaseMode === 'receipt' ? '回执放行' : '预约放行'} · 出口 ${sim.venue.activeExit}${sim.venue.laneLocked ? ' · 通道已锁' : ''}${sim.doorOpenRoute ? ' · 侧门开' : ''}</span>`;
}

// ---------- 时间线编辑器 ----------
function drawTimeline() {
  const tl = $('timeline');
  const params = editorParams();
  const script = state.sim?.script;
  const tMax = 200;
  tl.innerHTML = '';
  const track = document.createElement('div');
  track.className = 'tl-track';
  // 批次预约刻度
  if (script) {
    for (const b of script.batches) {
      const tick = document.createElement('div');
      tick.className = `tl-batch ${b.team === 'A' ? 'ta' : 'tb'}`;
      tick.style.left = `${(b.apptTick * CFG.dt / tMax) * 100}%`;
      tick.title = `批次 #${b.id}（${b.team} 队）预约 ${(b.apptTick * CFG.dt).toFixed(0)}s${b.detour ? ' · 折返' : ''}`;
      track.appendChild(tick);
    }
  }
  // 折返窗口
  if (params.detour) {
    const win = document.createElement('div');
    win.className = 'tl-detour';
    win.style.left = `${(params.detour.from / tMax) * 100}%`;
    win.style.width = `${((params.detour.to - params.detour.from) / tMax) * 100}%`;
    win.title = '折返窗口';
    track.appendChild(win);
  }
  // 侧门（可拖动）
  if (params.door) {
    const openAt = params.door.openAt;
    const dur = params.door.duration;
    const span = document.createElement('div');
    span.className = 'tl-door';
    span.style.left = `${(openAt / tMax) * 100}%`;
    span.style.width = `${(dur / tMax) * 100}%`;
    span.textContent = `侧门 ${openAt}s`;
    track.appendChild(span);
    const handle = document.createElement('div');
    handle.className = 'tl-handle';
    handle.style.left = `${(openAt / tMax) * 100}%`;
    track.appendChild(handle);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const rect = track.getBoundingClientRect();
        const frac = Math.min(0.95, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const sec = Math.round(frac * tMax);
        $('doorOpenAtTxt').textContent = sec;
        span.style.left = `${(sec / tMax) * 100}%`;
        span.textContent = `侧门 ${sec}s`;
        handle.style.left = `${(sec / tMax) * 100}%`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        $('scenario').value = 'custom';
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
  tl.appendChild(track);
  const scale = document.createElement('div');
  scale.className = 'tl-scale';
  scale.innerHTML = '<span>0s</span><span>50</span><span>100</span><span>150</span><span>200s</span>';
  tl.appendChild(scale);
}

// ---------- 检查器：角色 → 批次 → 影响链 ----------
function renderInspector() {
  const box = $('inspector');
  const sim = state.sim;
  if (!sim) return;
  if (state.traceId != null) return renderTrace(state.traceId);
  if (state.batchId != null) return renderBatch(state.batchId);
  const a = state.selectedId != null ? sim.agents.find((x) => x.specId === state.selectedId) : null;
  if (!a) {
    box.innerHTML = '<p class="muted">点击画布上的角色查看台账；「回到批次」看出发批次；「反向打开」从滞留角色倒查影响它的邻居与剧本事件。</p>';
    return;
  }
  const batch = sim.batchOf(a.batchId);
  const sec = (t) => (t >= 0 ? (t * CFG.dt).toFixed(1) + 's' : '—');
  const evs = [...a.events].reverse();
  box.innerHTML = `
    <h4>访客 #${a.specId} ${a.slow ? '<span class="tag slow">行动较慢</span>' : ''} ${a.detour ? '<span class="tag">折返</span>' : ''}${a.diverted ? '<span class="tag">改道</span>' : ''}</h4>
    <ul class="kv">
      <li>队伍：${a.team} 队 · 批次 #${a.batchId}（预约 ${sec(batch.apptTick)}）</li>
      <li>状态：${stateName(a)}</li>
      <li>叫到：${sec(a.calledTick)} · 实际入场：${sec(a.admitTick)} · 等待 ${a.admitted ? ((a.admitTick - a.calledTick) * CFG.dt).toFixed(1) + 's' : '—'}</li>
      <li>离场：${sec(a.exitTick)} ${a.done ? `（出口 ${sim.venue.activeExit}）` : ''} ${a.refunded ? '· 已退票' : ''}</li>
      <li>场内低速累计 ${(a.waitTicks * CFG.dt).toFixed(1)}s · 最长连续 ${(a.maxWaitRun * CFG.dt).toFixed(1)}s</li>
    </ul>
    <div class="row">
      <button data-act="batch">回到出发批次 #${a.batchId}</button>
      <button data-act="trace">反向打开影响链</button>
    </div>
    <h4>台账</h4>
    <ol class="events">${evs.map((e) => `<li class="ev-${e.type}"><span class="tick">t=${(e.tick * CFG.dt).toFixed(1)}s</span>${e.text}</li>`).join('')}</ol>`;
  box.querySelector('[data-act="batch"]').onclick = () => {
    state.batchId = a.batchId;
    state.selectedId = null;
    renderInspector();
  };
  box.querySelector('[data-act="trace"]').onclick = () => {
    state.traceId = a.specId;
    state.selectedId = null;
    renderInspector();
  };
}

function stateName(a) {
  if (a.done) return '已离场';
  if (a.refunded) return '已退票';
  if (a.holding) return '停驻等同伴';
  return { waiting: '等候区', toGate: '前往闸机', atGate: '闸前排队', entering: '过闸中', inside: '场内', refunding: '退票中' }[a.state] ?? a.state;
}

function renderBatch(batchId) {
  const box = $('inspector');
  const sim = state.sim;
  const batch = sim.batchOf(batchId);
  const members = sim.agents.filter((a) => a.batchId === batchId);
  const sec = (t) => (t >= 0 ? (t * CFG.dt).toFixed(1) + 's' : '—');
  box.innerHTML = `
    <h4>出发批次 #${batch.id} · ${batch.team} 队 ${batch.size} 人 ${batch.detour ? '<span class="tag">折返</span>' : ''}</h4>
    <ul class="kv">
      <li>预约 ${sec(batch.apptTick)} · 叫到 ${sec(batch.calledTick)}（${sim.script.releaseMode === 'receipt' ? '回执放行' : '预约放行'}）</li>
      <li>团体速度倍率 ${sim.script.teamSpeed[batch.team].toFixed(2)}</li>
      <li>已入场 ${members.filter((m) => m.admitted).length}/${members.length} · 已离场 ${members.filter((m) => m.done).length} · 退票 ${members.filter((m) => m.refunded).length}</li>
    </ul>
    <div class="row"><button data-act="back">返回</button></div>
    <h4>成员（点击跳到角色）</h4>
    <div class="members">${members
      .map((m) => `<button class="mem" data-id="${m.specId}">#${m.specId}${m.slow ? '·慢' : ''}${m.refunded ? '·退' : m.done ? '·离' : ''}</button>`)
      .join('')}</div>`;
  box.querySelector('[data-act="back"]').onclick = () => {
    state.batchId = null;
    renderInspector();
  };
  box.querySelectorAll('.mem').forEach((btn) => {
    btn.onclick = () => {
      state.selectedId = parseInt(btn.dataset.id, 10);
      state.batchId = null;
      renderInspector();
    };
  });
}

function renderTrace(specId) {
  const box = $('inspector');
  if (!state.analysis) {
    state.analysis = analyzeAll(state.sim);
  }
  const tr = traceAgent(state.sim, state.analysis, specId);
  if (!tr) {
    box.innerHTML = '<p class="muted">未找到角色。</p>';
    return;
  }
  box.innerHTML = `
    <h4>影响链 · 访客 #${tr.id}（${tr.team} 队 · 批次 #${tr.batchId}）</h4>
    <ul class="kv">
      <li>最久一段滞留：${tr.wait ? `${tr.wait.from}s → ${tr.wait.to}s，位置 (${tr.wait.at.x}, ${tr.wait.at.y})` : '无持续滞留'}</li>
      <li>场内低速累计 ${tr.totalWait}s</li>
    </ul>
    <h4>当时挡在它身边的邻居（点击跳转）</h4>
    <div class="members">${tr.blockers.length ? tr.blockers.map((b) => `<button class="mem" data-id="${b.id}">#${b.id} ${b.team}队·批${b.batchId} ${b.d.toFixed(0)}px</button>`).join('') : '<span class="muted">附近无人——是路线或名额的问题</span>'}</div>
    <h4>窗口内的剧本/闸机事件</h4>
    <ol class="events">${tr.events.length ? tr.events.map((e) => `<li class="ev-${e.type}"><span class="tick">t=${(e.tick * CFG.dt).toFixed(1)}s</span>${e.text}</li>`).join('') : '<li class="muted">无</li>'}</ol>
    <h4>该改场地？</h4>
    <ul class="kv">${tr.venue.map((s) => `<li>${s}</li>`).join('')}</ul>
    <h4>还是改演出节奏？</h4>
    <ul class="kv">${tr.rhythm.map((s) => `<li>${s}</li>`).join('')}</ul>
    <div class="row"><button data-act="back">返回角色</button></div>`;
  box.querySelectorAll('.mem').forEach((btn) => {
    btn.onclick = () => {
      state.selectedId = parseInt(btn.dataset.id, 10);
      state.traceId = null;
      renderInspector();
    };
  });
  box.querySelector('[data-act="back"]').onclick = () => {
    state.traceId = null;
    state.selectedId = tr.id;
    renderInspector();
  };
}

// ---------- 对账 ----------
function renderLedger() {
  const sim = state.sim;
  if (!sim) return;
  const rows = reconcileOne(sim);
  $('ledger').innerHTML = `
    <table>
      <tr><th>访客</th><th>队/批</th><th>预约</th><th>叫到</th><th>实际入场</th><th>等待</th><th>离场</th><th>退票</th><th>去向</th></tr>
      ${rows
        .map(
          (r) => `<tr class="${r.refund ? 'refunded' : ''}">
        <td>#${r.id}${r.slow ? '·慢' : ''}</td><td>${r.team}/#${r.batchId}</td>
        <td>${r.appt ?? '—'}s</td><td>${r.called ?? '—'}s</td><td>${r.admit ?? '—'}s</td>
        <td>${r.wait ?? '—'}s</td><td>${r.exit ?? '—'}s</td>
        <td>${r.refund ? r.refund + 's' : ''}</td><td>${r.dest ? '出口 ' + r.dest : r.refund ? '退票口' : '—'}</td>
      </tr>`
        )
        .join('')}
    </table>`;
}

// ---------- 行走记录辨认 ----------
function renderDetect() {
  const sim = state.sim;
  if (!sim) return;
  if (!state.analysis) {
    $('detect').innerHTML = '<p class="muted">运行结束后自动辨认；或点 <button id="detectNow">立即辨认</button></p>';
    $('detectNow').onclick = () => {
      state.analysis = analyzeAll(state.sim);
      renderDetect();
    };
    return;
  }
  const an = state.analysis;
  const waits = Object.entries(an.waits)
    .map(([id, w]) => ({ id: +id, ...w }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  $('detect').innerHTML = `
    <div class="detect-cols">
      <div>
        <h4>持续等待（≥3s，前 8）</h4>
        <ol>${waits.length ? waits.map((w) => `<li><a href="#" class="jump" data-id="${w.id}">#${w.id}</a> 共 ${(w.total * CFG.dt).toFixed(1)}s，最久 ${(w.longest.t0 * CFG.dt).toFixed(1)}–${(w.longest.t1 * CFG.dt).toFixed(1)}s @(${Math.round(w.longest.x)},${Math.round(w.longest.y)})</li>`).join('') : '<li class="muted">无</li>'}</ol>
      </div>
      <div>
        <h4>队列交换（${an.exchanges.length} 次）</h4>
        <ol>${an.exchanges.slice(0, 8).map((e) => `<li>t=${(e.tick * CFG.dt).toFixed(1)}s ${e.team} 队 #${e.a} ⇄ #${e.b}</li>`).join('') || '<li class="muted">无</li>'}</ol>
      </div>
      <div>
        <h4>穿透</h4>
        <ul class="kv">
          <li>穿透拍数：${an.penetration.pairFrames}</li>
          <li>最大深度：${an.penetration.maxDepth.toFixed(1)}px ${an.penetration.worst ? `（#${an.penetration.worst.a} × #${an.penetration.worst.b}）` : ''}</li>
          <li>狭口通量：${an.throughput.overall.toFixed(2)} 人/s（过线 ${sim.doorCrossings.length}）</li>
        </ul>
      </div>
    </div>`;
  $('detect').querySelectorAll('.jump').forEach((el) => {
    el.onclick = (ev) => {
      ev.preventDefault();
      state.traceId = parseInt(el.dataset.id, 10);
      state.selectedId = null;
      state.batchId = null;
      renderInspector();
      $('inspector').scrollIntoView({ behavior: 'smooth' });
    };
  });
}

// ---------- 对比 ----------
function headless(params, venueOver) {
  const venue = makeVenue(venueOver);
  const script = generateScript(params, venue);
  const sim = runToEnd(venue, script);
  return { sim, analysis: analyzeAll(sim), metrics: sim.metrics() };
}

function fmt(x, d = 1) {
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}

function runCompareScenarios() {
  const seed = parseInt($('seed').value, 10) || 1;
  const base = editorParams();
  $('comparePanel').innerHTML = '<div class="muted">同一随机种子跑顺畅/拥堵两场…</div>';
  setTimeout(() => {
    const smooth = headless({ ...base, ...PRESETS.smooth, seed }, { ...editorVenue(), laneLocked: false });
    const jammed = headless({ ...base, ...PRESETS.jammed, seed }, { ...editorVenue(), laneLocked: true });
    const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    const density = (r) => `${r.metrics.visitors} 人 · ${r.metrics.entered} 入场`;
    $('comparePanel').innerHTML = `
      <h3>同种子两场对比 <span class="muted">密度相近：顺畅 ${density(smooth)} / 拥堵 ${density(jammed)}</span></h3>
      <table>
        <tr><th>指标</th><th>顺畅场</th><th>拥堵场</th></tr>
        ${row('清空耗时 s', fmt(smooth.metrics.makespan), fmt(jammed.metrics.makespan))}
        ${row('狭口通量 人/s', fmt(smooth.analysis.throughput.overall, 2), fmt(jammed.analysis.throughput.overall, 2))}
        ${row('持续等待人数', Object.keys(smooth.analysis.waits).length, Object.keys(jammed.analysis.waits).length)}
        ${row('队列交换次数', smooth.analysis.exchanges.length, jammed.analysis.exchanges.length)}
        ${row('穿透拍数 / 最大深度', `${smooth.analysis.penetration.pairFrames} / ${fmt(smooth.analysis.penetration.maxDepth)}px`, `${jammed.analysis.penetration.pairFrames} / ${fmt(jammed.analysis.penetration.maxDepth)}px`)}
        ${row('退票人数', smooth.metrics.refunded, jammed.metrics.refunded)}
        ${row('最长闸前等待 s', fmt(smooth.metrics.maxWait), fmt(jammed.metrics.maxWait))}
      </table>
      <p class="muted">两场用同一随机种子，访客逐人属性一致；差异全部来自剧本事件（侧门/折返/等同伴）与场地（锁通道）。</p>`;
  }, 30);
}

function runCompareModes() {
  const params = editorParams();
  const venue = editorVenue();
  $('comparePanel').innerHTML = '<div class="muted">同一剧本跑两种放行模式…</div>';
  setTimeout(() => {
    const scheduled = headless({ ...params, releaseMode: 'scheduled' }, venue);
    const receipt = headless({ ...params, releaseMode: 'receipt' }, venue);
    const rows = reconcileModes(scheduled.sim, receipt.sim);
    const diff = rows.filter((r) => r.scheduled.called !== r.receipt.called || r.scheduled.admit !== r.receipt.admit);
    const refunds = rows.filter((r) => r.scheduled.refund || r.receipt.refund);
    $('comparePanel').innerHTML = `
      <h3>两种放行模式对账 <span class="muted">${params.detour ? '含折返：回执被拖延，两模式应不同' : '无折返：两模式应一致'}</span></h3>
      <p>逐人叫号/入场有差异的行：<b>${diff.length}</b> / ${rows.length}；退票差异行：<b>${refunds.length}</b>。
      预约放行 ${scheduled.metrics.refunded} 人退票 · 回执放行 ${receipt.metrics.refunded} 人退票 · 回执离场回执 ${receipt.metrics.receipts} 张。</p>
      <table>
        <tr><th>访客</th><th>批</th><th>预约</th><th>预约放行 叫到/入场/等</th><th>回执放行 叫到/入场/等</th><th>退票</th></tr>
        ${rows
          .filter((r) => r.scheduled.called !== r.receipt.called || r.scheduled.admit !== r.receipt.admit || r.scheduled.refund || r.receipt.refund)
          .slice(0, 40)
          .map(
            (r) => `<tr>
            <td>#${r.id}</td><td>${r.team}/#${r.batchId}</td><td>${r.appt}s</td>
            <td>${r.scheduled.called ?? '—'} / ${r.scheduled.admit ?? '—'} / ${r.scheduled.wait ?? '—'}s</td>
            <td>${r.receipt.called ?? '—'} / ${r.receipt.admit ?? '—'} / ${r.receipt.wait ?? '—'}s</td>
            <td>${[r.scheduled.refund && '预约退', r.receipt.refund && '回执退'].filter(Boolean).join('、')}</td>
          </tr>`
          )
          .join('')}
      </table>
      <p class="muted">两条路线共用出口 ${venue.activeExit}；只有折返拖延真实离场时，回执放行才会晚于预约放行。</p>`;
  }, 30);
}

function runWaitCompare() {
  const params = editorParams();
  const venue = editorVenue();
  $('comparePanel').innerHTML = '<div class="muted">同一瓶颈跑有/无等同伴两场…</div>';
  setTimeout(() => {
    const withWait = headless({ ...params, waitEvent: true }, venue);
    const without = headless({ ...params, waitEvent: false }, venue);
    const holdEvs = withWait.sim.events.filter((e) => e.type === 'hold');
    const holdStart = holdEvs[0]?.tick ?? 0;
    const holdEnd = holdEvs[holdEvs.length - 1]?.tick ?? 0;
    const inWindow = (sim) => sim.doorCrossings.filter((c) => c.tick >= holdStart && c.tick <= holdEnd).length;
    const wIn = inWindow(withWait.sim);
    const woIn = inWindow(without.sim);
    $('comparePanel').innerHTML = `
      <h3>等同伴事件 · 同一瓶颈通量对比</h3>
      <table>
        <tr><th>指标</th><th>有等待（排头停狭口）</th><th>无等待</th></tr>
        <tr><td>停驻窗口 ${(holdStart / 10).toFixed(1)}–${(holdEnd / 10).toFixed(1)}s 狭口过线</td><td><b>${wIn} 人次</b></td><td><b>${woIn} 人次</b></td></tr>
        <tr><td>全程狭口通量 人/s</td><td>${fmt(withWait.analysis.throughput.overall, 2)}</td><td>${fmt(without.analysis.throughput.overall, 2)}</td></tr>
        <tr><td>清空耗时 s</td><td>${fmt(withWait.metrics.makespan)}</td><td>${fmt(without.metrics.makespan)}</td></tr>
        <tr><td>持续等待人数</td><td>${Object.keys(withWait.analysis.waits).length}</td><td>${Object.keys(without.analysis.waits).length}</td></tr>
        <tr><td>退票</td><td>${withWait.metrics.refunded}</td><td>${without.metrics.refunded}</td></tr>
      </table>
      <p class="muted">${holdEvs[0]?.text ?? '未触发停驻'}。有等待时逐 10s 狭口过线：</p>
      <div class="dests">${withWait.analysis.throughput.windows.map((w) => `<span class="dest">${w.from}s: ${w.count}人</span>`).join('')}</div>`;
  }, 30);
}

// ---------- 库 ----------
function renderLibrary() {
  const list = library.list();
  $('libraryList').innerHTML = list.length
    ? `<table><tr><th>名称</th><th>类型</th><th>时间</th><th></th></tr>${list
        .map(
          (e) => `<tr>
        <td>${e.name}</td>
        <td>${{ layout: '源布局', generator: '事件生成器', replay: '现场回放' }[e.kind]}</td>
        <td>${new Date(e.at).toLocaleString()}</td>
        <td>
          <button data-act="load" data-id="${e.id}">${e.kind === 'replay' ? '回放' : '载入重演'}</button>
          <button data-act="export" data-id="${e.id}">导出</button>
          <button data-act="del" data-id="${e.id}">删</button>
        </td>
      </tr>`
        )
        .join('')}</table>`
    : '<p class="muted">库为空。存源布局、事件生成器或现场回放。</p>';
  $('libraryList').querySelectorAll('button').forEach((btn) => {
    const entry = library.get(btn.dataset.id);
    if (!entry) return;
    if (btn.dataset.act === 'del') {
      btn.onclick = () => {
        library.remove(entry.id);
        renderLibrary();
      };
    } else if (btn.dataset.act === 'export') {
      btn.onclick = () => {
        const blob = new Blob([library.export(entry.id)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${entry.kind}-${entry.name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      };
    } else {
      btn.onclick = () => loadEntry(entry);
    }
  });
}

function loadEntry(entry) {
  if (entry.kind === 'layout') {
    const v = entry.payload;
    $('exitSel').value = v.activeExit;
    $('laneLocked').checked = v.laneLocked;
    $('capacity').value = v.capacity;
    $('patience').value = v.patience;
    $('scenario').value = 'custom';
    rebuild();
  } else if (entry.kind === 'generator') {
    applyParams(entry.payload.params ?? entry.payload);
    $('scenario').value = 'custom';
    rebuild();
  } else if (entry.kind === 'replay') {
    startReplay(entry.payload);
  }
}

function applyParams(p) {
  $('seed').value = p.seed ?? 42;
  $('releaseMode').value = p.releaseMode ?? 'receipt';
  $('batchSize').value = p.batchSize ?? 6;
  $('interval').value = p.interval ?? 18;
  $('speedA').value = p.teamSpeed?.A ?? 1;
  $('speedB').value = p.teamSpeed?.B ?? 1;
  $('doorOn').checked = !!p.door;
  if (p.door) {
    $('doorOpenAtTxt').textContent = p.door.openAt;
    $('doorDur').value = p.door.duration;
  }
  $('divertFrom').value = p.divertFromBatch ?? 2;
  $('detourOn').checked = !!p.detour;
  if (p.detour) {
    $('detourFrom').value = p.detour.from;
    $('detourTo').value = p.detour.to;
  }
  $('waitEvent').checked = !!p.waitEvent;
  syncSpeedLabels();
}

// ---------- 回放 ----------
function startReplay(payload) {
  state.running = false;
  state.replay = { payload, frameIdx: 0, playing: true };
  $('replayBar').classList.remove('hidden');
  $('replayScrub').max = payload.frames.length - 1;
  $('replayScrub').value = 0;
  // 用记录的布局与剧本重建一个静态 sim 外壳供绘制
  const venue = payload.venue;
  const script = generateScript(payload.scriptParams, venue);
  state.sim = new FestivalSim({ venue, script });
  state.replay.meta = new Map(payload.meta.map((m) => [m.id, m]));
  drawReplayFrame();
}

function drawReplayFrame() {
  const r = state.replay;
  if (!r) return;
  const frame = r.payload.frames[r.frameIdx];
  if (!frame) return;
  // 按剧本侧门窗口近似恢复当时的门状态
  const door = state.sim.script.door;
  if (door) {
    const open = frame.t >= door.openTick && frame.t <= door.closeTick;
    if (open !== state.sim.doorOpenPhys) {
      state.sim.doorOpenRoute = open;
      state.sim.doorOpenPhys = open;
      state.sim.walls = buildWalls(state.sim.venue, open);
    }
  }
  drawPlaza(ctx, state.sim, { replayFrame: frame, replayMeta: r.meta, selectedId: state.selectedId });
  $('replayTick').textContent = `t=${(frame.t * CFG.dt).toFixed(1)}s 帧 ${r.frameIdx + 1}/${r.payload.frames.length}`;
}

function saveReplay() {
  const sim = state.sim;
  if (!sim || !sim.frames.length) return alert('先运行一段时间再存回放');
  if (!state.analysis) state.analysis = analyzeAll(sim);
  const payload = {
    venue: sim.venue,
    scriptParams: sim.script.params,
    frames: sim.frames,
    meta: sim.agents.map((a) => ({ id: a.specId, team: a.team, batchId: a.batchId, slow: a.slow, radius: a.radius })),
    agentEvents: Object.fromEntries(sim.agents.map((a) => [a.specId, a.events])),
    events: sim.events,
    metrics: sim.metrics(),
  };
  try {
    library.save('replay', `${sim.venue.name}·${sim.script.releaseMode === 'receipt' ? '回执' : '预约'}·${new Date().toLocaleTimeString()}`, payload);
    renderLibrary();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- 事件绑定 ----------
function syncSpeedLabels() {
  $('speedATxt').textContent = parseFloat($('speedA').value).toFixed(2);
  $('speedBTxt').textContent = parseFloat($('speedB').value).toFixed(2);
}

$('scenario').addEventListener('change', () => {
  if ($('scenario').value !== 'custom') applyPreset($('scenario').value);
  rebuild();
});
$('applyBtn').addEventListener('click', () => {
  state.running = false;
  $('runBtn').textContent = '运行';
  rebuild();
});
$('runBtn').addEventListener('click', () => {
  state.running = !state.running;
  $('runBtn').textContent = state.running ? '暂停' : '继续';
});
$('stepBtn').addEventListener('click', () => {
  state.running = false;
  $('runBtn').textContent = '继续';
  state.sim.step();
  drawPlaza(ctx, state.sim, { selectedId: state.selectedId, batchId: state.batchId });
  updateHud();
});
$('speed').addEventListener('change', () => (state.speed = parseInt($('speed').value, 10)));
$('compareScenBtn').addEventListener('click', runCompareScenarios);
$('compareModeBtn').addEventListener('click', runCompareModes);
$('waitCmpBtn').addEventListener('click', runWaitCompare);
$('saveLayoutBtn').addEventListener('click', () => {
  library.save('layout', `${$('exitSel').value} 出口·${$('laneLocked').checked ? '锁通道·' : ''}${new Date().toLocaleTimeString()}`, editorVenue());
  renderLibrary();
});
$('saveGenBtn').addEventListener('click', () => {
  library.save('generator', `种子${$('seed').value}·${$('releaseMode').value === 'receipt' ? '回执' : '预约'}·${new Date().toLocaleTimeString()}`, { params: editorParams() });
  renderLibrary();
});
$('saveReplayBtn').addEventListener('click', saveReplay);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    library.import(await f.text());
    renderLibrary();
  } catch (err) {
    alert('导入失败：' + err.message);
  }
});
$('replayPlay').addEventListener('click', () => {
  state.replay.playing = !state.replay.playing;
  $('replayPlay').textContent = state.replay.playing ? '暂停' : '播放';
});
$('replayScrub').addEventListener('input', () => {
  state.replay.frameIdx = parseInt($('replayScrub').value, 10);
  state.replay.playing = false;
  $('replayPlay').textContent = '播放';
});
$('replayExit').addEventListener('click', () => {
  state.replay = null;
  $('replayBar').classList.add('hidden');
  rebuild();
});

for (const id of ['speedA', 'speedB']) $(id).addEventListener('input', syncSpeedLabels);
for (const id of ['doorOn', 'detourOn', 'waitEvent', 'laneLocked', 'exitSel']) {
  $(id).addEventListener('change', () => {
    $('scenario').value = 'custom';
    drawTimeline();
  });
}
for (const id of ['doorDur', 'divertFrom', 'detourFrom', 'detourTo', 'batchSize', 'interval', 'capacity', 'patience', 'seed', 'releaseMode']) {
  $(id).addEventListener('change', () => {
    $('scenario').value = 'custom';
    drawTimeline();
  });
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  if (state.replay) {
    // 回放中点角色：查记录的台账
    const frame = state.replay.payload.frames[state.replay.frameIdx];
    let best = null;
    let bestD = Infinity;
    for (const [id, x2, y2] of frame.a) {
      const d2 = (px - x2 / 2) ** 2 + (py - y2 / 2) ** 2;
      if (d2 < 20 ** 2 && d2 < bestD) {
        best = id;
        bestD = d2;
      }
    }
    if (best != null) {
      state.selectedId = best;
      const evs = state.replay.payload.agentEvents?.[best] ?? [];
      $('inspector').innerHTML = `<h4>回放 · 访客 #${best}</h4><ol class="events">${[...evs].reverse().map((x) => `<li class="ev-${x.type}"><span class="tick">t=${(x.tick * CFG.dt).toFixed(1)}s</span>${x.text}</li>`).join('')}</ol>`;
    }
    return;
  }
  const hit = pickVisitor(state.sim, px, py);
  state.selectedId = hit ? hit.specId : null;
  state.batchId = null;
  state.traceId = null;
  renderInspector();
});

// ---------- 启动 ----------
applyPreset('jammed');
syncSpeedLabels();
rebuild();
renderLibrary();
loop();
