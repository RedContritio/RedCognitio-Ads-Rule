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

test("开屏两条链路都按 amap_enable 做字段净化", () => {
  const rules = amapResponseRules();
  assert.equal(rules.length, 2, "高德开屏只有两条链路");
  for (const url of [SPLASH_POOL, SPLASH_RT]) {
    const hits = rules.filter((rule) => rule.regex.test(url));
    assert.equal(hits.length, 1, `${url} 应命中且只命中一条规则`);
  }
});

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

test("开屏用到的两个主机做 QUIC 降级，且不做 amap.com 全域降级", () => {
  const lines = section(template, "Rule").map((line) => line.replace(/\s+/g, ""));
  for (const host of ["m5.amap.com", "amap-aos-info-nogw.amap.com"]) {
    assert(lines.includes(`AND,((DOMAIN,${host}),(PROTOCOL,QUIC)),REJECT`), `${host} 缺少 QUIC REJECT`);
  }
  assert(!lines.some((line) => line.startsWith("AND,((DOMAIN-SUFFIX,amap.com)")), "不得全域降级 QUIC");
});

test("MITM 覆盖两个开屏主机", () => {
  const hostnames = section(template, "MITM").join("\n")
    .replace(/^hostname\s*=\s*/i, "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  for (const host of ["m5.amap.com", "amap-aos-info-nogw.amap.com"]) {
    assert(hostnames.includes(host), `MITM 缺 ${host}`);
  }
  assert(!hostnames.includes("amap.com"), "不得对 amap.com 全域开 MITM");
});

test("两个开关：去广告默认开、调试默认关", () => {
  const args = section(template, "Argument");
  assert(args.some((line) => /^amap_enable = switch,true,/.test(line)), "缺 amap_enable 或默认值不对");
  assert(args.some((line) => /^amap_debug = switch,false,/.test(line)), "缺 amap_debug 或默认值不对");
});

// ───────────────────────── 构建产物 ─────────────────────────

test("Release 构建剥离调试开关与诊断脚本，保留去广告规则", async () => {
  const { generateArtifacts } = await builder;
  const artifacts = await generateArtifacts(metadata);
  for (const [filename, content] of artifacts) {
    if (!filename.endsWith(".plugin")) continue;
    assert(content.includes("${amap_enable} == true"), `${filename}: 缺高德去广告规则`);
    assert(content.includes("m5.amap.com"), `${filename}: MITM 缺 m5`);
    if (filename.includes("-debug")) {
      assert(content.includes("amap_debug = switch,false,"), `${filename}: 缺调试开关`);
      assert(content.includes("amap-dump.js"), `${filename}: 缺诊断脚本`);
    } else {
      assert(!content.includes("amap_debug"), `${filename}: Release 不应含调试开关`);
      assert(!content.includes("amap-dump.js"), `${filename}: Release 不应含诊断脚本`);
    }
  }
  assert(artifacts.has("dist/debug/scripts/amap-dump.js"), "Debug 构建应产出诊断脚本");
  assert(!artifacts.has("dist/release/scripts/amap-dump.js"), "Release 不应产出诊断脚本");
});

test("诊断脚本按段输出响应体，默认不打印", () => {
  assert(dumpScript.includes("AMDEBUG"), "缺少请求标记");
  assert(dumpScript.includes("AMDUMP-BEGIN"), "缺少响应体起始标记");
  assert(dumpScript.includes("AMDUMP-END"), "缺少响应体结束标记");
  assert(dumpScript.includes("arg?.amap_debug === true"), "缺少开关判断");
});

// ───────────────────────── 文档一致性 ─────────────────────────

test("维护文档记录两条链路、开关名与样本指纹", () => {
  for (const needle of [
    "/ws/valueadded/alimama/splash_screen",
    "/ws/aos/alimama/splash_screen_rt",
    "m5.amap.com",
    "amap-aos-info-nogw.amap.com",
    "amap_enable",
    "amap_debug",
    "17.02.0.2010",
    "8367a35e1279be691c036307e2acfafe8870d32eefe30986f6e186a569a64dc9",
  ]) {
    assert(doc.includes(needle), `Amap.md 缺少 ${needle}`);
  }
  assert(!/Amap-(URL|Domain|Dump)\.module/.test(doc), "文档不应再引用已删除的独立模块");
});
