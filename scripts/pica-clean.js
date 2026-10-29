/* SPDX-License-Identifier: Apache-2.0 */

// 哔咔漫画（PicaWeb / iOS PWA）去广告 · Loon 模块 Pica-URL.module 配套
//
// 不阻断接口而是往页面里补样式和运行时，原因见 Pica.md：
//   1. 阅读器把「每 21 页」当成一个虚拟广告页（bundle 内 (e-1) % 21 == 20），
//      这个分页是本地算出来的，与广告接口是否返回内容无关；只拦接口会在书里留一个空页。
//   2. 广告容器一律是 React 渲染出来的，直接删 DOM 会让下一次 setState 崩；
//      这里只加 display:none，命中分页时用一次 ArrowRight 让阅读器自己翻过去。

const STYLE_ID = "pica-ad-clean";
const RUNTIME_ID = "pica-ad-runtime";
const HTML_MARK = /PicaWeb/i;

// 选择器全部取自线上 bundle 的 className（assets/js/feature-comics-*.js）。
// 只写广告容器本身，不写版式结构：换皮后仍能命中。
const HIDE = [
  ".reader-ad-fullpage",
  ".comic-detail-page-ad",
  ".comic-detail-ad-mobile-container",
  ".comic-detail-ad-desktop-wrapper",
  ".chapter-navigation__ad",
  ".vw-ad-container",
  ".vw-ad-placeholder",
  ".ads-container",
  ".ads-skeleton-container",
  ".dual-page-content--ad",
  ".cats-item-ad",
  ".cats-tag-ad",
];

// 广告域固定为 Cloudflare 上的 pica-ad-api.diwodiwo.xyz：
//   /get-ad-zones  广告位下发（瀑布流四组 zone 组合 + 首页横幅一组）
//   /redirect/{z}  点击跳转
//   /medias/*      创意素材（gif / mp4）
//   /android/*     客户端内嵌 H5 广告页（font / comic_detail / chat / cat）
const RUNTIME = `(function () {
  if (window.__picaAdClean) { return; }
  window.__picaAdClean = true;
  var AD_HOST = /(^|\\.)diwodiwo\\.xyz$/;
  var MAX_SKIP = 3;
  var MAX_BURST = 6;
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var host = "";
      try { host = new URL(url, location.href).hostname; } catch (e) { host = ""; }
      if (host && AD_HOST.test(host)) {
        // 返回空广告池而不是让请求 404：SPA 的 transformResponse 认 code 200，
        // 空数组走「暂无广告内容」分支，不会进重试循环。
        // 这里手搓 Response 形状而不用 new Response()，老 WebView 没有这个构造函数。
        var payload = JSON.stringify({ code: 200, data: { zones: [] } });
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: function () { return "application/json"; } },
          json: function () { return Promise.resolve(JSON.parse(payload)); },
          text: function () { return Promise.resolve(payload); }
        });
      }
      return nativeFetch.apply(this, arguments);
    };
  }
  var node = null;
  var attempts = 0;
  var lastAt = 0;
  var history = [];
  function skip() {
    var ad = document.querySelector(".reader-ad-fullpage");
    if (!ad) { node = null; attempts = 0; return; }
    if (ad !== node) { node = ad; attempts = 0; }
    if (attempts >= MAX_SKIP) { return; }
    var now = Date.now();
    if (now - lastAt < 800) { return; }
    // React 重渲染会换掉节点，身份判重会失效；再用 10 秒窗口兜一层，避免死循环
    history = history.filter(function (t) { return now - t < 10000; });
    if (history.length >= MAX_BURST) { return; }
    history.push(now);
    lastAt = now;
    attempts += 1;
    var dual = document.querySelector(".dual-page-content--ad");
    var dualNext = dual && dual.querySelector(".dual-ad-nav-btn--next");
    if (dualNext && !dualNext.disabled) { dualNext.click(); return; }
    // 阅读器的翻页键盘监听挂在 document 上（ArrowRight / L / End → 下一页）
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight", bubbles: true, cancelable: true
    }));
    setTimeout(function () {
      var btn = document.querySelector(".page-nav-button.nav-right");
      if (document.querySelector(".reader-ad-fullpage") === ad && btn && !btn.disabled) { btn.click(); }
    }, 300);
  }
  var pending = false;
  function schedule() {
    if (pending) { return; }
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () { pending = false; skip(); });
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();`;

const PAYLOAD =
  `<style id="${STYLE_ID}">${HIDE.join(",")}{display:none!important}</style>` +
  `<script id="${RUNTIME_ID}">${RUNTIME}</script>`;

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
const enabled = arg?.pica_enable === true || arg?.pica_enable === "true" || arg?.pica_enable === undefined;
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) &&
  (arg?.pica_debug === true || arg?.pica_debug === "true");

const url = $request.url;
const short = String(url).split("?")[0];
const body = $response && typeof $response.body === "string" ? $response.body : "";

if (!enabled) {
  if (debug) console.log("PICA-CLEAN-OFF " + short);
  $done({});
} else if (!body) {
  // requires_body 未生效或响应体为空：不动，避免把页面清空
  if (debug) console.log("PICA-CLEAN-NOBODY " + short);
  $done({});
} else if (body.indexOf(`id="${STYLE_ID}"`) >= 0) {
  if (debug) console.log("PICA-CLEAN-DUP " + short);
  $done({});
} else if (!HTML_MARK.test(body) || body.indexOf("<head") < 0) {
  // 同域下的接口、locale JSON、以及 www.picacomic.com 的下载页都会走到这里
  if (debug) console.log("PICA-CLEAN-SKIP " + short);
  $done({});
} else {
  const head = body.lastIndexOf("</head>");
  let out;
  if (head >= 0) {
    out = body.slice(0, head) + PAYLOAD + body.slice(head);
  } else if (/<body[^>]*>/i.test(body)) {
    out = body.replace(/<body[^>]*>/i, (tag) => tag + PAYLOAD);
  } else {
    out = PAYLOAD + body;
  }
  if (debug) console.log("PICA-CLEAN-INJECT " + short + " len=" + body.length + "->" + out.length);
  $done({ body: out });
}
