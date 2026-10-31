const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const source = read("scripts/duolingo-clean.js");
const dumpSource = read("scripts/duolingo-dump.js");
const template = read("build/RedCognitio-Ads.plugin.tpl");

const BATCH = "https://ios-api-cf.duolingo.com/2023-05-23/batch";
const USER = "https://ios-api-cf.duolingo.com/2023-05-23/users/123456";

function inject(body, argument, url = BATCH, code = source) {
  let result;
  const logs = [];
  vm.runInNewContext(code, {
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

const freeUserdata = () => ({
  id: 123456,
  subscriberLevel: "FREE",
  trackingProperties: { has_item_gold_subscription: false },
  shopItems: [],
  currentCourse: { pathSectioned: [{ units: [{ levels: [{ state: "locked" }, { state: "active" }] }] }] },
  streak: 41,
});

const wrapped = (userdata, headers = {}) => ({
  responses: [{ headers, body: JSON.stringify(userdata) }, { headers: { "content-type": "application/json" }, body: "{\"ok\":true}" }],
});

const goldOf = (userdata) => userdata.shopItems.filter((item) => item && item.id === "gold_subscription");

test("多邻国：开关关闭 / 空响应 / 非 JSON / 无关 JSON 都不动 body", () => {
  assert.deepEqual(inject(JSON.stringify(wrapped(freeUserdata())), { duolingo_enable: false }).result, {});
  assert.deepEqual(inject("", { duolingo_enable: true }).result, {});
  assert.deepEqual(inject("not-json", { duolingo_enable: true }).result, {});
  assert.deepEqual(inject("null", { duolingo_enable: true }).result, {});
  assert.deepEqual(inject('{"type":"lesson","challenges":[]}', { duolingo_enable: true }).result, {});
  assert.deepEqual(inject(JSON.stringify([1, 2, 3]), { duolingo_enable: true }).result, {});
});

test("多邻国 batch（body 为字符串）：三处字段一起改，其它内容原样保留", () => {
  const body = JSON.stringify(wrapped(freeUserdata()));
  const { result } = inject(body, { duolingo_enable: true });
  const userdata = JSON.parse(result.body).responses[0].body;
  const parsed = JSON.parse(userdata);

  assert.equal(parsed.subscriberLevel, "GOLD");
  for (const name of ["immersive", "premium", "live", "gold", "max"]) {
    assert.equal(parsed.trackingProperties["has_item_" + name + "_subscription"], true, name);
  }
  const gold = goldOf(parsed);
  assert.equal(gold.length, 1);
  assert.equal(gold[0].purchasePrice, 0);
  assert.equal(gold[0].subscriptionInfo.productId, "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168");
  assert.equal(gold[0].subscriptionInfo.renewer, "APPLE");
  assert.equal(gold[0].subscriptionInfo.renewing, true);
  assert.equal(gold[0].subscriptionInfo.tier, "twelve_month");
  assert.equal(gold[0].subscriptionInfo.type, "gold");
  assert(gold[0].subscriptionInfo.expectedExpiration > Math.floor(Date.now() / 1000));

  assert.equal(parsed.streak, 41);
  assert.equal(parsed.id, 123456);
  assert.equal(parsed.currentCourse.pathSectioned[0].units[0].levels[0].state, "locked");
});

test("多邻国 batch（body 已是对象）：原地改，body 不变成字符串", () => {
  const body = JSON.stringify({ responses: [{ headers: {}, body: freeUserdata() }] });
  const { result } = inject(body, { duolingo_enable: true });
  const entry = JSON.parse(result.body).responses[0];
  assert.equal(typeof entry.body, "object");
  assert.equal(entry.body.subscriberLevel, "GOLD");
  assert.equal(goldOf(entry.body).length, 1);
});

test("多邻国 etag：带 etag 的条目整条放行，不改 body", () => {
  const body = JSON.stringify(wrapped(freeUserdata(), { ETag: "W/\"abc\"" }));
  const { result } = inject(body, { duolingo_enable: true });
  assert.deepEqual(result, {});
});

test("多邻国 batch 混合条目：只改没有 etag 且是 userdata 的那条", () => {
  const body = JSON.stringify({
    responses: [
      { headers: { etag: "x" }, body: JSON.stringify(freeUserdata()) },
      { headers: {}, body: JSON.stringify(freeUserdata()) },
      { headers: {}, body: JSON.stringify({ meta: { version: 3 } }) },
    ],
  });
  const { result } = inject(body, { duolingo_enable: true });
  const responses = JSON.parse(result.body).responses;
  assert.equal(JSON.parse(responses[0].body).subscriberLevel, "FREE", "etag 条目必须原样");
  assert.equal(JSON.parse(responses[1].body).subscriberLevel, "GOLD");
  assert.equal(responses[2].body, JSON.stringify({ meta: { version: 3 } }), "非 userdata 条目原样");
});

test("多邻国 users/{id}（裸 userdata）：整体改写", () => {
  const { result } = inject(JSON.stringify(freeUserdata()), { duolingo_enable: true }, USER);
  const parsed = JSON.parse(result.body);
  assert.equal(parsed.subscriberLevel, "GOLD");
  assert.equal(goldOf(parsed).length, 1);
  assert.equal(parsed.streak, 41);
});

test("多邻国：幂等，重复命中不重复堆订阅", () => {
  const first = inject(JSON.stringify(wrapped(freeUserdata())), { duolingo_enable: true }).result.body;
  const second = inject(first, { duolingo_enable: true }).result.body;
  const third = inject(second, { duolingo_enable: true }).result.body;
  const parsed = JSON.parse(JSON.parse(third).responses[0].body);
  assert.equal(goldOf(parsed).length, 1);
  assert.equal(parsed.subscriberLevel, "GOLD");
});

test("多邻国：已有金标订阅时只续期，不改商品号", () => {
  const userdata = freeUserdata();
  userdata.subscriberLevel = "GOLD";
  userdata.shopItems = [{
    id: "gold_subscription",
    purchaseDate: 1,
    purchasePrice: 0,
    subscriptionInfo: { expectedExpiration: 2, productId: "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168", renewer: "APPLE", renewing: false, tier: "twelve_month", type: "gold" },
  }];
  const { result } = inject(JSON.stringify(userdata), { duolingo_enable: true }, USER);
  const parsed = JSON.parse(result.body);
  assert.equal(goldOf(parsed).length, 1);
  assert.equal(parsed.shopItems[0].purchaseDate, 1, "不改购买时间");
  assert(parsed.shopItems[0].subscriptionInfo.expectedExpiration > Math.floor(Date.now() / 1000));
  assert.equal(parsed.shopItems[0].subscriptionInfo.renewing, true);
});

test("多邻国：不碰经验加成 / 关卡状态 / 挑战时长 / 题池", () => {
  const userdata = freeUserdata();
  userdata.shopItems = [{ id: "xp_boost_stackable", purchaseDate: 5, expectedExpirationDate: 6, purchasePrice: 0 }];
  const { result } = inject(JSON.stringify(userdata), { duolingo_enable: true }, USER);
  const parsed = JSON.parse(result.body);
  assert.equal(parsed.shopItems.filter((item) => item.id === "xp_boost_stackable").length, 1);
  assert.equal(parsed.shopItems.find((item) => item.id === "xp_boost_stackable").purchaseDate, 5);
  assert.equal(parsed.currentCourse.pathSectioned[0].units[0].levels[0].state, "locked");
  assert.equal(parsed.liveOpsChallenges, undefined);
  assert.equal(parsed.challenges, undefined);
});

test("多邻国：空 shopItems / 缺 trackingProperties 都能补齐", () => {
  const userdata = { id: 9, subscriberLevel: "NONE" };
  const { result } = inject(JSON.stringify(userdata), { duolingo_enable: true }, USER);
  const parsed = JSON.parse(result.body);
  assert.equal(goldOf(parsed).length, 1);
  assert.deepEqual(Object.keys(parsed.trackingProperties).sort(), [
    "has_item_gold_subscription",
    "has_item_immersive_subscription",
    "has_item_live_subscription",
    "has_item_max_subscription",
    "has_item_premium_subscription",
  ]);
});

test("多邻国：调试开关只在 debug 构建打日志，且 release 产物静默", () => {
  const debugSource = read("scripts/duolingo-clean.js");
  const debugRun = inject(JSON.stringify(wrapped(freeUserdata())), { duolingo_enable: true, duolingo_debug: true }, BATCH, debugSource);
  assert.ok(debugRun.logs.some((line) => line.startsWith("DUOLINGO-CLEAN ")), debugRun.logs.join("|"));

  const release = path.join(root, "dist/release/scripts/duolingo-clean.js");
  if (fs.existsSync(release)) {
    const code = fs.readFileSync(release, "utf8");
    assert(!/console\s*\.|\bdebug\b|duolingo_debug|__DEBUG__|DUOLINGO-CLEAN/.test(code));
    assert.deepEqual(inject(JSON.stringify(wrapped(freeUserdata())), { duolingo_enable: true, duolingo_debug: true }, BATCH, code).logs, []);
  }
});

test("多邻国 dump：只输出键名，不输出值，且要求调试开关打开", () => {
  const userdata = freeUserdata();
  userdata.adsConfig = { enabled: true, placements: [{ id: "sessionEnd" }] };
  userdata.experiments = { ads_free_tier: "treatment" };
  const body = JSON.stringify(wrapped(userdata));
  const on = inject(body, { duolingo_debug: true }, BATCH, dumpSource);
  assert.deepEqual(on.result, {});
  const line = on.logs.find((text) => text.startsWith("DUODUMP "));
  assert.ok(line, on.logs.join("|"));
  for (const needle of ["adsConfig:object", "experiments:object", "subscriberLevel", "shopItems:array"]) {
    assert(line.includes(needle), `${needle} 不在 ${line}`);
  }
  assert(!line.includes("treatment"), "不得输出字段值");
  assert(!line.includes("123456"), "不得输出用户标识");

  const off = inject(body, { duolingo_debug: false }, BATCH, dumpSource);
  assert.deepEqual(off.logs, []);
});
