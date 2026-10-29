/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

if (!0 === arg?.amap_debug || "true" === arg?.amap_debug) {
    const url = $request?.url || $response?.url || "", method = $request?.method || "", body = $response?.body || "", headers = $response?.headers || {}, contentType = headers["Content-Type"] || headers["content-type"] || "";
    console.log("AMDEBUG " + method + " " + url), console.log("AMDUMP-BEGIN " + url + " status=" + ($response?.status ?? "") + " len=" + body.length + " ct=" + contentType);
    const size = 1200;
    for (let i = 0; i < body.length; i += size) console.log("AMDUMP-" + i + " " + body.slice(i, i + size));
    console.log("AMDUMP-END " + url);
}

$done({});
