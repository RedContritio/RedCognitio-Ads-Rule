const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

const builder = import("../tools/build.mjs");
const metadata = JSON.parse(read("build/build.json"));
const template = read("build/RedCognitio-Ads.plugin.tpl");
const dumpScript = read("scripts/amap-dump.js");
const doc = read("Amap.md");

const section = (text, name) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  assert(start >= 0, `缺少 [${name}] 段`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\[[A-Za-z]+\]$/.test(line.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => line.trim() && !line.trim().startsWith("#"));
};

const SPLASH_POOL = "https://m5.amap.com/ws/valueadded/alimama/splash_screen";
const SPLASH_RT = "https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?ent=2";

function amapResponseRules() {
  return section(template, "Rewrite")
    .filter((line) => line.includes("${amap_enable}") && line.includes("response.json.jq("))
    .map((line) => {
      const match = line.match(/^response if \$\{amap_enable\} == true && \$\{url\} ~= \/(.*?)\/ then response\.json\.jq\("(.*)"\)$/);
      assert(match, `高德响应规则格式不符：${line}`);
      assert(!match[1].includes(","), `正则内不得出现逗号：${line}`);
      return { regex: new RegExp(match[1]), program: JSON.parse(`"${match[2]}"`), line };
    });
}

const runJq = (program, body) => {
  const result = spawnSync("jq", ["-c", program], { input: JSON.stringify(body), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

// 线上响应形状：池化链路给 data.ad，实时链路给 data.custom_list[].creative[]
const POOL_BODY = {
  code: "1",
  data: { session_id: "sess", ad: [{ cid: "c1", video_url: "v", setting: { d: { display_time: 5 } }, creative: [{ start_time: 1, end_time: 2 }] }] },
};
const RT_BODY = { code: "1", data: { session_id: "sess", custom_list: [{ creative: [{ sync_tag: 1, dsp_name: "mama" }] }] } };

// ───────────────────────── 合集内的高德规则 ─────────────────────────

test("净化后 code 为 7、data 为空对象：走成功分支清池且不下载素材", () => {
  const rules = amapResponseRules();
  const pool = rules.find((rule) => rule.regex.test(SPLASH_POOL));
  const rt = rules.find((rule) => rule.regex.test(SPLASH_RT));
  // 池化链路：Callback#b() 认 1/7 → remove(afp_splash_events) + dc2.m(null) → data.ad 为空
  assert.deepEqual(runJq(pool.program, POOL_BODY), { code: "7", data: {} });
  // 实时链路：a.c() 认 1/7 后取 data，a.f() 找不到 custom_list 即判无素材
  assert.deepEqual(runJq(rt.program, RT_BODY), { code: "7", data: {} });
  // 即使服务端回了错误码或空结构，也统一改写成「今日无广告」
  for (const body of [{ code: "3", message: "Params error" }, {}, { code: "7" }]) {
    assert.deepEqual(runJq(pool.program, body), { code: "7", data: {} });
  }
});

test("iOS 侧换成其他 amap 主机同样命中", () => {
  const rules = amapResponseRules();
  for (const url of [
    "http://pre-gateway.amap.com/ws/valueadded/alimama/splash_screen",
    "https://m5-x.amap.com/ws/valueadded/alimama/splash_screen",
    "https://aos.amap.com/ws/valueadded/alimama/splash_screen",
    "https://pre-amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?ent=2",
  ]) {
    assert(rules.some((rule) => rule.regex.test(url)), `${url} 未命中任何规则`);
  }
});

test("不误伤同域业务接口与通用图床", () => {
  const rules = amapResponseRules();
  for (const url of [
    "https://m5.amap.com/ws/shield/dsp/app/startup/init/ws/mapapi/conf/init/",
    "https://m5.amap.com/ws/valueadded/weather/v2",
    "https://amap-aos-info-nogw.amap.com/ws/banner/lists",
    "https://m5.amap.com/ws/device/adius/",
    "https://gw.alicdn.com/tfs/TB1abcdef.jpg",
    "https://aoscdn.amap.com/colorbase/2026.png",
    "https://evil-amap.com/ws/valueadded/alimama/splash_screen",
    "https://amap.com.evil.net/ws/valueadded/alimama/splash_screen",
  ]) {
    assert(!rules.some((rule) => rule.regex.test(url)), `${url} 被误伤`);
  }
});

// ───────────────────────── 构建产物 ─────────────────────────

test("诊断脚本按段输出响应体，默认不打印", () => {
  assert(dumpScript.includes("AMDEBUG"), "缺少请求标记");
  assert(dumpScript.includes("AMDUMP-BEGIN"), "缺少响应体起始标记");
  assert(dumpScript.includes("AMDUMP-END"), "缺少响应体结束标记");
  assert(dumpScript.includes("arg?.amap_debug === true"), "缺少开关判断");
});

// ───────────────────────── 文档一致性 ─────────────────────────
