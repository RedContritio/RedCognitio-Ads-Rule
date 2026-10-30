/* SPDX-License-Identifier: Apache-2.0 */

// JAV 站族通用去广告（ExoClick / JuicyAds / TrafficStars / TrafficJunky 这一层）
//
// 与 missav 那份（missav-clean.js）的分工：
//   missav 是「站内自建」的广告——内联 htmlAds、首方 /pop 中转、播放器 @click="pop()"，
//   只能按站点锚点删。
//   本脚本处理的是「同一套第三方广告网络铺在很多站上」的部分，判据是广告网络本身，
//   不是站点：脚本行会变、容器类名会换，但 ad-provider.js / iframe.php? 这些特征不变。
//
// 覆盖的两种投放形态（2026-10-30 实测）：
//   1. 服务端直出 iframe —— 18av：<iframe src='//a.magsrv.com/iframe.php?idzone=…&size=300x250'>
//   2. JS 注入 —— njav/123AV：<script src="a.magsrv.com/ad-provider.js"> + <ins data-zoneid> +
//      (AdProvider = window.AdProvider || []).push({serve:{}})，popMagic 弹窗就在这个 SDK 里
//
// 做四件事：删广告 iframe、删广告脚本（含 AdProvider 引导脚本）、删 <ins> 广告位、补 CSS 兜底。
// 站点列表在合集 [Script] / [MITM] 里维护；新增一个站 = 加一个域名，脚本不用改。

const STYLE_ID = "jav-ad-clean";

const AD_HOSTS = [
  "magsrv\\.com", "pemsrv\\.com", "exosrv\\.com", "exoclick\\.com", "realsrv\\.com",
  "jads\\.co", "jads\\.cc", "juicyads\\.com", "tsyndicate\\.com",
  "trafficjunky\\.net", "trafficjunky\\.com",
];

// 只匹配「主机名正好是这批广告域（或其子域）」的 URL，避免误伤名字里带 exoclick 的正常外链
const AD_URL_RE = new RegExp(
  "^(?:https?:)?\\/\\/(?:[a-z0-9-]+\\.)*(?:" + AD_HOSTS.join("|") + ")(?:[/?#:]|$)",
  "i",
);

// 广告 SDK 的内联引导脚本特征（ExoClick 的 ad-provider / popMagic）
const SDK_MARKS = ["AdProvider", "popMagic"];

const HIDE = [
  'iframe[src*="magsrv"]',
  'iframe[src*="pemsrv"]',
  'iframe[src*="exosrv"]',
  'iframe[src*="exoclick"]',
  'iframe[src*="realsrv"]',
  'iframe[src*="jads."]',
  'iframe[src*="juicyads"]',
  'iframe[src*="tsyndicate"]',
  'iframe[src*="trafficjunky"]',
  // ExoClick 的广告位占位：<ins class="eas6a97888e6" data-zoneid="…">
  'ins[data-zoneid]',
  'ins[class^="eas"]',
];

const STYLE = `<style id="${STYLE_ID}">${HIDE.join(",")}{display:none!important}</style>`;

function srcOf(tag) {
  const quoted = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
  return quoted ? quoted[1] : "";
}

function isAdUrl(url) {
  return AD_URL_RE.test(url);
}

// 删广告 iframe（成对出现才算，避免把自闭合写法漏掉）
function dropAdIframes(html) {
  let hits = 0;
  html = html.replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, (pair) => {
    if (!isAdUrl(srcOf(pair))) return pair;
    hits += 1;
    return "";
  });
  html = html.replace(/<iframe\b[^>]*\/>/gi, (tag) => {
    if (!isAdUrl(srcOf(tag))) return tag;
    hits += 1;
    return "";
  });
  return { html, hits };
}

// 删广告脚本：外链 src 命中，或内联里出现 SDK 引导特征
function dropAdScripts(html) {
  let hits = 0;
  let out = "";
  let from = 0;
  for (;;) {
    const start = html.indexOf("<script", from);
    if (start < 0) break;
    const close = html.indexOf("</script>", start);
    if (close < 0) break;
    const end = close + 9;
    const block = html.slice(start, end);
    const drop = isAdUrl(srcOf(block)) || SDK_MARKS.some((mark) => block.indexOf(mark) >= 0);
    if (drop) {
      out += html.slice(from, start);
      hits += 1;
    } else {
      out += html.slice(from, end);
    }
    from = end;
  }
  return { html: out + html.slice(from), hits };
}

// 删 <ins> 广告位占位（ExoClick 的 data-zoneid 与 eas… 类名两套写法）
function dropAdSlots(html) {
  let hits = 0;
  const pair = /<ins\b[^>]*><\/ins>/gi;
  html = html.replace(pair, (tag) => {
    if (!/data-zoneid|class="eas/i.test(tag)) return tag;
    hits += 1;
    return "";
  });
  return { html, hits };
}

function clean(body) {
  const stats = {};
  const iframes = dropAdIframes(body);
  stats.iframes = iframes.hits;
  const scripts = dropAdScripts(iframes.html);
  stats.scripts = scripts.hits;
  const slots = dropAdSlots(scripts.html);
  stats.slots = slots.hits;

  let out = slots.html;
  const head = out.lastIndexOf("</head>");
  if (head >= 0) out = out.slice(0, head) + STYLE + out.slice(head);
  else out = STYLE + out;
  return { html: out, stats };
}

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
const enabled = arg?.jav_enable === true || arg?.jav_enable === "true" || arg?.jav_enable === undefined;
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) &&
  (arg?.jav_debug === true || arg?.jav_debug === "true");

const url = $request.url;
const short = String(url).split("?")[0];
const body = $response && typeof $response.body === "string" ? $response.body : "";

if (!enabled) {
  if (debug) console.log("JAVCLEAN-OFF " + short);
  $done({});
} else if (!body) {
  if (debug) console.log("JAVCLEAN-NOBODY " + short);
  $done({});
} else if (body.indexOf(`id="${STYLE_ID}"`) >= 0) {
  if (debug) console.log("JAVCLEAN-DUP " + short);
  $done({});
} else if (body.indexOf("<head") < 0 || body.indexOf("<html") < 0) {
  // 接口 JSON、m3u8、图片都会走到这里
  if (debug) console.log("JAVCLEAN-SKIP " + short);
  $done({});
} else {
  const result = clean(body);
  if (debug) {
    const s = result.stats;
    console.log(
      "JAVCLEAN " + short +
      " iframes=" + s.iframes +
      " scripts=" + s.scripts +
      " slots=" + s.slots +
      " len=" + body.length + "->" + result.html.length,
    );
  }
  $done({ body: result.html });
}
