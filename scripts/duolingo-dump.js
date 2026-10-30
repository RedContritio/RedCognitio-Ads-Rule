/* SPDX-License-Identifier: Apache-2.0 */

// 多邻国判据诊断（仅 Debug 构建）
//
// 用途：duolingo-clean.js 改完三处字段如果还出插屏，说明「放不放广告」的判据不在资格层。
// 那时需要知道同一次响应里还有哪些候选键，本脚本把**键名结构**打到 Loon 日志，不落任何值。
//
// 判据层次：
//   ① 资格层   subscriberLevel / shopItems / trackingProperties（clean 脚本已覆盖）
//   ② 广告配置 adsConfig / adConfig / promo* / placements / sessionEndAd 这类与订阅并列下发的键
//   ③ 实验层   experiments / abTests —— 广告开关大量挂在 A/B 分组上，最可能是「改了订阅仍出推广」的真因
//
// 用法：Debug 构建里开「多邻国-调试」，冷启动一次，Loon 日志过滤 DUODUMP。
// Release 构建不含本脚本（build.mjs 只把它放进 debug）。

const PREFIX = "DUODUMP ";
const KEY_RE = /ad|promo|subscri|premium|max|gold|experiment|abtest|placement|entitle|shop|tracking|paywall|upsell|reward/i;
const MAX_DEPTH = 4;
const MAX_KEYS = 400;

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
const enabled = arg?.duolingo_debug === true || arg?.duolingo_debug === "true";

const body = $response && typeof $response.body === "string" ? $response.body : "";
const short = String(($request && $request.url) || "").split("?")[0];

function collect(node, prefix, depth, out) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH || out.length >= MAX_KEYS) return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    const path = prefix ? prefix + "." + key : key;
    if (/^[a-z0-9_]{1,40}$/i.test(key) && KEY_RE.test(key)) {
      const kind = Array.isArray(value) ? "array" : typeof value;
      out.push(path + ":" + kind);
    }
    if (value && typeof value === "object") collect(value, path, depth + 1, out);
  }
}

if (!enabled) {
  $done({});
} else if (!body) {
  console.log(PREFIX + "NOBODY " + short);
  $done({});
} else {
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") {
    console.log(PREFIX + "SKIP " + short);
    $done({});
  } else {
    const keys = [];
    if (Array.isArray(payload.responses)) {
      payload.responses.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;
        const raw = entry.body;
        let inner = raw;
        if (typeof raw === "string") {
          try {
            inner = JSON.parse(raw);
          } catch (e) {
            console.log(PREFIX + "PARSE-FAIL responses[" + index + "] " + short);
            return;
          }
        }
        collect(inner, "responses[" + index + "]", 0, keys);
      });
    } else {
      collect(payload, "", 0, keys);
    }
    console.log(PREFIX + short + " " + JSON.stringify(Array.from(new Set(keys))));
    $done({});
  }
}
