/* SPDX-License-Identifier: Apache-2.0 */
const KEY_RE = /ad|promo|subscri|premium|max|gold|experiment|abtest|placement|entitle|shop|tracking|paywall|upsell|reward/i;

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

const enabled = !0 === arg?.duolingo_debug || "true" === arg?.duolingo_debug, body = $response && "string" == typeof $response.body ? $response.body : "", short = String($request && $request.url || "").split("?")[0];

function collect(node, prefix, depth, out) {
    if (!(!node || "object" != typeof node || depth > 4 || out.length >= 400)) for (const key of Object.keys(node)) {
        const value = node[key], path = prefix ? prefix + "." + key : key;
        if (/^[a-z0-9_]{1,40}$/i.test(key) && KEY_RE.test(key)) {
            const kind = Array.isArray(value) ? "array" : typeof value;
            out.push(path + ":" + kind);
        }
        value && "object" == typeof value && collect(value, path, depth + 1, out);
    }
}

if (enabled) if (body) {
    let payload = null;
    try {
        payload = JSON.parse(body);
    } catch (e) {
        payload = null;
    }
    if (payload && "object" == typeof payload) {
        const keys = [];
        Array.isArray(payload.responses) ? payload.responses.forEach((entry, index) => {
            if (!entry || "object" != typeof entry) return;
            const raw = entry.body;
            let inner = raw;
            if ("string" == typeof raw) try {
                inner = JSON.parse(raw);
            } catch (e) {
                return void console.log("DUODUMP PARSE-FAIL responses[" + index + "] " + short);
            }
            collect(inner, "responses[" + index + "]", 0, keys);
        }) : collect(payload, "", 0, keys), console.log("DUODUMP " + short + " " + JSON.stringify(Array.from(new Set(keys)))),
        $done({});
    } else console.log("DUODUMP SKIP " + short), $done({});
} else console.log("DUODUMP NOBODY " + short), $done({}); else $done({});
