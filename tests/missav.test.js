const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const source = read("scripts/missav-clean.js");
const template = read("build/RedCognitio-Ads.plugin.tpl");
const home = read("tests/fixtures/missav-home.html");
const detail = read("tests/fixtures/missav-detail.html");

// fixtures 由 samples/missav/make-fixtures.mjs 从线上真实抓取里抽出，
// 结构（含属性顺序、`&amp;`、转义模板）与线上一致，只是把 directUrls 数组裁短了
function inject(body, argument, url = "https://missav123.com/cn/") {
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
  // vm 里构造的对象跨 realm，deepStrictEqual 比原型会失败，统一走一次 JSON
  return { result: result === undefined ? undefined : JSON.parse(JSON.stringify(result)), logs };
}

const count = (text, needle) => text.split(needle).length - 1;

test("missav：开关关闭 / 空响应 / 非页面响应都不动 body", () => {
  assert.deepEqual(inject(home, { missav_enable: false }).result, {});
  assert.deepEqual(inject(home, JSON.stringify({ missav_enable: "false" })).result, {});
  assert.deepEqual(inject("", { missav_enable: true }).result, {});
  assert.deepEqual(inject('{"data":[]}', { missav_enable: true }).result, {});
  assert.deepEqual(inject("<html><head></head><body>other site</body></html>", { missav_enable: true }).result, {});
});

test("missav 首页：内联 htmlAds、smartpop iframe、联盟推广位全部下线", () => {
  const { result, logs } = inject(home, { missav_enable: true, missav_debug: true });
  const out = result.body;

  assert.equal(logs.length, 1);
  assert.match(
    logs[0],
    /^MISSAV-CLEAN https:\/\/missav123\.com\/cn\/ htmlAds=2 scriptTags=1 iframes=2 partners=\d+ pop=0 placeholder=1 len=/,
  );

  // 广告调度脚本与占位容器
  assert.equal(count(out, "htmlAds"), 0);
  assert.equal(count(out, 'id="html-ads"'), 0);
  // 服务端直出的 smartpop iframe（go.mayzaent.com）
  assert.equal(count(out, "<iframe"), 0);
  assert.equal(count(out, "smartpop/"), 0);
  // head 里的 SCSpotScript
  assert.equal(count(out, "SCSpotScript"), 0);
  // 联盟推广位：32 条 rel="sponsored" 全删，入口「更多好站」也删
  assert.equal(count(out, 'rel="sponsored"'), 0);
  assert.equal(count(out, "showCollapse === &#39;partners&#39;"), 0);
  assert.equal(count(out, "showCollapse === 'partners'"), 0);
  // 兜底样式
  assert.equal(count(out, 'id="missav-ad-clean"'), 1);
  assert.match(out, /<style id="missav-ad-clean">#html-ads,\.under_player,iframe\[src\*="myavlive"\]/, "样式顺序变了");
  assert.match(out, /\{display:none!important\}<\/style>/);
  // 正文与卡片必须留下
  assert.match(out, /missav123\.com\/cn\/marr-015/);
});

test("missav 详情页：只摘 pop() 事件属性，x-data 与 pop() 定义保留", () => {
  const { result } = inject(detail, { missav_enable: true }, "https://missav123.com/cn/marr-015");
  const out = result.body;

  assert.equal(count(out, '@click="pop()"'), 0);
  assert.equal(count(out, "@keyup.space.window"), 0);
  // 定义还在：Alpine 初始化时少一个方法会抛错，updateHash / initClip 共用同一份状态
  assert.match(out, /x-data="\{ baseUrl:/);
  assert.match(out, /pop\(\) \{/);
  assert.match(out, /directUrlsIphone/);
  // 播放器与转义模板不能被写坏
  assert.match(out, /<video\b/);
  assert.equal(count(out, "&lt;iframe"), 1);
  // 详情页三处广告 iframe：under_player smartpop、侧栏 snaptrckr、mavrtracktor / myavlive 网格
  assert.equal(count(out, "smartpop/"), 0);
  assert.match(out, /iframe\[src\*="snaptrckr"\]/);
  assert.equal(count(out, 'src="https://t.snaptrckr.fun'), 0);
  assert.equal(count(out, 'src="https://creative.mavrtracktor.com'), 0);
  assert.equal(count(out, 'src="https://creative.myavlive.com/widgets/v4'), 0);
});

test("missav：重复注入被跳过，输出里带样式标记即视为已处理", () => {
  const first = inject(home, { missav_enable: true }).result.body;
  const again = inject(first, { missav_enable: true, missav_debug: true });
  assert.deepEqual(again.result, {});
  assert.match(again.logs[0], /^MISSAV-CLEAN-DUP /);
});

test("missav：协议相对的广告脚本也要删（//cdn.tsyndicate.com）", () => {
  const page = '<!DOCTYPE html><html><head><title>missav</title></head><body>'
    + '<script src="//cdn.tsyndicate.com/sdk/v1/ms.js" data-ts-subid="missav123.com"></script>'
    + '<div class="mx-auto" style="width: 300px; height: 100px;">'
    + '<iframe width="300px" height="100px" src="https://go.mayzaent.com/smartpop/abc"></iframe></div>'
    + "</body></html>";
  const out = inject(page, { missav_enable: true }).result.body;
  assert.equal(count(out, "cdn.tsyndicate.com"), 0);
  assert.equal(count(out, "<iframe"), 0);
});

test("missav：调试开关独立，关闭时零日志", () => {
  for (const argument of [undefined, { missav_debug: false }, { missav_enable: true }]) {
    assert.deepEqual(inject(home, argument).logs, []);
  }
  for (const argument of [{ missav_debug: true }, JSON.stringify({ missav_debug: true })]) {
    assert.equal(inject(home, argument).logs.length, 1);
  }
  // 其他 App 的调试开关不影响本脚本
  assert.deepEqual(inject(home, { zhihu_debug: true, pica_debug: true }).logs, []);
});

test("missav：Release 构建静默且行为一致", () => {
  const release = path.join(root, "dist/release/scripts/missav-clean.js");
  if (!fs.existsSync(release)) return; // 未构建时跳过，build.test.js 会保证产物存在
  const code = fs.readFileSync(release, "utf8");
  assert(!/console\s*\.|\bdebug\b|missav_debug|__DEBUG__/.test(code));
  for (const [fixture, url] of [[home, "https://missav123.com/cn/"], [detail, "https://missav123.com/cn/marr-015"]]) {
    const releaseOut = (() => {
      let result;
      const logs = [];
      vm.runInNewContext(code, {
        $request: { url },
        $response: { body: fixture, status: 200 },
        $argument: { missav_enable: true, missav_debug: true },
        $done(value) { result = value; },
        console: { log: (...args) => logs.push(args.join(" ")) },
      });
      return { result, logs };
    })();
    const sourceOut = inject(fixture, { missav_enable: true, missav_debug: true }, url);
    assert.equal(releaseOut.result.body, sourceOut.result.body);
    assert.deepEqual(releaseOut.logs, []);
  }
});
