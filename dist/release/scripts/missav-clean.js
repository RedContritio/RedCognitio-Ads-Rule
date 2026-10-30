/* SPDX-License-Identifier: Apache-2.0 */
const AD_SRC_RE = /^(?:https?:)?\/\/(?:[a-z0-9-]+\.)*(?:myavlive\.com|mavrtracktor\.com|greentrafsa\.com|mayzaent\.com|rallytrck\.website|snaptrckr\.fun|tsyndicate\.com|twinrdengine\.com)(?:[/?#:]|$)/i, STYLE = `<style id="missav-ad-clean">${[ "#html-ads", ".under_player", 'iframe[src*="myavlive"]', 'iframe[src*="mavrtracktor"]', 'iframe[src*="greentrafsa"]', 'iframe[src*="mayzaent"]', 'iframe[src*="rallytrck"]', 'iframe[src*="snaptrckr"]', "body > .fixed.right-2.bottom-2" ].join(",")}{display:none!important}</style>`;

function srcOf(tag) {
    const quoted = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
    return quoted ? quoted[1] : "";
}

function dropTag(html, openerRe, tag) {
    const m = openerRe.exec(html);
    if (!m) return {
        html,
        hits: 0
    };
    const start = m.index, tagEnd = html.indexOf(">", start + m[0].length - 1);
    if (tagEnd < 0) return {
        html,
        hits: 0
    };
    const scan = new RegExp("<\\/?" + tag + "\\b", "gi");
    scan.lastIndex = tagEnd + 1;
    let hit, depth = 1, end = -1;
    for (;hit = scan.exec(html); ) if ("/" === hit[0].charAt(1)) {
        if (depth -= 1, 0 === depth) {
            end = html.indexOf(">", hit.index) + 1;
            break;
        }
    } else depth += 1;
    return end <= tagEnd ? {
        html,
        hits: 0
    } : {
        html: html.slice(0, start) + html.slice(end),
        hits: 1
    };
}

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

const enabled = !0 === arg?.missav_enable || "true" === arg?.missav_enable || void 0 === arg?.missav_enable, url = $request.url, body = (String(url).split("?")[0],
$response && "string" == typeof $response.body ? $response.body : "");

if (enabled) if (body) if (body.indexOf('id="missav-ad-clean"') >= 0) $done({}); else if (!/missav/i.test(body) || body.indexOf("<head") < 0) $done({}); else {
    const result = function(body) {
        const stats = {};
        let out = body;
        const removePlaceholder = /<div\s+id="html-ads"\s*><\/div>/gi;
        stats.placeholder = (out.match(removePlaceholder) || []).length, out = out.replace(removePlaceholder, "");
        const scripts = function(html) {
            let out = "", from = 0, hits = 0;
            for (;;) {
                const start = html.indexOf("<script", from);
                if (start < 0) break;
                const close = html.indexOf("<\/script>", start);
                if (close < 0) break;
                const end = close + 9;
                html.slice(start, end).indexOf("htmlAds") >= 0 ? (out += html.slice(from, start),
                hits += 1) : out += html.slice(from, end), from = end;
            }
            return {
                html: out + html.slice(from),
                hits
            };
        }(out);
        out = scripts.html, stats.htmlAds = scripts.hits;
        const tags = function(html) {
            let hits = 0;
            return {
                html: html = html.replace(/<script\b[^>]*><\/script>/gi, tag => tag.indexOf("SCSpotScript") >= 0 || AD_SRC_RE.test(srcOf(tag)) ? (hits += 1,
                "") : tag),
                hits
            };
        }(out);
        out = tags.html, stats.scriptTags = tags.hits;
        const iframes = function(html) {
            let hits = 0;
            return {
                html: html = (html = (html = html.replace(/<div class="mx-auto" style="width:\s*\d+px;\s*height:\s*\d+px;">\s*<iframe\b[^>]*><\/iframe>\s*<\/div>/gi, block => AD_SRC_RE.test(srcOf(block)) ? (hits += 1,
                "") : block)).replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, pair => AD_SRC_RE.test(srcOf(pair)) ? (hits += 1,
                "") : pair)).replace(/<iframe\b[^>]*\/>/gi, tag => AD_SRC_RE.test(srcOf(tag)) ? (hits += 1,
                "") : tag),
                hits
            };
        }(out);
        out = iframes.html, stats.iframes = iframes.hits;
        const partners = function(html) {
            let hits = 0;
            html = html.replace(/<a\b[^>]*\brel="sponsored[^"]*"[^>]*>[\s\S]*?<\/a>/gi, () => (hits += 1,
            ""));
            for (let guard = 0; guard < 8; guard += 1) {
                const panel = dropTag(html, /<span\b[^>]*x-show="showCollapse === 'partners'"[^>]*>/, "span");
                if (html = panel.html, hits += panel.hits, !panel.hits) break;
            }
            for (let guard = 0; guard < 8; guard += 1) {
                const trigger = dropTag(html, /<a\b[^>]*@click\.prevent="showCollapse = showCollapse === 'partners'[^"]*"[^>]*>/, "a");
                if (html = trigger.html, hits += trigger.hits, !trigger.hits) break;
            }
            return {
                html,
                hits
            };
        }(out);
        out = partners.html, stats.partners = partners.hits;
        const pop = function(html) {
            let hits = 0;
            return {
                html: html = (html = html.replace(/\s+@click="pop\(\)"/g, () => (hits += 1, ""))).replace(/\s+@keyup\.space\.window="pop\(\)"/g, () => (hits += 1,
                "")),
                hits
            };
        }(out);
        out = pop.html, stats.pop = pop.hits;
        const head = out.lastIndexOf("</head>");
        return out = head >= 0 ? out.slice(0, head) + STYLE + out.slice(head) : /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, tag => tag + STYLE) : STYLE + out,
        {
            html: out,
            stats
        };
    }(body);
    $done({
        body: result.html
    });
} else $done({}); else $done({});
