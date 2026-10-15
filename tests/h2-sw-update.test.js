'use strict';
/*
 * H2 回归测试：Service Worker 缓存与更新策略
 * 运行方式（Windows PowerShell）：
 *   cd "C:\Users\Uchiha Itach\WorkBuddy\2026-10-15-13-12-19"
 *   node tests/h2-sw-update.test.js
 * 说明：
 *   - 只用 Node 内置模块（fs/path/vm），零第三方依赖。
 *   - 用 vm 沙箱执行真实 sw.js，以内存 Cache/fetch 桩驱动 install/activate/fetch 事件。
 *   - fetch 桩可切换“在线/离线”，files 可模拟“部署了新版本”。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

const BASE = 'https://user.example/repo';
const SW_URL = BASE + '/sw.js';
const U = {
  root: BASE + '/',
  html: BASE + '/index.html',
  app: BASE + '/app.js',
  css: BASE + '/styles.css',
  manifest: BASE + '/manifest.webmanifest',
  icon192: BASE + '/icons/icon-192.png',
  icon512: BASE + '/icons/icon-512.png'
};

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  PASS: ' + msg); }
  else { failed += 1; console.error('  FAIL: ' + msg); }
}

// ---------- 浏览器环境桩 ----------
function makeResponse(body) {
  return {
    ok: true,
    status: 200,
    type: 'basic',
    clone() { return makeResponse(body); },
    async text() { return body; }
  };
}

function makeServer() {
  const server = { online: true, files: {} };
  server.fetchFn = async (input) => {
    // 兼容相对路径（旧版 sw.js 用 './app.js' 形式），统一解析为绝对 URL
    const url = new URL(typeof input === 'string' ? input : input.url, SW_URL).href;
    if (!server.online) throw new Error('offline');
    const body = server.files[url];
    if (body === undefined) throw new Error('404 ' + url);
    return makeResponse(body);
  };
  return server;
}

function setFiles(server, tag) {
  server.files[U.root] = '<html>' + tag + '</html>';
  server.files[U.html] = '<html>' + tag + '</html>';
  server.files[U.app] = '// app ' + tag;
  server.files[U.css] = '/* css ' + tag + ' */';
  server.files[U.manifest] = '{"v":"' + tag + '"}';
  server.files[U.icon192] = 'PNG192-' + tag;
  server.files[U.icon512] = 'PNG512-' + tag;
}

function makeCachesStub(fetchFn) {
  const stores = new Map();
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, SW_URL).href : r.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      async addAll(urls) {
        // 按规范实现：重复 URL 抛 InvalidStateError（真实浏览器行为，曾导致 install 失败）
        const seen = new Set();
        for (const u of urls) {
          const k = new URL(u, SW_URL).href;
          if (seen.has(k)) {
            const err = new Error('Cache.addAll(): duplicate requests (' + k + ')');
            err.name = 'InvalidStateError';
            throw err;
          }
          seen.add(k);
        }
        for (const u of urls) map.set(new URL(u, SW_URL).href, await fetchFn(u));
      },
      async put(req, res) { map.set(keyOf(req), res); },
      async match(req) { const k = keyOf(req); return map.has(k) ? map.get(k) : null; },
      async keys() { return [...map.keys()]; }
    };
  };
  return {
    open,
    // 故意提供“跨所有缓存搜索”的 match：用于证明旧实现的隐患，新实现不依赖它
    async match(req) {
      const k = keyOf(req);
      for (const m of stores.values()) if (m.has(k)) return m.get(k);
      return null;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    _stores: stores
  };
}

function bootSw(server, cachesStub) {
  const listeners = {};
  const sandbox = {
    console,
    URL, // vm 上下文默认不含 Node 的 URL 全局，显式注入
    caches: cachesStub,
    fetch: server.fetchFn,
    location: { origin: 'https://user.example', href: SW_URL },
    calls: {},
    skipWaiting() { sandbox.calls.skipWaiting = true; },
    clients: {
      claim() { sandbox.calls.claim = true; },
      matchAll: async () => []
    }
  };
  sandbox.self = sandbox;
  sandbox.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  sandbox.__fire = (t, ev) => (listeners[t] || []).forEach((fn) => fn(ev));
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: 'sw.js' });
  vm.runInContext('__precacheUrls = PRECACHE_URLS; __cacheName = CACHE_NAME;', sandbox); // 顶层 const 可在同上下文后续脚本中读取（版本无关：bump 后测试无需改动）
  return sandbox;
}

function swEvent(request) {
  return {
    request,
    waitUntilPromise: null,
    respondPromise: null,
    waitUntil(p) { this.waitUntilPromise = p; },
    respondWith(p) { this.respondPromise = p; }
  };
}

// 触发 install/activate（等待 waitUntil）或 fetch（返回 respondWith 的 Response）
async function fire(sw, type, request) {
  const ev = swEvent(request);
  sw.__fire(type, ev);
  if (type === 'install' || type === 'activate') { await ev.waitUntilPromise; return null; }
  return ev.respondPromise;
}

const getReq = (url, mode) => ({ method: 'GET', url, mode: mode || 'cors' });

(async () => {
// ---------- T1：install 预缓存当前版本 ----------
console.log('\n[T1] install 预缓存与 skipWaiting');
const server = makeServer();
setFiles(server, 'A');
const cachesStub = makeCachesStub(server.fetchFn);
const sw = bootSw(server, cachesStub);
await fire(sw, 'install', null);
assert(sw.calls.skipWaiting === true, 'install 调用 skipWaiting（新 SW 尽快就绪）');
{
  const cur = cachesStub._stores.get(sw.__cacheName);
  assert(Boolean(cur) && cur.size === 7, '当前版本缓存 ' + sw.__cacheName + ' 含 7 个预缓存资源');
  assert(cur.has(U.html) && cur.has(U.root) && cur.has(U.app) && cur.has(U.icon192), '首页/JS/图标等关键资源已预缓存');
  assert(!(await cachesStub.keys()).includes('run-interval-pwa-v1'), '未产生旧版本名缓存');
}
{
  const urls = sw.__precacheUrls;
  assert(Array.isArray(urls) && urls.length === 7, 'PRECACHE_URLS 共 7 个资源');
  assert(new Set(urls).size === urls.length, 'PRECACHE_URLS 中每个 URL 唯一（addAll 不会因重复请求抛 InvalidStateError）');
  assert(urls.indexOf(U.html) !== -1 && urls.indexOf(U.root) !== -1, '首页两个键（./ 与 ./index.html）都在预缓存列表中');
  assert(urls.indexOf(U.app) !== -1 && urls.indexOf(U.css) !== -1 && urls.indexOf(U.manifest) !== -1, 'JS/CSS/manifest 都在预缓存列表中');
  assert(urls.indexOf(U.icon192) !== -1 && urls.indexOf(U.icon512) !== -1, '两个图标都在预缓存列表中');
}

// ---------- T2：在线导航 network-first，且两个首页键都更新 ----------
console.log('\n[T2] 在线导航取最新并回填缓存（修复旧实现只缓存 ./index.html 键的漏洞）');
setFiles(server, 'B'); // 模拟部署了新版本
{
  const res = await fire(sw, 'fetch', getReq(U.root, 'navigate'));
  assert(await res.text() === '<html>B</html>', '在线导航返回网络最新 HTML');
  const cur = cachesStub._stores.get(sw.__cacheName);
  assert(await cur.get(U.html).text() === '<html>B</html>', './index.html 缓存键同步更新为最新');
  assert(await cur.get(U.root).text() === '<html>B</html>', '导航 URL 缓存键同步更新为最新');
}

// ---------- T3：离线导航回退缓存 ----------
console.log('\n[T3] 离线导航回退到缓存首页');
server.online = false;
{
  const res = await fire(sw, 'fetch', getReq(U.root, 'navigate'));
  assert(await res.text() === '<html>B</html>', '离线时使用缓存中的最新首页');
}
server.online = true;

// ---------- T4：在线核心 JS network-first ----------
console.log('\n[T4] 在线 app.js 取最新（network-first）');
server.files[U.app] = '// app C'; // 再次“部署”
{
  const res = await fire(sw, 'fetch', getReq(U.app));
  assert(await res.text() === '// app C', '在线 app.js 返回网络最新代码');
}

// ---------- T5：离线核心 JS 回退最近缓存 ----------
console.log('\n[T5] 离线 app.js 回退到最近一次缓存');
server.online = false;
{
  const res = await fire(sw, 'fetch', getReq(U.app));
  assert(await res.text() === '// app C', '离线 app.js 使用最近一次成功缓存的版本');
}
server.online = true;

// ---------- T6：图标 cache-first ----------
console.log('\n[T6] 图标走 cache-first');
server.files[U.icon192] = 'PNG192-D'; // 网络上有“更新”的图标
{
  const res = await fire(sw, 'fetch', getReq(U.icon192, 'no-cors'));
  assert(await res.text() === 'PNG192-A', '图标命中缓存即返回，不取网络新版');
}

// ---------- T7：绝不跨旧缓存命中（核心安全要求） ----------
console.log('\n[T7] 离线 + 旧版本残留缓存时，不跨缓存命中旧资源');
{
  const oldCache = await cachesStub.open('run-interval-pwa-v1');
  await oldCache.put(U.app, makeResponse('// OLD v1 POISON'));
  const ghost = BASE + '/legacy-removed.js'; // 只存在于旧版本、新版本已移除的资源
  await oldCache.put(ghost, makeResponse('// GHOST from v1'));
  server.online = false;

  const res = await fire(sw, 'fetch', getReq(U.app));
  const text = await res.text();
  assert(text === '// app C', '离线时返回当前版本缓存内容');
  assert(text !== '// OLD v1 POISON', '绝不返回旧版本缓存中的资源（无新旧混用）');

  let ghostError = null;
  try {
    await fire(sw, 'fetch', getReq(ghost));
  } catch (error) { ghostError = error; }
  assert(ghostError !== null, '旧缓存残留的已移除资源不会跨缓存复活（离线直接失败，而非返回旧文件）');

  server.online = true;
}

// ---------- T8：activate 清理旧缓存并 claim ----------
console.log('\n[T8] activate 清理旧版本缓存');
await fire(sw, 'activate', null);
assert(sw.calls.claim === true, 'activate 调用 clientsClaim（尽快接管页面）');
{
  const keys = await cachesStub.keys();
  assert(keys.length === 1 && keys[0] === sw.__cacheName, 'activate 后仅保留当前版本缓存');
}

// ---------- T9：非 GET / 跨域不接管 ----------
console.log('\n[T9] 非 GET 与跨域请求不接管');
{
  const evPost = swEvent({ method: 'POST', url: U.app, mode: 'cors' });
  sw.__fire('fetch', evPost);
  assert(evPost.respondPromise === null, 'POST 请求不被接管');
  const evCross = swEvent({ method: 'GET', url: 'https://other.example/x.js', mode: 'cors' });
  sw.__fire('fetch', evCross);
  assert(evCross.respondPromise === null, '跨域请求不被接管');
}

// ---------- T10：manifest network-first ----------
console.log('\n[T10] manifest 走 network-first');
server.files[U.manifest] = '{"v":"E"}';
{
  const res = await fire(sw, 'fetch', getReq(U.manifest));
  assert(await res.text() === '{"v":"E"}', '在线 manifest 返回最新内容');
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
if (failed > 0) process.exitCode = 1;
})();
