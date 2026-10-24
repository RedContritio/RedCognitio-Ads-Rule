const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const plugins = ["RedCognitio-Ads.plugin", "RedCognitio-Ads-ghproxy.plugin", "RedCognitio-Ads-jsdelivr.plugin"];

function run(script, argument, request, body) {
  const logs = [];
  let result;
  const context = {
    $argument: argument,
    $request: { method: "GET", ...request },
    $response: { status: 200, headers: { "Content-Type": "application/json" }, body },
    console: { log: (...args) => logs.push(args.join(" ")) },
    $done(value) {
      assert.equal(result, undefined, "complete once");
      result = value;
    },
  };
  const original = JSON.stringify([context.$request, context.$response]);
  vm.runInNewContext(fs.readFileSync(path.join(root, "scripts", script), "utf8"), context);
  assert.equal(JSON.stringify([context.$request, context.$response]), original);
  return { result: JSON.parse(JSON.stringify(result)), logs };
}

test("debug is default-off, accepts object and JSON arguments and stays isolated per app", () => {
  const cases = [
    ["zhihu-clean.js", "zhihu_debug", "https://api.zhihu.com/search_v3", '{"data":[]}'],
    ["Taobao-ads-clean.js", "taobao_debug", "https://poplayer.template.alibaba.com/test.json", '{"enable":true}'],
    ["netease-debug.js", "netease_debug", "https://music.163.com/eapi/batch", ""],
    ["zhihu-dump.js", "zhihu_debug", "https://api.zhihu.com/answers/v2/123", '{"id":123}'],
    ["zhihu-dump-req.js", "zhihu_debug", "https://api.zhihu.com/answers/v2/123", ""],
  ];
  for (const [script, key, url, body] of cases) {
    const otherApps = Object.fromEntries(["zhihu_debug", "taobao_debug", "netease_debug"].filter(k => k !== key).map(k => [k, true]));
    const off = run(script, undefined, { url }, body);
    assert.deepEqual(off.logs, [], script);
    for (const argument of [undefined, null, {}, "invalid", "null", false, otherApps,
      ...[false, "false", 0, 1, "1"].flatMap(value => [{ [key]: value }, JSON.stringify({ [key]: value })])]) {
      assert.deepEqual(run(script, argument, { url }, body), off, `${script}: ${JSON.stringify(argument)}`);
    }
    for (const value of [true, "true"]) {
      for (const argument of [{ [key]: value }, JSON.stringify({ [key]: value })]) {
        const on = run(script, argument, { url }, body);
        assert(on.logs.length > 0, script);
        assert.deepEqual(on.result, off.result, script);
      }
    }
  }
});

test("Zhihu debug leaves all filtering modes and pagination unchanged", () => {
  const body = JSON.stringify({ data: [
    { type: "feed_advert" },
    { type: "zvideo", id: "video" },
    { type: "answer", id: "locked", paid_info: { has_purchased: false } },
    { type: "answer", id: "free" },
  ], paging: { next: "/next", is_end: false } });
  for (const zhihu_enable of [true, false]) {
    for (const zhihu_purify of [true, false]) {
      const argument = { zhihu_enable, zhihu_purify };
      const request = { url: "https://api.zhihu.com/topstory/recommend" };
      const off = run("zhihu-clean.js", argument, request, body);
      const on = run("zhihu-clean.js", { ...argument, zhihu_debug: true }, request, body);
      assert.deepEqual(off.logs, []);
      assert.deepEqual(on.result, off.result);
      assert(on.logs.length > 0);
    }
  }
});

test("parse errors and full search dumps are emitted only with the owning debug flag", () => {
  for (const [script, key, url, prefix] of [
    ["zhihu-clean.js", "zhihu_debug", "https://api.zhihu.com/search_v3", "ZHCLEAN-BADJSON"],
    ["Taobao-ads-clean.js", "taobao_debug", "https://poplayer.template.alibaba.com/test.json", "[Taobao-ads-clean] JSON"],
  ]) {
    for (const body of ["not-json", ""]) {
      const off = run(script, {}, { url }, body);
      const on = run(script, { [key]: true }, { url }, body);
      assert.deepEqual(off, { result: {}, logs: [] });
      assert.deepEqual(on.result, off.result);
      if (body || key === "zhihu_debug") assert(on.logs.some(line => line.startsWith(prefix)));
      if (key === "zhihu_debug") assert(on.logs.some(line => line.startsWith("ZHSEARCH-BODY ")));
    }
  }
});

test("Taobao debug preserves cleanup across all three response formats", () => {
  const cases = [
    ["https://guide-acs.m.taobao.com/gw/mtop.taobao.wireless.home.splash.awesome.get", {
      data: { containers: { splash_home_base: { base: { sections: [{ bizData: { "taobao-splash": { data: [{ imgUrl: "ad.jpg", videoUrl: "ad.mp4" }] } } }] } } } },
    }, obj => obj.data.containers.splash_home_base.base.sections[0].bizData["taobao-splash"].data[0].imgUrl === ""],
    ["https://guide-acs.m.taobao.com/gw/mtop.taobao.cloudvideo.video.query", {
      data: { duration: "10", resources: ["ad.mp4"], caches: ["ad"] },
    }, obj => obj.data.duration === "0" && obj.data.resources.length === 0],
    ["https://poplayer.template.alibaba.com/test.json", {
      enable: true, res: { images: ["ad.jpg"], videos: ["ad.mp4"] }, mainRes: { images: ["ad.jpg"] },
    }, obj => obj.enable === false && obj.res.images.length === 0],
  ];
  for (const [url, body, verify] of cases) {
    const off = run("Taobao-ads-clean.js", {}, { url }, JSON.stringify(body));
    const on = run("Taobao-ads-clean.js", { taobao_debug: true }, { url }, JSON.stringify(body));
    assert.deepEqual(off.logs, []);
    assert.deepEqual(off.result, on.result);
    assert(verify(JSON.parse(off.result.body)));
    assert.equal(JSON.parse(on.logs[0].slice(8)).changed, true);
  }
});

test("Netease debug records request metadata and passes the request through", () => {
  const request = { method: "POST", url: "https://music.163.com/eapi/batch?scene=home", body: "encrypted", headers: { Cookie: "private" } };
  const { result, logs } = run("netease-debug.js", { netease_debug: true }, request, "");
  assert.deepEqual(result, {});
  assert.deepEqual(logs.map(line => JSON.parse(line.slice(9))), [{ method: "POST", url: request.url }]);
});

test("all distributions declare default-off flags and pass only the owning debug argument", () => {
  const modules = [
    ["Zhihu-URL.module", ["zhihu"]], ["Taobao-URL.module", ["taobao"]],
    ["NetEase-CloudMusic-URL.module", ["netease"]],
    ["Zhihu-Dump.module", ["zhihu"]], ["Zhihu-Dump-ghproxy.module", ["zhihu"]],
  ];
  for (const [file, apps] of [...plugins.map(file => [file, ["zhihu", "taobao", "netease"]]), ...modules]) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    for (const app of apps) {
      assert.equal(lines.filter(line => line.startsWith(`${app}_debug = switch,false,type=boolean,`)).length, 1, file);
    }
    for (const line of lines.filter(line => line.includes("then script(") && !line.includes("zhihu-ad-preload.js"))) {
      const app = line.includes("Taobao-ads-clean.js") ? "taobao" : line.includes("netease-debug.js") ? "netease" : "zhihu";
      assert(line.includes('${' + app + '_debug}'), file);
      const args = line.match(/, \{(.*?)\}\) with/)[1];
      for (const other of ["zhihu", "taobao", "netease"].filter(name => name !== app)) assert(!args.includes(other + "_debug"), file);
      assert(line.includes(app === "zhihu" ? "?v=1.1.0" : "?v=0.2.0"), file);
      if (app === "netease" || file.includes("Dump")) {
        assert(line.startsWith(`request if \${${app}_debug} == true &&`) || line.startsWith(`response if \${${app}_debug} == true &&`), file);
        if (app === "netease") assert(!line.includes("requires_body=true"), file);
      }
    }
  }
});

test("Netease debug URL guard matches API hosts and excludes unrelated traffic", () => {
  for (const file of [...plugins, "NetEase-CloudMusic-URL.module"]) {
    const rule = fs.readFileSync(path.join(root, file), "utf8").split("\n").find(line => line.includes("then script(") && line.includes("netease-debug.js"));
    const expression = new RegExp(rule.match(/~= \/(.*?)\/i then/)[1], "i");
    for (const url of ["https://music.163.com/eapi/batch", "https://interface.music.163.com/api/song/detail", "https://music.163.com/xeapi/ad/loading/judge"]) assert(expression.test(url), file);
    for (const url of ["https://music.163.com.evil.test/api/batch", "https://taobao.com/eapi/batch", "https://music.163.com/song?id=1", "https://p1.music.126.net/cover.jpg"]) assert(!expression.test(url), file);
  }
});
