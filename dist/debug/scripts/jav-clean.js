/* SPDX-License-Identifier: Apache-2.0 */
const AD_URL_RE = new RegExp("^(?:https?:)?\\/\\/(?:[a-z0-9-]+\\.)*(?:" + [ "magsrv\\.com", "pemsrv\\.com", "exosrv\\.com", "exoclick\\.com", "realsrv\\.com", "jads\\.co", "jads\\.cc", "juicyads\\.com", "tsyndicate\\.com", "trafficjunky\\.net", "trafficjunky\\.com" ].join("|") + ")(?:[/?#:]|$)", "i"), SDK_MARKS = [ "AdProvider", "popMagic" ], STYLE = `<style id="jav-ad-clean">${[ 'iframe[src*="magsrv"]', 'iframe[src*="pemsrv"]', 'iframe[src*="exosrv"]', 'iframe[src*="exoclick"]', 'iframe[src*="realsrv"]', 'iframe[src*="jads."]', 'iframe[src*="juicyads"]', 'iframe[src*="tsyndicate"]', 'iframe[src*="trafficjunky"]', "ins[data-zoneid]", 'ins[class^="eas"]' ].join(",")}{display:none!important}</style>`;

function srcOf(tag) {
    const quoted = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
    return quoted ? quoted[1] : "";
}

function isAdUrl(url) {
    return AD_URL_RE.test(url);
}

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

const enabled = !0 === arg?.jav_enable || "true" === arg?.jav_enable || void 0 === arg?.jav_enable, debug = !0 === arg?.jav_debug || "true" === arg?.jav_debug, url = $request.url, short = String(url).split("?")[0], body = $response && "string" == typeof $response.body ? $response.body : "";

if (enabled) if (body) if (body.indexOf('id="jav-ad-clean"') >= 0) debug && console.log("JAVCLEAN-DUP " + short),
$done({}); else if (body.indexOf("<head") < 0 || body.indexOf("<html") < 0) debug && console.log("JAVCLEAN-SKIP " + short),
$done({}); else {
    const result = function(body) {
        const stats = {}, iframes = function(html) {
            let hits = 0;
            return {
                html: html = (html = html.replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, pair => isAdUrl(srcOf(pair)) ? (hits += 1,
                "") : pair)).replace(/<iframe\b[^>]*\/>/gi, tag => isAdUrl(srcOf(tag)) ? (hits += 1,
                "") : tag),
                hits
            };
        }(body);
        stats.iframes = iframes.hits;
        const scripts = function(html) {
            let hits = 0, out = "", from = 0;
            for (;;) {
                const start = html.indexOf("<script", from);
                if (start < 0) break;
                const close = html.indexOf("<\/script>", start);
                if (close < 0) break;
                const end = close + 9, block = html.slice(start, end);
                isAdUrl(srcOf(block)) || SDK_MARKS.some(mark => block.indexOf(mark) >= 0) ? (out += html.slice(from, start),
                hits += 1) : out += html.slice(from, end), from = end;
            }
            return {
                html: out + html.slice(from),
                hits
            };
        }(iframes.html);
        stats.scripts = scripts.hits;
        const slots = function(html) {
            let hits = 0;
            return {
                html: html = html.replace(/<ins\b[^>]*><\/ins>/gi, tag => /data-zoneid|class="eas/i.test(tag) ? (hits += 1,
                "") : tag),
                hits
            };
        }(scripts.html);
        stats.slots = slots.hits;
        let out = slots.html;
        const head = out.lastIndexOf("</head>");
        return out = head >= 0 ? out.slice(0, head) + STYLE + out.slice(head) : STYLE + out,
        {
            html: out,
            stats
        };
    }(body);
    if (debug) {
        const s = result.stats;
        console.log("JAVCLEAN " + short + " iframes=" + s.iframes + " scripts=" + s.scripts + " slots=" + s.slots + " len=" + body.length + "->" + result.html.length);
    }
    $done({
        body: result.html
    });
} else debug && console.log("JAVCLEAN-NOBODY " + short), $done({}); else debug && console.log("JAVCLEAN-OFF " + short),
$done({});
