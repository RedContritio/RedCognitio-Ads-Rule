/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

if (!0 === arg?.netease_debug || "true" === arg?.netease_debug) {
    const body = $response.body || "", ct = $response.headers && ($response.headers["Content-Type"] || $response.headers["content-type"]) || "";
    try {
        console.log("NCMPROBE " + JSON.stringify({
            url: $request.url,
            status: $response.status,
            ct,
            keys: Object.keys(JSON.parse(body)),
            shape: function shrink(value, depth) {
                if (null == value) return null;
                const type = typeof value;
                if ("string" === type) return value.length > 80 ? value.slice(0, 80) + "…" : value;
                if ("number" === type || "boolean" === type) return value;
                if (depth >= 3) return Array.isArray(value) ? "<array:" + value.length + ">" : "<object>";
                if (Array.isArray(value)) return {
                    $array: value.length,
                    $first: value.length ? shrink(value[0], depth + 1) : null
                };
                const out = {};
                for (const key of Object.keys(value).slice(0, 24)) out[key] = shrink(value[key], depth + 1);
                return out;
            }(JSON.parse(body), 0)
        }));
    } catch (e) {
        console.log("NCMPROBE-RAW " + JSON.stringify({
            url: $request.url,
            status: $response.status,
            ct,
            len: body.length,
            head: body.slice(0, 60)
        }));
    }
}

$done({});
