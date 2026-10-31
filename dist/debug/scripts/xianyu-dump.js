/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

if (!0 === arg?.xianyu_debug || "true" === arg?.xianyu_debug) {
    const url = $request.url, body = $response.body || "", headers = $response.headers || {}, ct = headers["Content-Type"] || headers["content-type"] || "";
    console.log("XYDUMP-BEGIN " + url + " status=" + $response.status + " len=" + body.length + " ct=" + ct);
    const size = 1200;
    for (let i = 0; i < body.length; i += size) console.log("XYDUMP-" + i + " " + body.slice(i, i + size));
    console.log("XYDUMP-END " + url);
}

$done({});
