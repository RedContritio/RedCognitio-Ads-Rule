/* SPDX-License-Identifier: Apache-2.0 */
const PAYLOAD = `<style id="pica-ad-clean">${[ ".reader-ad-fullpage", ".comic-detail-page-ad", ".comic-detail-ad-mobile-container", ".comic-detail-ad-desktop-wrapper", ".chapter-navigation__ad", ".vw-ad-container", ".vw-ad-placeholder", ".ads-container", ".ads-skeleton-container", ".dual-page-content--ad", ".cats-item-ad", ".cats-tag-ad" ].join(",")}{display:none!important}</style><script id="pica-ad-runtime">(function () {\n  if (window.__picaAdClean) { return; }\n  window.__picaAdClean = true;\n  var AD_HOST = /(^|\\.)diwodiwo\\.xyz$/;\n  var MAX_SKIP = 3;\n  var MAX_BURST = 6;\n  var nativeFetch = window.fetch;\n  if (typeof nativeFetch === "function") {\n    window.fetch = function (input, init) {\n      var url = typeof input === "string" ? input : (input && input.url) || "";\n      var host = "";\n      try { host = new URL(url, location.href).hostname; } catch (e) { host = ""; }\n      if (host && AD_HOST.test(host)) {\n        // 返回空广告池而不是让请求 404：SPA 的 transformResponse 认 code 200，\n        // 空数组走「暂无广告内容」分支，不会进重试循环。\n        // 这里手搓 Response 形状而不用 new Response()，老 WebView 没有这个构造函数。\n        var payload = JSON.stringify({ code: 200, data: { zones: [] } });\n        return Promise.resolve({\n          ok: true,\n          status: 200,\n          statusText: "OK",\n          headers: { get: function () { return "application/json"; } },\n          json: function () { return Promise.resolve(JSON.parse(payload)); },\n          text: function () { return Promise.resolve(payload); }\n        });\n      }\n      return nativeFetch.apply(this, arguments);\n    };\n  }\n  var node = null;\n  var attempts = 0;\n  var lastAt = 0;\n  var history = [];\n  function skip() {\n    var ad = document.querySelector(".reader-ad-fullpage");\n    if (!ad) { node = null; attempts = 0; return; }\n    if (ad !== node) { node = ad; attempts = 0; }\n    if (attempts >= MAX_SKIP) { return; }\n    var now = Date.now();\n    if (now - lastAt < 800) { return; }\n    // React 重渲染会换掉节点，身份判重会失效；再用 10 秒窗口兜一层，避免死循环\n    history = history.filter(function (t) { return now - t < 10000; });\n    if (history.length >= MAX_BURST) { return; }\n    history.push(now);\n    lastAt = now;\n    attempts += 1;\n    var dual = document.querySelector(".dual-page-content--ad");\n    var dualNext = dual && dual.querySelector(".dual-ad-nav-btn--next");\n    if (dualNext && !dualNext.disabled) { dualNext.click(); return; }\n    // 阅读器的翻页键盘监听挂在 document 上（ArrowRight / L / End → 下一页）\n    document.dispatchEvent(new KeyboardEvent("keydown", {\n      key: "ArrowRight", bubbles: true, cancelable: true\n    }));\n    setTimeout(function () {\n      var btn = document.querySelector(".page-nav-button.nav-right");\n      if (document.querySelector(".reader-ad-fullpage") === ad && btn && !btn.disabled) { btn.click(); }\n    }, 300);\n  }\n  var pending = false;\n  function schedule() {\n    if (pending) { return; }\n    pending = true;\n    (window.requestAnimationFrame || setTimeout)(function () { pending = false; skip(); });\n  }\n  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });\n  schedule();\n})();<\/script>`;

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

const enabled = !0 === arg?.pica_enable || "true" === arg?.pica_enable || void 0 === arg?.pica_enable, debug = !0 === arg?.pica_debug || "true" === arg?.pica_debug, url = $request.url, short = String(url).split("?")[0], body = $response && "string" == typeof $response.body ? $response.body : "";

if (enabled) if (body) if (body.indexOf('id="pica-ad-clean"') >= 0) debug && console.log("PICA-CLEAN-DUP " + short),
$done({}); else if (!/PicaWeb/i.test(body) || body.indexOf("<head") < 0) debug && console.log("PICA-CLEAN-SKIP " + short),
$done({}); else {
    const head = body.lastIndexOf("</head>");
    let out;
    out = head >= 0 ? body.slice(0, head) + PAYLOAD + body.slice(head) : /<body[^>]*>/i.test(body) ? body.replace(/<body[^>]*>/i, tag => tag + PAYLOAD) : PAYLOAD + body,
    debug && console.log("PICA-CLEAN-INJECT " + short + " len=" + body.length + "->" + out.length),
    $done({
        body: out
    });
} else debug && console.log("PICA-CLEAN-NOBODY " + short), $done({}); else debug && console.log("PICA-CLEAN-OFF " + short),
$done({});
