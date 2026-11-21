// 一次性 DOM 桩冒烟：在无浏览器环境下执行 fmain.js 初始化与若干帧，捕捉启动期异常。
// 不模拟真实布局/事件，只验证初始化、重演、对比、入库、回放路径不抛错。
class StubEl {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = '0';
    this.checked = false;
    this.textContent = '';
    this.max = 0;
    this._html = '';
  }
  addEventListener() {}
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  querySelector() {
    return new StubEl();
  }
  querySelectorAll() {
    const q = [];
    q.forEach = Array.prototype.forEach;
    return q;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 960, height: 600 };
  }
  getContext() {
    return new Proxy({}, { get: (t, k) => () => {}, set: () => true });
  }
  scrollIntoView() {}
  click() {}
  get classList() {
    return { add() {}, remove() {}, toggle() {} };
  }
  set innerHTML(v) {
    this._html = v;
  }
  get innerHTML() {
    return this._html;
  }
}

const ids = {};
const el = (id) => (ids[id] ??= Object.assign(new StubEl(id), { id }));
// 预置编辑器默认值
Object.assign(el('seed'), { value: '42' });
Object.assign(el('batchSize'), { value: '6' });
Object.assign(el('interval'), { value: '18' });
Object.assign(el('capacity'), { value: '44' });
Object.assign(el('patience'), { value: '75' });
Object.assign(el('doorDur'), { value: '40' });
Object.assign(el('divertFrom'), { value: '2' });
Object.assign(el('detourFrom'), { value: '8' });
Object.assign(el('detourTo'), { value: '90' });
Object.assign(el('speedA'), { value: '1' });
Object.assign(el('speedB'), { value: '1' });
Object.assign(el('releaseMode'), { value: 'receipt' });
Object.assign(el('exitSel'), { value: 'E' });
Object.assign(el('scenario'), { value: 'jammed' });
Object.assign(el('speed'), { value: '2' });
el('doorOpenAtTxt').textContent = '45';
el('doorOn').checked = true;
el('detourOn').checked = true;
el('waitEvent').checked = true;

const rafQ = [];
globalThis.requestAnimationFrame = (cb) => rafQ.push(cb);
globalThis.document = {
  getElementById: el,
  createElement: () => new StubEl(),
  querySelector: () => new StubEl(),
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = (m) => console.log('ALERT:', m);

await import('../src/festival/fmain.js');
console.log('初始化完成，raf 队列:', rafQ.length);

// 跑 30 帧主循环（每帧 speed=2 拍）
for (let i = 0; i < 30; i++) {
  const cb = rafQ.shift();
  if (!cb) break;
  cb();
}
console.log('主循环 30 帧无异常');
console.log('PASS UI 桩冒烟');
