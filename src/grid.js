import { V } from './orca.js';

// 均匀网格空间哈希：密集场景限制每拍查询规模，并报告截断情况。
export class Grid {
  constructor(agents, cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
    for (const a of agents) {
      const key = this.key(a.pos.x, a.pos.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(a);
    }
  }

  key(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  query(pos, radius, cap) {
    const minCx = Math.floor((pos.x - radius) / this.cellSize);
    const maxCx = Math.floor((pos.x + radius) / this.cellSize);
    const minCy = Math.floor((pos.y - radius) / this.cellSize);
    const maxCy = Math.floor((pos.y + radius) / this.cellSize);
    const seen = new Set();
    const found = [];
    let considered = 0;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const a of bucket) {
          if (seen.has(a.id) || a.done) continue;
          seen.add(a.id);
          considered++;
          if (V.len2(V.sub(a.pos, pos)) <= radius * radius) found.push(a);
        }
      }
    }
    found.sort((a, b) => V.len2(V.sub(a.pos, pos)) - V.len2(V.sub(b.pos, pos)));
    const truncated = found.length > cap;
    return { neighbors: found.slice(0, cap), considered, truncated };
  }
}
