/* SPDX-License-Identifier: Apache-2.0 */
// 高德开屏接口抓取：把 /ws/valueadded/alimama/splash_screen 与
// /ws/aos/alimama/splash_screen_rt 的响应体按 1200 字符切段打到 Loon 日志，前缀 AMDUMP。
// 只用于诊断，默认关闭；需要 [Script] 带 requires_body=true。

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}

if (arg?.amap_debug === true || arg?.amap_debug === "true") {
  const url = $request?.url || $response?.url || "";
  const method = $request?.method || "";
  const body = $response?.body || "";
  const headers = $response?.headers || {};
  const contentType = headers["Content-Type"] || headers["content-type"] || "";

  console.log("AMDEBUG " + method + " " + url);
  console.log(
    "AMDUMP-BEGIN " + url
      + " status=" + ($response?.status ?? "")
      + " len=" + body.length
      + " ct=" + contentType,
  );

  const size = 1200;
  for (let i = 0; i < body.length; i += size) {
    console.log("AMDUMP-" + i + " " + body.slice(i, i + size));
  }

  console.log("AMDUMP-END " + url);
}

$done({});
