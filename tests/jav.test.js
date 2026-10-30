const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const source = read("scripts/jav-clean.js");
const template = read("build/RedCognitio-Ads.plugin.tpl");
const page18av = read("tests/fixtures/jav-18av.html");
const pageNjav = read("tests/fixtures/jav-njav.html");

const count = (text, needle) => text.split(needle).length - 1;

function inject(body, argument, url = "https://18av.mm-cg.com/") {
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
  return { result: result === undefined ? undefined : JSON.parse(JSON.stringify(result)), logs };
}

test("jav：开关关闭 / 空响应 / 非页面响应都不动 body", () => {
  assert.deepEqual(inject(page18av, { jav_enable: false }).result, {});
  assert.deepEqual(inject("", { jav_enable: true }).result, {});
  assert.deepEqual(inject('{"data":[]}', { jav_enable: true }).result, {});
  assert.deepEqual(inject("not html", { jav_enable: true }).result, {});
});

test("jav 18av：服务端直出的 ExoClick iframe（协议相对 + 单引号）全部删除，正常 iframe 保留", () => {
  const { result, logs } = inject(page18av, { jav_enable: true, jav_debug: true });
  const out = result.body;

  assert.equal(logs.length, 1);
  assert.match(logs[0], /^JAVCLEAN https:\/\/18av\.mm-cg\.com\/ iframes=2 scripts=0 slots=0 len=/);
  assert.equal(count(out, "magsrv.com/iframe.php"), 0);
  assert.equal(count(out, '<iframe src="https://embed.example-player.com'), 1);
  assert.equal(count(out, 'id="jav-ad-clean"'), 1);
  // 正常条目与 GTM 标签都不动
  assert.match(out, /正常条目/);
  assert.match(out, /googletagmanager\.com\/gtag\/js/);
});

test("jav njav：ad-provider.js、<ins> 广告位与内联 popMagic 全删，应用脚本保留", () => {
  const { result, logs } = inject(pageNjav, { jav_enable: true, jav_debug: true }, "https://njav.tv/en");
  const out = result.body;

  assert.match(logs[0], /^JAVCLEAN https:\/\/njav\.tv\/en iframes=0 scripts=\d slots=1 len=/);
  assert.equal(count(out, "ad-provider.js"), 0);
  assert.equal(count(out, "AdProvider = window.AdProvider"), 0);
  assert.equal(count(out, "var popMagic="), 0);
  assert.equal(count(out, "<ins"), 0);
  assert.equal(count(out, 'src="/build/app.js"'), 1);
  assert.match(out, /<h1>合法内容<\/h1>/);
});

test("jav：重复注入被跳过；调试日志默认不输出", () => {
  const once = inject(page18av, { jav_enable: true }).result.body;
  const again = inject(once, { jav_enable: true, jav_debug: true });
  assert.deepEqual(again.result, {});
  assert.match(again.logs[0], /^JAVCLEAN-DUP /);

  for (const argument of [undefined, { jav_debug: false }, { jav_enable: true }]) {
    assert.deepEqual(inject(page18av, argument).logs, []);
  }
  assert.deepEqual(inject(page18av, { missav_debug: true }).logs, []);
});

test("jav：不误伤名字里带广告域的链接与站内 window.open", () => {
  const page = [
    "<!DOCTYPE html><html><head><title>t</title></head><body>",
    '<a href="https://example.com/exoclick-review">评测</a>',
    "<script>function go(u){window.open(u,'_blank')}</script>",
    '<script src="/js/app.js"></script>',
    "</body></html>",
  ].join("");
  const out = inject(page, { jav_enable: true }).result.body;
  assert.match(out, /example\.com\/exoclick-review/);
  assert.match(out, /window\.open/);
  assert.match(out, /\/js\/app\.js/);
});

test("jav：合集里的开关、广告域、QUIC、注入与 MITM 都已接线", () => {
  assert.match(template, /^jav_enable = switch,true,/m);
  assert.match(template, /^jav_debug = switch,false,/m);
  for (const host of ["exoclick.com", "exosrv.com", "magsrv.com", "pemsrv.com", "realsrv.com", "jads.co", "juicyads.com", "tsyndicate.com", "trafficjunky.net"]) {
    assert.ok(template.includes(`DOMAIN-SUFFIX,${host},REJECT`), host);
  }
  for (const site of ["18av.mm-cg.com", "njav.tv", "javdb.com", "javbus.com", "javgg.net", "supjav.com"]) {
    assert.ok(template.includes(site), site);
  }
  assert.ok(template.includes("jav-clean.js"), "缺少注入脚本");
  assert.match(template, /AND,\(\(DOMAIN-SUFFIX,18av\.mm-cg\.com\),\(PROTOCOL,QUIC\)\),REJECT/);
  const mitm = template.match(/\[MITM\]\nhostname = (.+)/)[1].split(/,\s*/);
  for (const host of ["18av.mm-cg.com", "*.18av.mm-cg.com", "njav.tv", "javdb.com", "*.javbus.com", "javgg.net", "supjav.com"]) {
    assert.ok(mitm.includes(host), host);
  }
});
