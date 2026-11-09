/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

if (!0 === arg?.taobao_debug || "true" === arg?.taobao_debug) {
    const url = $request.url || "", host = (url.match(/^https?:\/\/([^/?#]+)/) || [])[1] || "", api = url.match(/\/gw\/(mtop\.[^/?#]+)\/([^/?#]+)/) || [], apiName = api[1] || "?", apiVersion = api[2] || "?", response = "undefined" == typeof $response ? null : $response;
    if (response) {
        const body = response.body || "", headers = response.headers || {}, ct = headers["Content-Type"] || headers["content-type"] || "";
        console.log("TBADUMP-BEGIN " + host + " " + apiName + " status=" + response.status + " len=" + body.length + " ct=" + ct);
        const size = 1200;
        for (let i = 0; i < body.length; i += size) console.log("TBADUMP-" + i + " " + body.slice(i, i + size));
        console.log("TBADUMP-END " + apiName);
    } else console.log("TBADUMP-REQ " + ($request.method || "GET") + " " + host + " " + apiName + "/" + apiVersion + " " + url);
}

$done({});
