'use strict';
/*
 * H2 回归测试：页面侧“发现新版本”刷新提示逻辑
 * 运行方式（Windows PowerShell）：
 *   cd "C:\Users\Uchiha Itach\WorkBuddy\2026-10-15-13-12-19"
 *   node tests/h2-update-prompt.test.js
 * 说明：
 *   - 只用 Node 内置模块（fs/path/vm），零第三方依赖。
 *   - vm 沙箱执行真实 app.js，用最小 DOM 桩 + serviceWorker 注册桩驱动更新流程。
 *   - 重点验证：不自动刷新；训练中/暂停不打扰；ready/completed 才提示；点击才重载。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const HOOK = `;globalThis.__api = {
  get state() { return state; },
  set state(v) { state = v; },
  get updateReady() { return updateReady; },
  els,
  render
};`;

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  PASS: ' + msg); }
  else { failed += 1; console.error('  FAIL: ' + msg); }
}

function makeEl() {
  const listeners = {};
  return {
    value: '',
    checked: true,
    hidden: true, // 横幅默认隐藏
    textContent: '',
    style: {},
    className: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { (listeners[type] || []).forEach((fn) => fn({})); }
  };
}

async function boot() {
  const store = {};
  const elements = {};
  const regListeners = {};
  const swListeners = {};
  const installingSw = {
    state: 'installing',
    addEventListener(type, fn) { (swListeners[type] = swListeners[type] || []).push(fn); }
  };
  const reg = {
    get installing() { return installingSw; },
    addEventListener(type, fn) { (regListeners[type] = regListeners[type] || []).push(fn); }
  };
  const nav = {
    userAgent: 'node-test',
    serviceWorker: { controller: null, register: async () => reg }
  };
  const loadListeners = [];
  const sandbox = {
    console,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    location: {
      protocol: 'https:',
      hostname: 'user.example',
      reload() { sandbox.__reloaded = true; }
    },
    navigator: nav,
    performance: { now() { return 0; } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      getElementById(id) { if (!elements[id]) elements[id] = makeEl(); return elements[id]; },
      querySelector(sel) { if (!elements[sel]) elements[sel] = makeEl(); return elements[sel]; },
      addEventListener() {},
      body: { classList: { toggle() {} } },
      visibilityState: 'visible'
    }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === 'load') loadListeners.push(fn); };
  sandbox.__fireLoad = () => loadListeners.forEach((fn) => fn({}));
  // 模拟：发现新版本 → 安装完成
  sandbox.__fireUpdate = () => {
    installingSw.state = 'installed';
    (regListeners.updatefound || []).forEach((fn) => fn());
    (swListeners.statechange || []).forEach((fn) => fn());
  };
  sandbox.__nav = nav;
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC + HOOK, sandbox, { filename: 'app.js' });
  sandbox.__fireLoad();
  await Promise.resolve(); // 等待 register().then(...) 微任务完成（挂上 updatefound 监听）
  return sandbox;
}

(async () => {
// ---------- A：就绪状态显示横幅，且不自动刷新 ----------
console.log('\n[A] 就绪状态：显示刷新横幅，不自动刷新');
{
  const s = await boot();
  s.__nav.serviceWorker.controller = {}; // 页面正由旧版本 SW 控制
  s.__fireUpdate();
  assert(s.__api.updateReady === true, 'A: 检测到新版本就绪');
  assert(s.__api.els.updateBanner.hidden === false, 'A: 就绪状态显示“发现新版本”横幅');
  assert(!s.__reloaded, 'A: 不自动刷新页面（不中断任何状态）');
}

// ---------- B：训练中抑制，结束后才提示 ----------
console.log('\n[B] 训练中不打扰，训练结束后才提示');
{
  const s = await boot();
  s.__api.state = 'running';
  s.__nav.serviceWorker.controller = {};
  s.__fireUpdate();
  assert(s.__api.updateReady === true, 'B: 新版本已就绪（后台已检测到）');
  assert(s.__api.els.updateBanner.hidden === true, 'B: 训练进行中不显示横幅');
  assert(!s.__reloaded, 'B: 训练中绝不自动刷新');
  s.__api.state = 'completed';
  s.__api.render(); // 训练结束 → updateButtons → maybeShowUpdateBanner
  assert(s.__api.els.updateBanner.hidden === false, 'B: 训练结束后显示刷新横幅');
}

// ---------- C：只有点击“刷新更新”才重载 ----------
console.log('\n[C] 用户点击才重载页面');
{
  const s = await boot();
  s.__nav.serviceWorker.controller = {};
  s.__fireUpdate();
  assert(s.__api.els.updateBanner.hidden === false, 'C: 横幅可见');
  s.__api.els.updateBtn.dispatch('click');
  assert(s.__reloaded === true, 'C: 点击“刷新更新”后重载页面');
}

// ---------- D：首次安装（无旧版本控制）不提示 ----------
console.log('\n[D] 首次安装不弹刷新横幅');
{
  const s = await boot();
  s.__nav.serviceWorker.controller = null; // 首次安装，页面尚未被任何 SW 控制
  s.__fireUpdate();
  assert(s.__api.updateReady === false, 'D: 首次安装不标记为“可更新”');
  assert(s.__api.els.updateBanner.hidden === true, 'D: 首次安装不显示横幅');
}

// ---------- E：暂停状态同样抑制 ----------
console.log('\n[E] 暂停状态不打扰');
{
  const s = await boot();
  s.__api.state = 'paused';
  s.__nav.serviceWorker.controller = {};
  s.__fireUpdate();
  assert(s.__api.els.updateBanner.hidden === true, 'E: 暂停中不显示横幅');
  assert(!s.__reloaded, 'E: 暂停中不自动刷新');
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed > 0) process.exitCode = 1;
})();
