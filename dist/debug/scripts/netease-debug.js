/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

!0 !== arg?.netease_debug && "true" !== arg?.netease_debug || console.log("NCMDEBUG " + JSON.stringify({
    method: $request.method,
    url: $request.url
})), $done({});
