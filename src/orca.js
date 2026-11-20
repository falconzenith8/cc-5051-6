// RVO/ORCA 风格的线性规划速度求解（半平面可行域：det(dir, point - v) <= 0）
const EPS = 1e-5;

export const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  len2: (a) => a.x * a.x + a.y * a.y,
  len: (a) => Math.hypot(a.x, a.y),
  norm(a) {
    const l = Math.hypot(a.x, a.y) || EPS;
    return { x: a.x / l, y: a.y / l };
  },
  clampLen(a, max) {
    const l = Math.hypot(a.x, a.y);
    if (l <= max || l === 0) return { x: a.x, y: a.y };
    return { x: (a.x / l) * max, y: (a.y / l) * max };
  },
};

function linearProgram1(lines, lineNo, radius, optVelocity, result) {
  const line = lines[lineNo];
  const dotProduct = V.dot(line.point, line.direction);
  const discriminant = radius * radius - dotProduct * dotProduct;
  if (discriminant < 0) return false;
  const sqrtDiscriminant = Math.sqrt(discriminant);
  let tLeft = -dotProduct - sqrtDiscriminant;
  let tRight = -dotProduct + sqrtDiscriminant;

  for (let i = 0; i < lineNo; i++) {
    const denominator = V.cross(line.direction, lines[i].direction);
    const numerator = V.cross(lines[i].direction, V.sub(line.point, lines[i].point));
    if (Math.abs(denominator) <= EPS) {
      if (numerator < 0) return false;
      continue;
    }
    const t = numerator / denominator;
    if (denominator >= 0) tRight = Math.min(tRight, t);
    else tLeft = Math.max(tLeft, t);
    if (tLeft > tRight) return false;
  }

  let t = V.dot(line.direction, V.sub(optVelocity, line.point));
  t = Math.max(tLeft, Math.min(tRight, t));
  const r = V.add(line.point, V.scale(line.direction, t));
  result.x = r.x;
  result.y = r.y;
  return true;
}

function linearProgram2(lines, radius, optVelocity, result) {
  result.x = optVelocity.x;
  result.y = optVelocity.y;
  for (let i = 0; i < lines.length; i++) {
    if (V.cross(lines[i].direction, V.sub(lines[i].point, result)) > 0) {
      const tmp = { ...result };
      if (!linearProgram1(lines, i, radius, optVelocity, result)) {
        result.x = tmp.x;
        result.y = tmp.y;
        return i;
      }
    }
  }
  return lines.length;
}

// 把 v 投到单条半平面边界上（沿方向直线移动到 line.point + t*direction）
function projectToLine(v, line) {
  const t = V.cross(line.direction, V.sub(line.point, v));
  return V.add(v, V.scale(line.direction, t));
}

// 两条半平面边界的交点；平行返回 null
function intersectLines(l1, l2) {
  const det = V.cross(l1.direction, l2.direction);
  if (Math.abs(det) <= EPS) return null;
  const t = V.cross(l2.direction, V.sub(l2.point, l1.point)) / det;
  return V.add(l1.point, V.scale(l1.direction, t));
}

// 无可行解时的有界迭代求解：在所有违反半平面中，取离当前速度最近的
// 单点/交点，逐步降低总违反量。固定轮数，保证实时性与终止。
function linearProgram3(lines, beginLine, radius, result) {
  let v = { ...result };
  const maxPasses = 3;
  for (let pass = 0; pass < maxPasses; pass++) {
    let violated = false;
    let bestPoint = null;
    let bestDist2 = Infinity;

    for (let i = beginLine; i < lines.length; i++) {
      if (V.cross(lines[i].direction, V.sub(lines[i].point, v)) <= EPS) continue;
      violated = true;
      const onLine = projectToLine(v, lines[i]);
      const dLine = V.len2(V.sub(onLine, v));
      if (dLine < bestDist2) {
        bestDist2 = dLine;
        bestPoint = onLine;
      }
      for (let j = 0; j < i; j++) {
        const p = intersectLines(lines[i], lines[j]);
        if (!p) continue;
        if (V.len2(p) > radius * radius + EPS) continue;
        const d2 = V.len2(V.sub(p, v));
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestPoint = p;
        }
      }
    }
    if (!violated) break;
    if (bestPoint) v = bestPoint;
    else v = projectToLine(v, lines[beginLine]);
  }
  const l = V.len(v);
  if (l > radius) v = V.scale(v, radius / l);
  result.x = v.x;
  result.y = v.y;
}

// 单个邻居的 ORCA 半平面。rho：自身承担的避让责任（0.5 互让，1 完全让行）
function neighborLine(agent, other, dt, timeHorizon, rho) {
  const relPos0 = V.sub(other.pos, agent.pos);
  const relVel = V.sub(agent.vel, other.vel);
  const relPos = V.sub(relPos0, V.scale(relVel, dt));
  const combinedR = agent.radius + other.radius;
  const rSq = combinedR * combinedR;
  const distSq = V.len2(relPos);
  const line = { point: null, direction: null };

  if (distSq > rSq) {
    const invT = 1 / timeHorizon;
    const w = V.sub(relVel, V.scale(relPos, invT));
    const wLenSq = V.len2(w);
    const dot1 = V.dot(w, relPos);
    if (dot1 < 0 && dot1 * dot1 > rSq * wLenSq) {
      const wLen = Math.sqrt(wLenSq);
      const unitW = V.scale(w, 1 / wLen);
      line.direction = { x: unitW.y, y: -unitW.x };
      const u = V.scale(unitW, combinedR * invT - wLen);
      line.point = V.add(agent.vel, V.scale(u, rho));
    } else {
      const leg = Math.sqrt(distSq - rSq);
      line.direction = V.scale(
        { x: relPos.x * leg - relPos.y * combinedR, y: relPos.x * combinedR + relPos.y * leg },
        1 / distSq
      );
      const determinant = V.cross(line.direction, relPos);
      const u = V.sub(
        V.scale(line.direction, determinant * invT - V.cross(line.direction, relVel)),
        V.scale(relVel, 0.5)
      );
      line.point = V.add(agent.vel, V.scale(u, rho));
      if (determinant - invT * combinedR <= 0) {
        line.direction = V.scale(line.direction, -1);
      }
    }
  } else {
    const w = V.sub(relVel, V.scale(relPos, 1 / dt));
    const wLen = V.len(w) || EPS;
    const unitW = V.scale(w, 1 / wLen);
    line.direction = { x: unitW.y, y: -unitW.x };
    const u = V.scale(unitW, combinedR / dt - wLen);
    line.point = V.add(agent.vel, V.scale(u, rho));
  }
  return line;
}

// 静态墙体：取线段最近点，视作速度为 0、自身全责的邻居
function wallLine(agent, q, dt, timeHorizonObst) {
  return neighborLine(agent, { pos: q, vel: { x: 0, y: 0 }, radius: 0 }, dt, timeHorizonObst, 1);
}

// 直半平面：vx >= cap（dir 朝东时用于门内防后退 / 停车线）
export function halfPlaneVx(cap, east) {
  return east
    ? { direction: { x: 0, y: -1 }, point: { x: cap, y: 0 } }
    : { direction: { x: 0, y: 1 }, point: { x: cap, y: 0 } };
}

export function closestOnSegment(p, s) {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const l2 = dx * dx + dy * dy || EPS;
  const t = Math.max(0, Math.min(1, ((p.x - s.x0) * dx + (p.y - s.y0) * dy) / l2));
  return { x: s.x0 + t * dx, y: s.y0 + t * dy };
}

// 主求解：返回 { velocity, feasible }。extraLines 为不可违反的硬约束（停车线/门线/防后退）
export function solveVelocity(agent, neighbors, walls, extraLines, dt, timeHorizon, timeHorizonObst) {
  const lines = [];
  const insideGate = agent.phase === 'inside';

  for (const other of neighbors) {
    // 门内者只对同向同伴保持纵向车距；对向者已被门线硬屏障挡在门外，无需再让
    if (insideGate && other.dir && other.dir !== agent.dir) continue;
    const rho = other.priority ? 1 : 0.5; // 门内有通行优先权，门外全责让行
    lines.push(neighborLine(agent, other, dt, timeHorizon, rho));
  }
  for (const q of walls) lines.push(wallLine(agent, q, dt, timeHorizonObst));
  for (const l of extraLines) lines.push({ ...l, hard: true });

  const preferred = V.clampLen(agent.preferred, agent.maxSpeed);
  const result = { x: 0, y: 0 };
  const failAt = linearProgram2(lines, agent.maxSpeed, preferred, result);
  const feasible = failAt === lines.length;
  if (!feasible) linearProgram3(lines, failAt, agent.maxSpeed, result);

  // 加速度上限：限制这一拍速度增量
  let delta = V.sub(result, agent.vel);
  const maxDelta = agent.maxAccel * dt;
  const dl = V.len(delta);
  if (dl > maxDelta) delta = V.scale(delta, maxDelta / dl);
  let velocity = V.add(agent.vel, delta);

  // 削幅后再强制硬约束（停车线/门线/防后退），保证它们不被加速度上限破坏
  for (const l of lines) {
    if (!l.hard) continue;
    if (V.cross(l.direction, V.sub(l.point, velocity)) > EPS) {
      const projected = projectToLine(velocity, l);
      velocity.x = projected.x;
      velocity.y = projected.y;
    }
  }
  const vlen = V.len(velocity);
  if (vlen > agent.maxSpeed) {
    velocity.x = (velocity.x / vlen) * agent.maxSpeed;
    velocity.y = (velocity.y / vlen) * agent.maxSpeed;
  }
  return { velocity, feasible };
}
