'use strict';
/*
 * 间歇跑 PWA · Service Worker（缓存与更新策略）
 * 发布新版本时必须把 VERSION 上调一级（如 v2 -> v3），详见 README「发布新版本」。
 *
 * 策略总览（按资源类型分别处理，不统一使用同一策略）：
 *   - 导航(HTML)        ：network-first，在线取最新；失败回退缓存首页；成功时同时更新
 *                        './' 与 './index.html' 两个缓存键，保证离线 HTML 也是最新。
 *   - app.js/styles.css/manifest：network-first + 回填缓存，在线即可拿到最新代码。
 *   - 图标等静态资源    ：cache-first，命中即用，缺失才走网络并回填。
 *   - 所有匹配只在本版本缓存 CACHE_NAME 内进行，绝不跨旧缓存搜索，避免新旧版本混用。
 *   - activate 时删除其他版本的缓存；install 时 skipWaiting、activate 时 clientsClaim，
 *     让新 SW 尽快就绪，但页面是否重载由用户通过“刷新更新”横幅决定，训练中不打扰。
 */
const VERSION = 'v3';
const CACHE_NAME = 'run-interval-pwa-' + VERSION;

// 基于 sw.js 自身位置解析绝对 URL，天然兼容 GitHub Pages 子路径部署
const here = (p) => new URL(p, self.location.href).href;
const SHELL_ROOT = here('./');
const SHELL_HTML = here('./index.html');
const CORE_URLS = [
  SHELL_HTML,
  here('./app.js'),
  here('./styles.css'),
  here('./manifest.webmanifest')
];
// 去重：CORE_URLS 已包含 SHELL_HTML，直接展开会重复；
// Cache.addAll() 遇到重复请求会抛 InvalidStateError 导致 install 失败。
const PRECACHE_URLS = [...new Set([
  SHELL_ROOT,
  SHELL_HTML,
  ...CORE_URLS,
  here('./icons/icon-192.png'),
  here('./icons/icon-512.png')
])];

const isCoreAsset = (url) => CORE_URLS.indexOf(url.href) !== -1;
const isCacheable = (response) => Boolean(response) && response.ok;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 导航：network-first，离线回退到本版本缓存中的首页
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
      cache.put(SHELL_HTML, response.clone()); // 保持离线首页为最新
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(SHELL_HTML)) || (await cache.match(SHELL_ROOT)) || (await cache.match(request));
    if (cached) return cached;
    throw error;
  }
}

// 核心 JS/CSS/manifest：network-first，失败回退本版本缓存
async function handleCoreAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

// 图标等静态资源：cache-first，缺失才走网络并回填
async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 只接管本站资源
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isCoreAsset(url)) {
    event.respondWith(handleCoreAsset(request));
    return;
  }
  event.respondWith(handleStaticAsset(request));
});
