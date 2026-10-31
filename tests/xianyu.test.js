const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const pluginLines = () => read("build/RedCognitio-Ads.plugin.tpl").split("\n");
const activeLines = () => pluginLines().filter((line) => !line.trim().startsWith("#") && line.trim());

function ruleFor(needle, kind = "jq") {
  const line = activeLines().find(
    (text) => text.includes(needle)
      && (kind === "jq" ? text.includes("response.json.jq(") : kind === "delete"
        ? text.includes("response.json.delete(")
        : text.includes("reject_dict("))
  );
  assert(line, `缺少 ${needle} 的 ${kind} 规则`);
  return line;
}

function runJq(needle, body) {
  const line = ruleFor(needle);
  const program = JSON.parse(line.slice(line.indexOf("response.json.jq(") + 17, -1));
  const result = spawnSync("jq", ["-c", program], { input: JSON.stringify(body), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function ruleExpression(needle, kind = "jq") {
  const line = ruleFor(needle, kind);
  return new RegExp(line.match(/~= \/(.*?)\/i then/)[1], "i");
}

const GW = "https://acs.m.goofish.com/gw/";
const sidebarCard = (cardType) => ({ data: { clickParam: { args: { cardType } } }, template: { name: "any" } });

// ───────────────────────── 开屏 ─────────────────────────

const splashBody = {
  ret: ["SUCCESS::调用成功"],
  data: {
    requestId: "req-1",
    adMap: { "2026-10-26": [{ fromDsp: "mamaAd", adTypeCode: "1" }] },
    cacheAdInfo: { fromDsp: "mamaAd" },
    realTimeAd: { showType: "csj" },
    dspList: ["csj", "ylh"],
    hotStartInterval: 60,
    spaceIdMap: { ylhShowSpaceId: "2138110733853185" },
  },
};

test("开屏响应清空广告池并保留 data 对象与业务字段", () => {
  const out = runJq("idlecommerce\\.splash", splashBody);
  assert.deepEqual(out.data.adMap, {});
  assert.equal(out.data.cacheAdInfo, null);
  assert.equal(out.data.realTimeAd, null);
  assert.equal(out.data.requestId, "req-1");
  assert.deepEqual(out.data.spaceIdMap, { ylhShowSpaceId: "2138110733853185" });
  assert.deepEqual(out.ret, ["SUCCESS::调用成功"]);
});

test("开屏异常响应原样直通", () => {
  assert.deepEqual(runJq("idlecommerce\\.splash", { data: null }), { data: null });
  assert.deepEqual(
    runJq("idlecommerce\\.splash", { ret: ["FAIL_SYS_TOKEN_EXOIRED::令牌过期"] }),
    { ret: ["FAIL_SYS_TOKEN_EXOIRED::令牌过期"] }
  );
});

test("开屏必须清缓存而非只拦请求：同步失败会走异步预取回填缓存", () => {
  const requestRejects = activeLines().filter((line) => line.startsWith("request ") && /idlecommerce\.splash/.test(line));
  assert.deepEqual(requestRejects, [], "开屏不得使用请求级拒绝");
  const line = ruleFor("idlecommerce\\.splash");
  assert(line.includes("cacheAdInfo = null"), "必须一并清 cacheAdInfo");
  assert(line.includes("adMap = {}"), "必须一并清 adMap");
});

test("开屏规则同时覆盖同步与异步接口，并兼容 goofish / taobao 两个网关", () => {
  const expression = ruleExpression("idlecommerce\\.splash");
  for (const url of [
    `${GW}mtop.taobao.idlecommerce.splash.ads/2.0/`,
    `${GW}mtop.taobao.idlecommerce.splash.async.ads/1.0/`,
    "https://g-acs.m.goofish.com/gw/mtop.taobao.idlecommerce.splash.ads/2.0/",
    "https://acs.m.taobao.com/gw/mtop.taobao.idlecommerce.splash.ads/2.0/",
  ]) {
    assert(expression.test(url), url);
  }
  assert(!expression.test(`${GW}mtop.taobao.idlecommerce.adx.bid/1.0/`));
});

// ───────────────────────── 信息流 ─────────────────────────

test("首页信息流只剔除 mamaAD / homeMultiBanner 卡", () => {
  const body = {
    ret: ["SUCCESS::调用成功"],
    data: {
      sections: [
        sidebarCard("normal"),
        sidebarCard("mamaAD"),
        sidebarCard("homeMultiBanner"),
        { template: { name: "noCardType" } },
        sidebarCard("fxCard"),
      ],
    },
  };
  const out = runJq("idlehome\\.home\\.nextfresh", body);
  assert.deepEqual(out.data.sections.map((s) => s.data?.clickParam?.args?.cardType ?? null),
    ["normal", null, "fxCard"]);
  assert.equal(out.data.sections.length, 3);
});

test("首页新版卡片页同时剔除 banner 与 mamaAD", () => {
  const body = { data: { sections: [sidebarCard("common"), sidebarCard("banner"), sidebarCard("mamaAD")] } };
  const out = runJq("idlehome\\.home\\.newitem\\.page", body);
  assert.deepEqual(out.data.sections.map((s) => s.data.clickParam.args.cardType), ["common"]);
});

test("缺少 data 或 sections 时信息流规则不改写响应", () => {
  for (const needle of ["idlehome\\.home\\.nextfresh", "idlehome\\.home\\.newitem\\.page", "idle\\.local\\.home\\/"]) {
    assert.deepEqual(runJq(needle, { ret: ["SUCCESS::"] }), { ret: ["SUCCESS::"] }, needle);
    assert.deepEqual(runJq(needle, { data: { sections: null } }), { data: { sections: null } }, needle);
  }
});

test("同城首页剔除 cardEnum=ads 的段", () => {
  const body = {
    data: {
      sections: [
        { template: { cardEnum: "ads" } },
        { template: { cardEnum: "normal" } },
        { template: {} },
      ],
    },
  };
  const out = runJq("idle\\.local\\.home\\/", body);
  assert.deepEqual(out.data.sections, [{ template: { cardEnum: "normal" } }, { template: {} }]);
});

const searchItem = (bizType) => ({
  data: { item: { main: { exContent: { dislikeFeedback: { clickParam: { args: { bizType } } } } } } },
});

test("搜索结果剔除 bizType=ad 的条目并保留普通结果", () => {
  const body = { data: { resultList: [searchItem("item"), searchItem("ad"), { data: { item: {} } }, searchItem("ad")] } };
  const out = runJq("idlemtopsearch\\.search\\/", body);
  assert.equal(out.data.resultList.length, 2);
  assert.equal(out.data.resultList[0].data.item.main.exContent.dislikeFeedback.clickParam.args.bizType, "item");
});

// ───────────────────────── 整段推广位与开关 ─────────────────────────

// ───────────────────────── 诊断脚本 ─────────────────────────

function runScript(filename, { url, body, argument = { xianyu_debug: true } }) {
  const logs = [];
  let done;
  vm.runInNewContext(read(`scripts/${filename}`), {
    $request: { url, method: "POST" },
    $response: { body: typeof body === "string" ? body : JSON.stringify(body), status: 200, headers: {} },
    $argument: argument,
    $done(value) { done = value; },
    console: { log: (...args) => logs.push(args.join(" ")) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(done)), {});
  return logs;
}

test("XYDUMP 按 1200 字符切段并保留首尾标记", () => {
  const body = "x".repeat(2600);
  const logs = runScript("xianyu-dump.js", { url: `${GW}mtop.taobao.idlecommerce.splash.ads/2.0/`, body });
  assert(logs[0].startsWith("XYDUMP-BEGIN "));
  assert(logs[0].includes("len=2600"));
  assert(logs.at(-1).startsWith("XYDUMP-END "));
  const chunks = logs.filter((line) => /^XYDUMP-\d+ /.test(line));
  assert.equal(chunks.length, 3);
  assert.equal(chunks.map((line) => line.split(" ")[1]).join(""), body);
});

test("XYFEED 只报卡片类型与广告键，不回显正文", () => {
  const feed = {
    ret: ["SUCCESS::调用成功"],
    data: [
      { type: "item", id: "item-1", data: { itemId: "1" } },
      { type: "ad", id: "ad-1", advId: "8001", isAliMaMaAD: true, children: [{ type: "ad", id: "ad-1-child" }] },
    ],
  };
  const logs = runScript("xianyu-feed-probe.js", { url: `${GW}mtop.taobao.idle.home.firstdata/5.0/`, body: feed });
  assert.equal(logs.length, 1);
  const report = JSON.parse(logs[0].slice("XYFEED ".length));
  assert.deepEqual(report.lists[0].cards[1].keys.sort(), ["advId", "isAliMaMaAD"]);
  assert.deepEqual(report.lists[0].cards[1].nested, [{ type: "ad", id: "ad-1-child", keys: [] }]);
  assert(!logs[0].includes("itemId"));
});

test("XYFEED 遇到非 JSON 只报解析错误", () => {
  const logs = runScript("xianyu-feed-probe.js", { url: `${GW}mtop.taobao.idle.home.firstdata/5.0/`, body: "<html>" });
  assert.deepEqual(logs, [`XYFEED-PARSE-ERROR ${GW}mtop.taobao.idle.home.firstdata/5.0/`]);
});
