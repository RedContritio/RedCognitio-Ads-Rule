/* SPDX-License-Identifier: Apache-2.0 */

// missav（missav.ws / missav123.com / missav.ai / missav.live）去广告 · 合集与 MissAV 段共用
//
// 为什么是 HTML 重写而不是只封域名，见 MissAV.md：
//   1. 服务端直出 smartpop iframe（go.mayzaent.com/smartpop/<64 hex>），域名一封就剩一个
//      300×100 / 728×90 的白块，点位还在版式里。
//   2. 页面尾部内联 `htmlAds` 脚本每次随机挑 1 条执行（Stripchat Spot 悬浮窗 / 右下悬浮条 /
//      smartpop 脚本），三条都不是独立请求，域名层拦不住「谁来创建这个 iframe」。
//   3. 播放器容器上有 `@click="pop()"`，点一下 window.open('/pop?url=…') 新开标签；
//      只封广告域会变成「点一下开一个空白标签，回来还要再点一次播放」。
//
// 因此这里做四件事：删内联广告脚本、删服务端广告 iframe、摘掉 pop() 事件属性、删联盟推广位，
// 最后补一段 CSS 兜住「域名层已拦但 DOM 还在」的残块。都不引 DOM，纯字符串改写。

const STYLE_ID = "missav-ad-clean";

// 广告与点击跟踪域（2026-10-30 实测）：同一套白标广告网络，子域前缀固定、注册域轮换
const AD_SRC_RE =
  // 协议相对写法（//cdn.tsyndicate.com/sdk/v1/ms.js）在站内存在，^https?: 会漏
  /^(?:https?:)?\/\/(?:[a-z0-9-]+\.)*(?:myavlive\.com|mavrtracktor\.com|greentrafsa\.com|mayzaent\.com|rallytrck\.website|snaptrckr\.fun|tsyndicate\.com|twinrdengine\.com)(?:[/?#:]|$)/i;

// 站内文档标记：只认 missav 的页面，避免误伤同域接口与静态资源
const HTML_MARK = /missav/i;

const HIDE = [
  "#html-ads",
  ".under_player",
  // 域名层拦掉之后仍留在 DOM 里的 iframe（含 width/height 白块）
  'iframe[src*="myavlive"]',
  'iframe[src*="mavrtracktor"]',
  'iframe[src*="greentrafsa"]',
  'iframe[src*="mayzaent"]',
  'iframe[src*="rallytrck"]',
  'iframe[src*="snaptrckr"]',
  // htmlAds 第 1 个变体自建的右下悬浮条（fixed right-2 bottom-2）
  "body > .fixed.right-2.bottom-2",
];

const STYLE = `<style id="${STYLE_ID}">${HIDE.join(",")}{display:none!important}</style>`;

function srcOf(tag) {
  const quoted = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
  return quoted ? quoted[1] : "";
}

// 删掉「整块 <script> 里含某个标记」的脚本（htmlAds 三个变体与末尾的调度代码各是一块）
function dropScripts(html, marker) {
  let out = "";
  let from = 0;
  let hits = 0;
  for (;;) {
    const start = html.indexOf("<script", from);
    if (start < 0) break;
    const close = html.indexOf("</script>", start);
    if (close < 0) break;
    const end = close + 9;
    if (html.slice(start, end).indexOf(marker) >= 0) {
      out += html.slice(from, start);
      hits += 1;
    } else {
      out += html.slice(from, end);
    }
    from = end;
  }
  return { html: out + html.slice(from), hits };
}

// 广告 iframe：先连外壳 <div class="mx-auto" style="width:…"> 一起删，再清掉零散的
function dropAdIframes(html) {
  let hits = 0;
  html = html.replace(
    /<div class="mx-auto" style="width:\s*\d+px;\s*height:\s*\d+px;">\s*<iframe\b[^>]*><\/iframe>\s*<\/div>/gi,
    (block) => {
      if (!AD_SRC_RE.test(srcOf(block))) return block;
      hits += 1;
      return "";
    },
  );
  html = html.replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, (pair) => {
    if (!AD_SRC_RE.test(srcOf(pair))) return pair;
    hits += 1;
    return "";
  });
  // 自闭合写法（Alpine 模板里偶尔出现）
  html = html.replace(/<iframe\b[^>]*\/>/gi, (tag) => {
    if (!AD_SRC_RE.test(srcOf(tag))) return tag;
    hits += 1;
    return "";
  });
  return { html, hits };
}

// 广告/跟踪脚本标签（head 里的 SCSpotScript、cdn.tsyndicate.com/sdk/v1/ms.js）
function dropAdScriptTags(html) {
  let hits = 0;
  html = html.replace(/<script\b[^>]*><\/script>/gi, (tag) => {
    if (tag.indexOf("SCSpotScript") >= 0 || AD_SRC_RE.test(srcOf(tag))) {
      hits += 1;
      return "";
    }
    return tag;
  });
  return { html, hits };
}

// 按标签配对删一个元素：面板里嵌着 <span>（在线圆点、标题），正则的非贪婪会提前收尾，
// 所以从开标签往后数同名标签的深度，找真正的闭合位置
function dropTag(html, openerRe, tag) {
  const m = openerRe.exec(html);
  if (!m) return { html, hits: 0 };
  const start = m.index;
  const tagEnd = html.indexOf(">", start + m[0].length - 1);
  if (tagEnd < 0) return { html, hits: 0 };
  const scan = new RegExp("<\\/?" + tag + "\\b", "gi");
  scan.lastIndex = tagEnd + 1;
  let depth = 1;
  let end = -1;
  let hit;
  while ((hit = scan.exec(html))) {
    if (hit[0].charAt(1) === "/") {
      depth -= 1;
      if (depth === 0) {
        end = html.indexOf(">", hit.index) + 1;
        break;
      }
    } else {
      depth += 1;
    }
  }
  if (end <= tagEnd) return { html, hits: 0 };
  return { html: html.slice(0, start) + html.slice(end), hits: 1 };
}

// 导航栏「更多好站」：bit.ly / 外站联盟推广 + 触发项与面板
function dropPartners(html) {
  let hits = 0;
  const sponsored = /<a\b[^>]*\brel="sponsored[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  html = html.replace(sponsored, () => {
    hits += 1;
    return "";
  });
  // 先删面板（里面有嵌套 span），再删触发项，顺序反了就把面板的入口丢了。
  // 站内桌面上有两套导航（移动 / 桌面），同款面板可能出现多次，逐次删到没有为止
  for (let guard = 0; guard < 8; guard += 1) {
    const panel = dropTag(html, /<span\b[^>]*x-show="showCollapse === 'partners'"[^>]*>/, "span");
    html = panel.html;
    hits += panel.hits;
    if (!panel.hits) break;
  }
  for (let guard = 0; guard < 8; guard += 1) {
    const trigger = dropTag(html, /<a\b[^>]*@click\.prevent="showCollapse = showCollapse === 'partners'[^"]*"[^>]*>/, "a");
    html = trigger.html;
    hits += trigger.hits;
    if (!trigger.hits) break;
  }
  return { html, hits };
}

// 播放器弹窗：@click="pop()" 与 @keyup.space.window="pop()" 只摘属性，
// x-data 里的 pop() 定义留着——Alpine 少一个方法会在初始化时抛错，且 updateHash 还要用同一份状态
function dropPopHandlers(html) {
  let hits = 0;
  html = html.replace(/\s+@click="pop\(\)"/g, () => {
    hits += 1;
    return "";
  });
  html = html.replace(/\s+@keyup\.space\.window="pop\(\)"/g, () => {
    hits += 1;
    return "";
  });
  return { html, hits };
}

function clean(body) {
  const stats = {};
  let out = body;

  const removePlaceholder = /<div\s+id="html-ads"\s*><\/div>/gi;
  stats.placeholder = (out.match(removePlaceholder) || []).length;
  out = out.replace(removePlaceholder, "");

  const scripts = dropScripts(out, "htmlAds");
  out = scripts.html;
  stats.htmlAds = scripts.hits;

  const tags = dropAdScriptTags(out);
  out = tags.html;
  stats.scriptTags = tags.hits;

  const iframes = dropAdIframes(out);
  out = iframes.html;
  stats.iframes = iframes.hits;

  const partners = dropPartners(out);
  out = partners.html;
  stats.partners = partners.hits;

  const pop = dropPopHandlers(out);
  out = pop.html;
  stats.pop = pop.hits;

  const head = out.lastIndexOf("</head>");
  if (head >= 0) {
    out = out.slice(0, head) + STYLE + out.slice(head);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body[^>]*>/i, (tag) => tag + STYLE);
  } else {
    out = STYLE + out;
  }
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
const enabled = arg?.missav_enable === true || arg?.missav_enable === "true" || arg?.missav_enable === undefined;
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) &&
  (arg?.missav_debug === true || arg?.missav_debug === "true");

const url = $request.url;
const short = String(url).split("?")[0];
const body = $response && typeof $response.body === "string" ? $response.body : "";

if (!enabled) {
  if (debug) console.log("MISSAV-CLEAN-OFF " + short);
  $done({});
} else if (!body) {
  // requires_body 未生效或响应体为空：不动，避免把页面清空
  if (debug) console.log("MISSAV-CLEAN-NOBODY " + short);
  $done({});
} else if (body.indexOf(`id="${STYLE_ID}"`) >= 0) {
  if (debug) console.log("MISSAV-CLEAN-DUP " + short);
  $done({});
} else if (!HTML_MARK.test(body) || body.indexOf("<head") < 0) {
  // 同域下的 /pop 中转页、API、locale JSON、静态资源都会走到这里
  if (debug) console.log("MISSAV-CLEAN-SKIP " + short);
  $done({});
} else {
  const result = clean(body);
  if (debug) {
    const s = result.stats;
    console.log(
      "MISSAV-CLEAN " + short +
      " htmlAds=" + s.htmlAds +
      " scriptTags=" + s.scriptTags +
      " iframes=" + s.iframes +
      " partners=" + s.partners +
      " pop=" + s.pop +
      " placeholder=" + s.placeholder +
      " len=" + body.length + "->" + result.html.length,
    );
  }
  $done({ body: result.html });
}
