/* SPDX-License-Identifier: Apache-2.0 */
// 闲鱼广告接口响应抓取：把 mtop 响应体按 1200 字符切段打到 Loon 日志，前缀 XYDUMP。
// 只用于诊断，默认关闭；需要 [Script] 带 requires_body=true。

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
if (arg?.xianyu_debug === true || arg?.xianyu_debug === "true") {
  const url = $request.url;
  const body = $response.body || "";
  const headers = $response.headers || {};
  const ct = headers["Content-Type"] || headers["content-type"] || "";
  console.log("XYDUMP-BEGIN " + url + " status=" + $response.status + " len=" + body.length + " ct=" + ct);
  const size = 1200;
  for (let i = 0; i < body.length; i += size) {
    console.log("XYDUMP-" + i + " " + body.slice(i, i + size));
  }
  console.log("XYDUMP-END " + url);
}
$done({});
