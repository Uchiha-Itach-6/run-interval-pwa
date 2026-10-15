'use strict';
/*
 * H1 回归测试：自定义训练参数在刷新/重开/切预设后是否保留
 * 运行方式（Windows PowerShell）：
 *   cd "C:\Users\Uchiha Itach\WorkBuddy\2026-10-15-13-12-19"
 *   node tests/h1-custom-persistence.test.js
 * 说明：
 *   - 只用 Node 内置模块（fs/path/vm），零第三方依赖，不改变项目结构。
 *   - 用最小 DOM 桩在 vm 沙箱中完整执行 app.js，通过导出的内部 API 驱动真实事件处理器。
 *   - localStorage 快照在多次“启动”之间传递，模拟刷新 / 重新打开应用。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// 在源码末尾追加导出钩子（与 app.js 同一作用域，可访问内部函数与变量）
const EXPORT_HOOK = `
;globalThis.__api = {
  get selectedPlan() { return selectedPlan; },
  get state() { return state; },
  get phases() { return phases; },
  els,
  PRESETS,
  readCustomForm,
  loadSettings,
  saveSettings,
  choosePlan,
  setFormFromPlan
};`;

const SETTINGS_KEY = 'run-interval-pwa-settings-v1';
const CUSTOM_KEY = SETTINGS_KEY + ':custom';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  PASS: ' + msg);
  } else {
    failed += 1;
    console.error('  FAIL: ' + msg);
  }
}

// ---------- 最小 DOM / 浏览器环境桩 ----------
function makeEl() {
  const listeners = {};
  return {
    value: '',
    checked: true,
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

function makeSandbox(persistedStore) {
  const store = Object.assign({}, persistedStore || {});
  const elements = {};
  const sandbox = {
    console,
    // localStorage 内存桩（可跨“启动”通过 store 传递）
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    location: { protocol: 'file:', hostname: 'node-test' },
    navigator: { userAgent: 'node-test' }, // 无 wakeLock / serviceWorker，走降级分支
    performance: { now() { return 0; } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      getElementById(id) { if (!elements[id]) elements[id] = makeEl(); return elements[id]; },
      querySelector(sel) { if (!elements[sel]) elements[sel] = makeEl(); return elements[sel]; },
      addEventListener() {},
      body: { classList: { toggle() {} } },
      visibilityState: 'visible'
    }
  };
  // app.js 使用 window.setInterval / window.addEventListener；让 window 指向沙箱自身
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.__rawStore = store; // 实时 localStorage 内容，供跨“启动”传递
  return sandbox;
}

function boot(persistedStore) {
  const sandbox = makeSandbox(persistedStore);
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC + EXPORT_HOOK, sandbox, { filename: 'app.js' });
  return sandbox;
}

function setForm(api, run, walk, rounds, extra) {
  api.els.runMinutes.value = String(run);
  api.els.walkSeconds.value = String(walk);
  api.els.rounds.value = String(rounds);
  api.els.extraSeconds.value = String(extra);
}

function applyCustom(api, run, walk, rounds, extra) {
  setForm(api, run, walk, rounds, extra);
  api.els.applyCustomBtn.dispatch('click'); // 走真实“应用自定义方案”处理器
}

function selectPlan(api, id) {
  api.els.planSelect.value = id;
  api.els.planSelect.dispatch('change'); // 走真实 change 处理器 → choosePlan
}

function assertCustomPlan(api, tag) {
  const p = api.selectedPlan;
  assert(p && p.id === 'custom', tag + '：当前计划为自定义');
  assert(p.runSec === 600, tag + '：跑步时长恢复为 10 分钟（runSec=600）');
  assert(p.walkSec === 30, tag + '：步行时长恢复为 30 秒');
  assert(p.rounds === 5, tag + '：循环组数恢复为 5');
  assert(p.extraSec === 15, tag + '：末组加时恢复为 15 秒');
}

function assertCustomForm(api, tag) {
  assert(api.els.runMinutes.value === '10', tag + '：表单跑步分钟=10');
  assert(api.els.walkSeconds.value === '30', tag + '：表单步行秒=30');
  assert(api.els.rounds.value === '5', tag + '：表单组数=5');
  assert(api.els.extraSeconds.value === '15', tag + '：表单末组加时=15');
}

// ---------- T0：首次启动默认第 1 周（基线，确保未被破坏） ----------
console.log('\n[T0] 首次启动默认计划');
{
  const api = boot().__api;
  assert(api.selectedPlan.id === 'week1', '默认选中第 1 周');
  assert(api.selectedPlan.runSec === 180 && api.selectedPlan.walkSec === 60 && api.selectedPlan.rounds === 4, '第 1 周参数为默认值 3分/60秒/4组');
  assert(api.PRESETS.week1.runSec === 180, 'PRESETS.week1 未被污染');
}

// ---------- T1：修改自定义参数并应用 ----------
console.log('\n[T1] 修改自定义参数并应用');
const first = boot();
const api1 = first.__api;
applyCustom(api1, 10, 30, 5, 15);
assertCustomPlan(api1, 'T1');
assertCustomForm(api1, 'T1');

// ---------- T2：刷新页面（localStorage 快照原样传递） ----------
console.log('\n[T2] 刷新页面后参数保留');
{
  const api = boot(first.__rawStore).__api;
  assert(api.els.planSelect.value === 'custom', 'T2：刷新后下拉仍选中“自定义”');
  assertCustomForm(api, 'T2');
  assertCustomPlan(api, 'T2');
  const stored = JSON.parse(first.__rawStore[SETTINGS_KEY]);
  assert(stored.selectedId === 'custom', 'T2：localStorage 中 selectedId=custom');
  assert(first.__rawStore[CUSTOM_KEY] && JSON.parse(first.__rawStore[CUSTOM_KEY]).runMinutes === '10', 'T2：自定义参数已单独持久化');
}

// ---------- T3：模拟重新打开应用（JSON 序列化快照，丢弃全部内存状态） ----------
console.log('\n[T3] 重新打开应用后参数保留');
{
  const snapshot = JSON.stringify(first.__rawStore); // 等同 localStorage 落盘后再读回
  const api = boot(JSON.parse(snapshot)).__api;
  assert(api.els.planSelect.value === 'custom', 'T3：重开后下拉仍选中“自定义”');
  assertCustomForm(api, 'T3');
  assertCustomPlan(api, 'T3');
  assert(api.phases.length === 10, 'T3：按 5 组×(跑+走) 重建出 10 个阶段');
  assert(api.phases[8].durationSec === 615 && api.phases[8].round === 5, 'T3：末组跑步含 15 秒加时（600+15=615 秒）');
}

// ---------- T4：切换到其他预设，再切回自定义 ----------
console.log('\n[T4] 切到预设再切回自定义');
{
  const api = boot(first.__rawStore).__api; // 已应用过自定义
  selectPlan(api, 'week2');
  assert(api.selectedPlan.id === 'week2' && api.selectedPlan.runSec === 240, 'T4：切换到第 2 周参数正确（240 秒）');
  assert(api.els.runMinutes.value === '4' && api.els.extraSeconds.value === '60', 'T4：预设选中时表单同步为第 2 周参数');
  selectPlan(api, 'custom');
  assert(api.els.planSelect.value === 'custom', 'T4：切回自定义');
  assertCustomForm(api, 'T4');
  assertCustomPlan(api, 'T4');
}

// ---------- T5：预设计划默认参数不被自定义污染 ----------
console.log('\n[T5] 预设不被自定义参数污染');
{
  const s = boot(first.__rawStore);
  const api = s.__api;
  selectPlan(api, 'custom'); // 确保处于自定义
  assert(api.PRESETS.week1.runSec === 180, 'T5：PRESETS.week1 仍为 180 秒');
  assert(api.PRESETS.week2.runSec === 240 && api.PRESETS.week2.extraSec === 60, 'T5：PRESETS.week2 仍为 240 秒/加时 60 秒');
  assert(api.PRESETS.week3.runSec === 360 && api.PRESETS.week3.rounds === 3, 'T5：PRESETS.week3 仍为 360 秒/3 组');
  assert(api.PRESETS.custom.runSec === 180, 'T5：PRESETS.custom 默认值仍为 180 秒');
  selectPlan(api, 'week1');
  assert(api.selectedPlan.runSec === 180 && api.selectedPlan.rounds === 4, 'T5：选中第 1 周时使用预设默认值，而非自定义值');
}

// ---------- T6：预设计划刷新后仍正常（第一至三周） ----------
console.log('\n[T6] 预设计划持久化不受影响');
{
  const s1 = boot();
  selectPlan(s1.__api, 'week3');
  const s2 = boot(s1.__rawStore).__api;
  assert(s2.selectedPlan.id === 'week3' && s2.selectedPlan.runSec === 360 && s2.selectedPlan.rounds === 3, 'T6：刷新后第 3 周参数正确（360 秒/3 组）');
  assert(s2.els.runMinutes.value === '6' && s2.els.rounds.value === '3', 'T6：表单同步为第 3 周参数');
}

// ---------- T7：第四周连续跑（stopwatch）不受影响 ----------
console.log('\n[T7] 第四周连续跑模式不受影响');
{
  const s1 = boot();
  selectPlan(s1.__api, 'week4c');
  const s2 = boot(s1.__rawStore).__api;
  assert(s2.selectedPlan.mode === 'stopwatch' && s2.selectedPlan.targetKm === 3, 'T7：刷新后第 4 周训练 3 仍为连续跑模式');
  assert(s2.phases.length === 0, 'T7：连续跑模式不生成间歇阶段');
  const s3 = boot();
  selectPlan(s3.__api, 'custom');
  const s4 = boot(s3.__rawStore).__api;
  assert(s4.selectedPlan.mode === 'interval', 'T7：自定义仍为间歇模式（未被连续跑污染）');
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed > 0) process.exitCode = 1;
