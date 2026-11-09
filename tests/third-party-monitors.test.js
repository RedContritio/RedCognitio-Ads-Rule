const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const plugins = [
  "RedCognitio-Ads.plugin", "RedCognitio-Ads-ghproxy.plugin", "RedCognitio-Ads-jsdelivr.plugin",
  "RedCognitio-Ads-debug.plugin", "RedCognitio-Ads-debug-ghproxy.plugin", "RedCognitio-Ads-debug-jsdelivr.plugin",
];

// 2026-11-09 12:03 日志：`DOMAIN,miaozhen.com` 是精确匹配，子域 yktd.m.cn.miaozhen.com 直接 DIRECT。
// 三方监测/归因厂商一律用 DOMAIN-SUFFIX，只有阿里妈妈 mmstat.com 保持精确匹配（子域承担淘客归因）。
test("三方监测厂商按后缀拦截，秒针子域不再漏网", () => {
  const suffixed = ["admaster.com.cn", "attri.mobi", "rtbasia.com", "hegek7.com", "adbug.cn", "gridsum.com", "miaozhen.com", "doubleclick.net"];
  for (const file of plugins) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    for (const domain of suffixed) {
      assert(lines.includes(`DOMAIN-SUFFIX,${domain},REJECT,extended-matching,pre-matching`), `${file}: ${domain}`);
      assert(!lines.includes(`DOMAIN,${domain},REJECT,extended-matching,pre-matching`), `${file}: 仍在用精确匹配 ${domain}`);
    }
    assert(lines.includes("DOMAIN,mmstat.com,REJECT,extended-matching,pre-matching"), file);
  }
});

test("调查期临时 MITM 的素材/AB 主机已撤（长期观察模式）", () => {
  for (const file of plugins) {
    const mitm = fs.readFileSync(path.join(root, file), "utf8").match(/\[MITM\]\nhostname = (.+)/)[1]
      .split(",").map(s => s.trim());
    for (const host of ["ossgw.alicdn.com", "abtest.alibaba.com", "yixiu-abtest.alicdn.com"]) {
      assert(!mitm.includes(host), `${file}: 不应再 MITM ${host}`);
    }
  }
});
