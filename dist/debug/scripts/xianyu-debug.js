/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

!0 !== arg?.xianyu_debug && "true" !== arg?.xianyu_debug || console.log("XYDEBUG " + JSON.stringify({
    method: $request.method,
    url: $request.url
})), $done({});
