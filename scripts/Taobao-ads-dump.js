/* SPDX-License-Identifier: Apache-2.0 */
// 淘宝广告接口抓取（仅 Debug 构建）。
//
// 为什么单独做一个脚本：社区名单里那些「结构未知」的广告接口（getadv / o2o.ad.gateway /
// damai popup / 淘票票 advertise / 飞猪全屏 / trip 资源 …）在别人仓库里一律 REJECT，
// 而本仓库的结论是开屏类接口 REJECT 会触发 AdFallbackMaterial 兜底（见 ../Taobao.md），
// 只能「200 + 空池」。要写空池就得先看到真实 data 容器，所以先抓一轮。
//
// 网关解密情况（2026-11-04→11-09 本机日志）：acs.m.taobao.com 命中 MITM 29 次、
// acs.m.goofish.com 18 次 → 这些 mtop 能抓；guide-acs.m.taobao.com 0 次
// （19 次 QUIC 被 `PROTOCOL,QUIC` 规则拒掉、2 次 TCP 是 Titan sniff miss），那条链路抓不到。
//
// 输出前缀：TBADUMP-REQ（请求行）/ TBADUMP-BEGIN / TBADUMP-<offset> / TBADUMP-END。

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}

if (arg?.taobao_debug === true || arg?.taobao_debug === "true") {
  const url = $request.url || "";
  const host = (url.match(/^https?:\/\/([^/?#]+)/) || [])[1] || "";
  const api = url.match(/\/gw\/(mtop\.[^/?#]+)\/([^/?#]+)/) || [];
  const apiName = api[1] || "?";
  const apiVersion = api[2] || "?";
  const response = typeof $response === "undefined" ? null : $response;

  if (!response) {
    console.log("TBADUMP-REQ " + ($request.method || "GET") + " " + host + " " + apiName + "/" + apiVersion + " " + url);
  } else {
    const body = response.body || "";
    const headers = response.headers || {};
    const ct = headers["Content-Type"] || headers["content-type"] || "";
    console.log("TBADUMP-BEGIN " + host + " " + apiName + " status=" + response.status + " len=" + body.length + " ct=" + ct);
    const size = 1200;
    for (let i = 0; i < body.length; i += size) {
      console.log("TBADUMP-" + i + " " + body.slice(i, i + size));
    }
    console.log("TBADUMP-END " + apiName);
  }
}

$done({});
