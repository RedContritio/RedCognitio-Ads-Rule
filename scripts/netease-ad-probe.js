/* SPDX-License-Identifier: Apache-2.0 */

// 网易云音乐广告「配置面」探针（仅 Debug 构建）。
// 目的：确认 /ad/config、/ad/commonconfig、/ad/loading/judge 这些响应里
// 到底有没有「是否展示广告 / 预取有效期」这类字段，字段名是什么、取值域是什么。
// 只读：不改响应体，只把结构打到日志（字符串截断，数组只取前两项）。
// 日志前缀 NCMPROBE；无法解析（eapi 加密体）时记 NCMPROBE-RAW。

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}

function shrink(value, depth) {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === "string") return value.length > 80 ? value.slice(0, 80) + "…" : value;
  if (type === "number" || type === "boolean") return value;
  if (depth >= 3) return Array.isArray(value) ? "<array:" + value.length + ">" : "<object>";
  if (Array.isArray(value)) {
    return { $array: value.length, $first: value.length ? shrink(value[0], depth + 1) : null };
  }
  const out = {};
  for (const key of Object.keys(value).slice(0, 24)) out[key] = shrink(value[key], depth + 1);
  return out;
}

if (arg?.netease_debug === true || arg?.netease_debug === "true") {
  const body = $response.body || "";
  const ct = ($response.headers && ($response.headers["Content-Type"] || $response.headers["content-type"])) || "";
  try {
    console.log("NCMPROBE " + JSON.stringify({
      url: $request.url,
      status: $response.status,
      ct: ct,
      keys: Object.keys(JSON.parse(body)),
      shape: shrink(JSON.parse(body), 0),
    }));
  } catch (e) {
    console.log("NCMPROBE-RAW " + JSON.stringify({
      url: $request.url,
      status: $response.status,
      ct: ct,
      len: body.length,
      head: body.slice(0, 60),
    }));
  }
}
$done({});
