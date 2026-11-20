import { WORLD, WALLS } from './config.js';
import { stopXEast, stopXWest } from './config.js';

export function drawWorld(ctx, sim, selectedId) {
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  // 南北走廊底色
  ctx.fillStyle = '#16202c';
  ctx.fillRect(0, 0, WORLD.width, WORLD.height / 2 - 17);
  ctx.fillRect(0, WORLD.height / 2 + 17, WORLD.width, WORLD.height / 2 - 17);

  // 门区高亮
  const g = WORLD.gate;
  ctx.fillStyle = 'rgba(245,166,35,0.10)';
  ctx.fillRect(g.x0, WORLD.height / 2 - g.halfH, g.x1 - g.x0, g.halfH * 2);

  // 墙
  ctx.strokeStyle = '#8fa3b8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const w of WALLS) {
    ctx.moveTo(w.x0, WORLD.height / 2 + w.y0);
    ctx.lineTo(w.x1, WORLD.height / 2 + w.y1);
  }
  ctx.stroke();

  // 停车线（每个待行角色半径不同，画代表线）
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.5;
  const demoR = 11;
  ctx.strokeStyle = 'rgba(79,143,247,0.55)';
  ctx.beginPath();
  ctx.moveTo(stopXEast(demoR), WORLD.height / 2 - g.halfH);
  ctx.lineTo(stopXEast(demoR), WORLD.height / 2 + g.halfH);
  ctx.strokeStyle = 'rgba(176,111,242,0.55)';
  ctx.beginPath();
  ctx.moveTo(stopXWest(demoR), WORLD.height / 2 - g.halfH);
  ctx.lineTo(stopXWest(demoR), WORLD.height / 2 + g.halfH);
  ctx.stroke();
  ctx.setLineDash([]);

  // 角色
  for (const a of sim.agents) {
    const cx = a.pos.x;
    const cy = WORLD.height / 2 + a.pos.y;
    ctx.beginPath();
    ctx.arc(cx, cy, a.radius, 0, Math.PI * 2);
    ctx.fillStyle = a.color;
    ctx.globalAlpha = a.done ? 0.45 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (a.id === selectedId) {
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (a.permit) {
      ctx.strokeStyle = 'rgba(62,207,142,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // 朝向/速度矢量
    if (!a.done) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + a.vel.x * 0.25, cy + a.vel.y * 0.25);
      ctx.stroke();
    }
    // 慢角色描边提示
    if (a.slow && !a.done) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, a.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(a.id), cx, cy + 3);
  }
}

export function pickAgent(sim, px, py) {
  let best = null;
  let bestD = Infinity;
  for (const a of sim.agents) {
    const dx = px - a.pos.x;
    const dy = py - (WORLD.height / 2 + a.pos.y);
    const d2 = dx * dx + dy * dy;
    if (d2 <= (a.radius + 4) ** 2 && d2 < bestD) {
      best = a;
      bestD = d2;
    }
  }
  return best;
}
