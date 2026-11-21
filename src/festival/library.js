// 入库：源布局、事件生成器、现场回放三类条目，localStorage 持久化 + 导入导出。
const KEY = 'fest.library.v1';
const LIMITS = { layout: 8, generator: 8, replay: 3 };

export class Library {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  _read() {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { layouts: [], generators: [], replays: [] };
  }

  _write(lib) {
    this.storage.setItem(KEY, JSON.stringify(lib));
  }

  list() {
    const lib = this._read();
    return [...lib.layouts, ...lib.generators, ...lib.replays].sort((a, b) => b.at - a.at);
  }

  save(kind, name, payload) {
    // kind: 'layout' | 'generator' | 'replay'
    const entry = { id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, kind, name, at: Date.now(), payload };
    const lib = this._read();
    const bucket = kind === 'layout' ? 'layouts' : kind === 'generator' ? 'generators' : 'replays';
    lib[bucket].unshift(entry);
    while (lib[bucket].length > LIMITS[kind]) lib[bucket].pop();
    try {
      this._write(lib);
    } catch {
      // 回放太大：丢最旧的回放再试一次
      if (lib.replays.length > 1) {
        lib.replays.pop();
        this._write(lib);
      } else {
        throw new Error('库已满，回放存不下');
      }
    }
    return entry;
  }

  get(id) {
    return this.list().find((e) => e.id === id) ?? null;
  }

  remove(id) {
    const lib = this._read();
    for (const bucket of ['layouts', 'generators', 'replays']) {
      lib[bucket] = lib[bucket].filter((e) => e.id !== id);
    }
    this._write(lib);
  }

  export(id) {
    const e = this.get(id);
    return e ? JSON.stringify(e, null, 2) : null;
  }

  import(json) {
    const e = JSON.parse(json);
    if (!e || !e.kind || !e.payload) throw new Error('不是有效的库条目');
    return this.save(e.kind, e.name ?? '导入条目', e.payload);
  }
}
