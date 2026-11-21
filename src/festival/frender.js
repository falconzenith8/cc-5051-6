// 广场绘制：布局（墙/亭/狭口/通道/出口）、闸机状态、角色（队伍/状态着色）、选中与批次高亮
import { PLAZA } from './venue.js';

const TEAM_COLOR = { A: '#4f8ff7', B: '#b06ff2' };

export function drawPlaza(ctx, sim, opts = {}) {
  const { selectedId = null, batchId = null, replayFrame = null, replayMeta = null } = opts;
  const P = PLAZA;
  const v = sim.venue;
  ctx.clearRect(0, 0, P.width, P.height);
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, P.width, P.height);

  // 等候区底色
  ctx.fillStyle = '#131c28';
  ctx.fillRect(0, 0, P.westX, P.height);
  // 场内
  ctx.fillStyle = '#16202c';
  ctx.fillRect(P.westX, 0, P.eastX - P.westX, P.height);

  // 无障碍通道
  const L = P.lane;
  ctx.fillStyle = v.laneLocked ? 'rgba(224,92,92,0.10)' : 'rgba(62,207,142,0.10)';
  ctx.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
  ctx.fillStyle = v.laneLocked ? '#e05c5c' : '#3ecf8e';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(v.laneLocked ? '无障碍通道（已锁）' : '无障碍通道', L.x0 + 6, L.y0 + 14);

  // 狭口高亮
  ctx.fillStyle = 'rgba(245,166,35,0.10)';
  ctx.fillRect(P.partitionX - 4, P.doorY0, 8, P.doorY1 - P.doorY0);

  // 墙体
  ctx.strokeStyle = '#8fa3b8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const w of sim.walls) {
    ctx.moveTo(w.x0, w.y0);
    ctx.lineTo(w.x1, w.y1);
  }
  ctx.stroke();

  // 侧门状态
  const B = P.booth;
  ctx.fillStyle = sim.doorOpenPhys ? 'rgba(62,207,142,0.25)' : 'rgba(224,92,92,0.18)';
  ctx.fillRect(B.px0, B.y0, B.px1 - B.px0, B.y1 - B.y0);
  ctx.fillStyle = sim.doorOpenRoute ? '#3ecf8e' : '#e05c5c';
  ctx.textAlign = 'center';
  ctx.fillText(sim.doorOpenRoute ? '侧门开' : '侧门关', (B.x0 + B.x1) / 2, B.y0 - 6);

  // 闸机与出口标注
  ctx.font = '11px sans-serif';
  for (const team of ['A', 'B']) {
    const gy = P.gateY[team];
    ctx.fillStyle = '#9fb4c8';
    ctx.textAlign = 'right';
    ctx.fillText(`${team} 队闸机`, P.westX - 6, gy - 18);
  }
  for (const key of ['E', 'NE']) {
    const ey = P.exitY[key];
    ctx.textAlign = 'left';
    ctx.fillStyle = key === v.activeExit ? '#3ecf8e' : '#5a6b7d';
    ctx.fillText(key === v.activeExit ? `出口 ${key}（开）` : `出口 ${key}（关）`, P.eastX - 64, ey - 20);
  }

  // 角色
  const agents = replayFrame
    ? replayFrame.a.map(([id, x2, y2, st]) => {
        const m = replayMeta.get(id) ?? {};
        return { specId: id, pos: { x: x2 / 2, y: y2 / 2 }, team: m.team, radius: m.radius ?? 11, slow: m.slow, batchId: m.batchId, stateCode: st, vel: { x: 0, y: 0 } };
      })
    : sim.agents.filter((a) => a.alive);

  for (const a of agents) {
    const st = a.stateCode;
    let color = TEAM_COLOR[a.team] ?? '#999';
    if (st === 0) color = shade(color, 0.45); // 等候区
    if (st === 3) color = '#f5a623'; // 停驻等同伴
    if (st === 4) color = '#e05c5c'; // 退票中
    ctx.beginPath();
    ctx.arc(a.pos.x, a.pos.y, a.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (a.slow) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(a.pos.x, a.pos.y, a.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (batchId !== null && a.batchId === batchId) {
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.pos.x, a.pos.y, a.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (a.specId === selectedId) {
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(a.pos.x, a.pos.y, a.radius + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (!replayFrame && a.vel && (a.vel.x || a.vel.y)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(a.pos.x, a.pos.y);
      ctx.lineTo(a.pos.x + a.vel.x * 0.25, a.pos.y + a.vel.y * 0.25);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(a.specId), a.pos.x, a.pos.y + 3);
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export function pickVisitor(sim, px, py) {
  let best = null;
  let bestD = Infinity;
  for (const a of sim.agents) {
    if (!a.alive) continue;
    const d2 = (px - a.pos.x) ** 2 + (py - a.pos.y) ** 2;
    if (d2 <= (a.radius + 4) ** 2 && d2 < bestD) {
      best = a;
      bestD = d2;
    }
  }
  return best;
}
