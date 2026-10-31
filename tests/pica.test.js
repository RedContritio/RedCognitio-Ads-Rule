const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const source = read("scripts/pica-clean.js");
const urlModule = read("build/RedCognitio-Ads.plugin.tpl");

const activeLines = (text) =>
  text.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));

// PicaWeb 的 SPA 外壳：广告注入只认 PicaWeb 标记，页面结构按线上 index.html 精简
const HOME = [
  "<!DOCTYPE html><html lang=\"zh-CN\"><head>",
  "<meta charset=\"UTF-8\">",
  "<meta name=\"application-name\" content=\"PicaWeb\">",
  "<title>PicaWeb - 哔咔漫画网页版</title>",
  "<link rel=\"manifest\" href=\"/manifest.json\">",
  "<script type=\"module\" crossorigin src=\"/assets/js/index-ea_4Germ.js\"></script>",
  "</head><body><div id=\"root\"></div></body></html>",
].join("");

// 线上 bundle 里的广告容器 className（feature-comics-*.js）
const AD_CLASSES = [
  ".reader-ad-fullpage",
  ".comic-detail-page-ad",
  ".comic-detail-ad-mobile-container",
  ".comic-detail-ad-desktop-wrapper",
  ".chapter-navigation__ad",
  ".vw-ad-container",
  ".vw-ad-placeholder",
  ".ads-container",
  ".ads-skeleton-container",
  ".dual-page-content--ad",
  ".cats-item-ad",
  ".cats-tag-ad",
];

function inject(body, argument, url = "https://manhuabika.com/") {
  let result;
  const logs = [];
  vm.runInNewContext(source, {
    $request: { url },
    $response: { body, status: 200 },
    $argument: argument,
    $done(value) {
      assert.equal(result, undefined, "脚本不得多次 $done");
      result = value;
    },
    console: { log(...args) { logs.push(args.join(" ")); } },
  });
  return { result, logs };
}

function runtimeOf(html) {
  const match = html.match(/<script id="pica-ad-runtime">([\s\S]*?)<\/script>/);
  assert(match, "注入结果缺少运行时脚本");
  return match[1];
}

function styleOf(html) {
  const match = html.match(/<style id="pica-ad-clean">([\s\S]*?)<\/style>/);
  assert(match, "注入结果缺少样式");
  return match[1];
}

// ── 极简 DOM：只实现注入运行时真正用到的接口 ──
function boot(state = {}) {
  const events = [];
  let clock = 0;
  const raf = [];
  const timers = [];
  const observers = [];

  const document = {
    documentElement: {},
    querySelector(selector) {
      if (selector === ".reader-ad-fullpage") return state.ad || null;
      if (selector === ".dual-page-content--ad") return state.dual || null;
      if (selector === ".page-nav-button.nav-right") return state.navRight || null;
      return null;
    },
    addEventListener(type, handler) {
      (this.listeners = this.listeners || []).push({ type, handler });
    },
    dispatchEvent(event) {
      events.push({ ...event, at: clock });
      (this.listeners || []).filter((l) => l.type === event.type).forEach((l) => l.handler(event));
      return true;
    },
  };

  class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
      this.defaultPrevented = false;
    }
    preventDefault() { this.defaultPrevented = true; }
  }

  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  }

  const nativeCalls = [];
  const window = {
    fetch(input) {
      nativeCalls.push(typeof input === "string" ? input : input.url);
      return Promise.resolve({ passthrough: true });
    },
    requestAnimationFrame(callback) { raf.push(callback); },
  };
  if (state.serviceWorker) window.navigator = { serviceWorker: state.serviceWorker };
  if (state.caches) window.caches = state.caches;

  vm.runInNewContext(runtimeOf(inject(HOME, { pica_enable: true }).result.body), {
    window,
    document,
    location: { href: "https://manhuabika.com/" },
    URL,
    Response,
    Promise,
    KeyboardEvent,
    MutationObserver,
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    Date,
  });

  return {
    state, window, document, events, nativeCalls,
    mutate() { observers.forEach((observer) => observer.callback([])); },
    flushRaf() { while (raf.length) raf.shift()(); },
    flushTimers() { timers.splice(0).forEach(({ callback }) => callback()); },
    tick(at) {
      clock = at;
      const realNow = Date.now;
      Date.now = () => at;
      try {
        this.mutate();
        this.flushRaf();
      } finally {
        Date.now = realNow;
      }
    },
  };
}

// ───────────────────────── 模块规则 ─────────────────────────

test("注入规则只命中 SPA 页面，不命中静态资源与接口", () => {
  const line = urlModule.split("\n").find((text) => text.includes("pica-clean.js"));
  assert(line, "缺少注入规则");
  const pattern = line.match(/~= \/(.*?)\/i then/)[1];
  assert(!pattern.includes(","), "规则以逗号分隔字段，正则内不得出现逗号");
  const expression = new RegExp(pattern, "i");
  const cases = [
    ["https://manhuabika.com/", true],
    ["https://manhuabika.com/pdownload", true],
    ["https://manhuabika.com/comic/5822a6e3ad7ede654696e482/1", true],
    ["https://manhuabika.com/comic/reader/5822a5bcad7ede6546963762/1", true],
    ["https://www.picacomic.com/pdownload", true],
    ["https://manhuabika.com/assets/js/feature-comics-CkieQqfF.js", false],
    ["https://manhuabika.com/assets/css/index-CPKaKLL-.css", false],
    ["https://manhuabika.com/locales/zh/common.json", false],
    ["https://manhuabika.com/manifest.json", false],
    ["https://manhuabika.com/icons/apple-touch-icon-180x180.png", false],
    ["https://picaapi.manhuabika.com/api/v1/banners", false],
    ["https://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=zone_8", false],
  ];
  for (const [url, expected] of cases) {
    assert.equal(expression.test(url), expected, url);
  }
});

// ───────────────────────── 注入 ─────────────────────────

test("PicaWeb 的 Service Worker 注册地址被拒，静态资源与接口不受影响", () => {
  for (const file of ["build/RedCognitio-Ads.plugin.tpl"]) {
    const line = read(file).split("\n").find((text) => text.includes("sw\\.js"));
    assert(line, `${file}: 缺少 SW 拒绝规则`);
    const pattern = line.match(/~= \/(.*?)\/ then reject/)[1];
    assert(!pattern.includes(",") || file.endsWith(".tpl"), `${file}: 正则内不得出现逗号`);
    const expression = new RegExp(pattern);
    assert.equal(expression.test("https://manhuabika.com/sw.js"), true, file);
    assert.equal(expression.test("https://manhuabika.com/workbox-c9d5555e.js"), true, file);
    assert.equal(expression.test("https://www.manhuabika.com/workbox-abc.js"), true, file);
    assert.equal(expression.test("https://manhuabika.com/assets/js/index-ea_4Germ.js"), false, file);
    assert.equal(expression.test("https://manhuabika.com/manifest.json"), false, file);
  }
});

test("SW 拒绝规则必须落在 [Rewrite] 段，写进 [Script] 段会被 Loon 当成脚本规则", () => {
  for (const file of ["build/RedCognitio-Ads.plugin.tpl", "RedCognitio-Ads.plugin"]) {
    const lines = read(file).split("\n");
    const rewrite = lines.findIndex((line) => line.trim() === "[Rewrite]");
    const script = lines.findIndex((line) => line.trim() === "[Script]");
    const rule = lines.findIndex((line) => line.startsWith("request ") && line.includes("sw\\.js"));
    assert(rewrite >= 0 && script > rewrite, `${file}: 段结构异常`);
    assert(rule > rewrite && rule < script, `${file}: SW 拒绝规则不在 [Rewrite] 段`);
  }
});

test("首页 HTML 注入样式与运行时，且只注入一次", () => {
  const first = inject(HOME, { pica_enable: true });
  assert(first.result.body.includes('id="pica-ad-clean"'));
  assert(first.result.body.includes('id="pica-ad-runtime"'));
  assert(first.result.body.indexOf("pica-ad-clean") < first.result.body.indexOf("</head>"),
    "应注入在 head 结束前");
  assert.equal((first.result.body.match(/<\/head>/g) || []).length, 1, "不得改动文档结构");

  const second = inject(first.result.body, { pica_enable: true, pica_debug: true });
  assert.equal(second.result.body, undefined, "重复注入应原样放行");
  assert(second.logs.some((log) => log.startsWith("PICA-CLEAN-DUP")));
});

test("样式覆盖线上 bundle 的每一个广告容器", () => {
  const css = styleOf(inject(HOME, { pica_enable: true }).result.body);
  for (const selector of AD_CLASSES) {
    assert(css.includes(selector), `样式缺少 ${selector}`);
  }
  assert(css.includes("display:none!important"));
  // 阅读器广告页只隐藏不删除：React 下一次 setState 会引用这个节点
  assert(!/\.reader-ad-fullpage[^{]*\{[^}]*animation/.test(css));
});

test("非 HTML、无 PicaWeb 标记、开关关闭时都不改响应", () => {
  const api = inject('{"code":200,"data":{"zones":[]}}', { pica_enable: true }, "https://manhuabika.com/api/v1/banners");
  assert.equal(api.result.body, undefined);

  const foreign = inject("<!DOCTYPE html><html><head><title>嗶咔漫畫2。0</title></head><body></body></html>",
    { pica_enable: true }, "https://www.picacomic.com/");
  assert.equal(foreign.result.body, undefined, "下载页不是 PicaWeb，不应注入");

  const off = inject(HOME, { pica_enable: false, pica_debug: true });
  assert.equal(off.result.body, undefined);
  assert(off.logs.some((log) => log.startsWith("PICA-CLEAN-OFF")));
});

test("缺少 head 结束标签时退回到 body 起始处注入", () => {
  const bare = "<!DOCTYPE html><html><head><title>PicaWeb</title><body><div id=\"root\"></div></body></html>";
  const body = inject(bare, { pica_enable: true }).result.body;
  assert(body.includes('id="pica-ad-clean"'));
  assert(body.indexOf("pica-ad-clean") > body.indexOf("<body"));
});

// ───────────────────────── 运行时 ─────────────────────────

test("广告位接口被短路成空广告池，其余请求照常发出", async () => {
  const dom = boot();
  const stub = await dom.window.fetch("https://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=zone_8,zone_24,zone_11");
  assert.equal(stub.status, 200);
  const payload = await stub.json();
  // 跨 vm realm 的对象原型不同，按 JSON 比较
  assert.equal(JSON.stringify(payload), '{"code":200,"data":{"zones":[]}}');
  assert.equal(stub.headers.get("content-type"), "application/json");
  // 空 zones 走 SPA 的「暂无广告内容」分支，不会进重试
  assert.equal(dom.nativeCalls.length, 0, "广告请求不应真正发出");

  const passthrough = await dom.window.fetch("https://picaapi.manhuabika.com/api/v1/comics");
  assert.equal(passthrough.passthrough, true);
  assert.deepEqual(dom.nativeCalls, ["https://picaapi.manhuabika.com/api/v1/comics"]);
});

test("阅读器停在广告页时派发一次下一页", () => {
  const ad = { name: "ad" };
  const dom = boot({ ad });
  dom.document.addEventListener("keydown", () => {});

  dom.tick(1000);
  const keys = dom.events.filter((event) => event.type === "keydown");
  assert.equal(keys.length, 1, "应派发一次键盘翻页");
  assert.equal(keys[0].key, "ArrowRight");
  assert.equal(keys[0].bubbles, true);
});

test("键盘翻页后仍未离开广告页，退回到翻页按钮点击", () => {
  const navRight = { disabled: false, click() { this.clicked = true; } };
  const dom = boot({ ad: { name: "ad" }, navRight });

  dom.tick(1000);
  assert.equal(dom.events.length, 1);
  dom.flushTimers();
  assert.equal(navRight.clicked, true, "应点击下一页按钮兜底");
});

test("双页模式的广告页优先点它自己的下一页按钮", () => {
  let clicked = 0;
  const next = { disabled: false, click() { clicked += 1; } };
  const dom = boot({ ad: { name: "ad" }, dual: { querySelector: () => next } });

  dom.tick(1000);
  assert.equal(clicked, 1);
  assert.equal(dom.events.length, 0, "双页模式不应再派发键盘事件");
});

test("同一个广告页最多尝试三次，避免死循环", () => {
  const dom = boot({ ad: { name: "ad" } });
  for (let i = 0; i < 8; i += 1) dom.tick(1000 + i * 2000);
  assert.equal(dom.events.length, 3, "同一广告页节点的派发次数应封顶");
  assert.equal(dom.state.ad !== null, true);
});

test("离开广告页后计数复位，下一处广告页继续跳过", () => {
  const dom = boot({ ad: { name: "ad-1" } });
  for (let i = 0; i < 4; i += 1) dom.tick(1000 + i * 2000);
  assert.equal(dom.events.length, 3);

  dom.state.ad = null;
  dom.tick(30000);
  dom.state.ad = { name: "ad-2" };
  dom.tick(40000);
  assert.equal(dom.events.length, 4, "新广告页应重新获得派发机会");
});

test("任意十秒窗口内最多派发六次，防止阅读器拒绝翻页时空转", () => {
  const dom = boot({ ad: { name: "ad" } });
  // 每 1 秒换一个新节点：模拟 React 每次重渲染都换 DOM，节点身份判重失效
  for (let i = 0; i < 40; i += 1) {
    dom.state.ad = { name: `ad-${i}` };
    dom.tick(1000 + i * 1000);
  }
  assert(dom.events.length > 6, "长时间停留应仍在尝试，只是被限速");
  for (const event of dom.events) {
    const window = dom.events.filter((other) => other.at >= event.at && other.at < event.at + 10000);
    assert(window.length <= 6, `${event.at} 起十秒内有 ${window.length} 次派发`);
  }
  const gaps = dom.events.slice(1).map((event, index) => event.at - dom.events[index].at);
  assert(gaps.every((gap) => gap >= 800), "相邻派发间隔不得小于冷却时间");
});

test("运行时注销 Service Worker 并清空 CacheStorage，防止缓存壳绕过注入", async () => {
  const unregistered = [];
  const deleted = [];
  const dom = boot({
    serviceWorker: {
      controller: {},
      register() { return Promise.resolve("should-not-happen"); },
      getRegistrations() {
        return Promise.resolve([
          { unregister() { unregistered.push("a"); } },
          { unregister() { unregistered.push("b"); } },
        ]);
      },
    },
    caches: {
      keys() { return Promise.resolve(["workbox-precache", "images-cache"]); },
      delete(key) { deleted.push(key); return Promise.resolve(true); },
    },
  });
  // 注册被打成空实现：App 再调只会拿到 rejected promise，不会真的装回 SW
  await assert.rejects(dom.window.navigator.serviceWorker.register(), /pica-ad-clean/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(unregistered, ["a", "b"]);
  assert.deepEqual(deleted, ["workbox-precache", "images-cache"]);
});

test("运行时重复执行不会挂第二套 MutationObserver", () => {
  const observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
  }
  const runtime = runtimeOf(inject(HOME, { pica_enable: true }).result.body);
  const sandbox = {
    window: { fetch() {}, requestAnimationFrame() {} },
    document: { documentElement: {}, querySelector: () => null, addEventListener() {} },
    location: { href: "https://manhuabika.com/" },
    URL, Response, Promise, Date, setTimeout,
    KeyboardEvent: class {},
    MutationObserver,
  };
  vm.runInNewContext(runtime, sandbox);
  const afterFirst = observers.length;
  sandbox.window.__picaAdClean = true;
  vm.runInNewContext(runtime, sandbox);
  assert.equal(observers.length, afterFirst, "重复执行应直接返回");
});
