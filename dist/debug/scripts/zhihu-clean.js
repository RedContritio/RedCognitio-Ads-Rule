/* SPDX-License-Identifier: Apache-2.0 */
const url = $request.url, AD_TYPES = new Set([ "feed_advert", "short_advert", "externalad", "AdCard", "ZhiPlusCard", "BusinessCard", "MarketCard", "RecommendedProductsCard" ]), AD_STYLE = /^(plutus_card_|brand_card_)/, DETAIL_URL = /(?:api\/)?(?:v[0-9]+\/)?(?:answers|articles|pins)(?:\/v[0-9]+)?\/[0-9]+/, FEED_URL = /\/topstory\/recommend/, NEXT_RENDER_URL = /\/(?:simple-)?next-render(?:\?|$)/, QUESTION_URL = /\/(?:api\/)?(?:v[0-9]+\/)?questions\/[0-9]+(?:\/|\?|$)/, SEARCH_URL = /\/search_v[0-9]+(?:\?|$)/;

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

function enabled(name, fallback = !0) {
    const value = arg ? arg[name] : void 0;
    return void 0 === value ? fallback : !0 === value || "true" === value;
}

const removeAds = enabled("zhihu_enable"), purify = enabled("zhihu_purify"), debug = enabled("zhihu_debug", !1);

function parseObject(value) {
    if ("string" == typeof value) try {
        return JSON.parse(value);
    } catch (e) {
        return null;
    }
    return value;
}

function isPromoted(item) {
    const content = item.unify_content || {}, extra = item.extra || {}, business = content.biz_ext || {}, retrieval = content.rec && content.rec.RetrievalInfo || {};
    for (const value of [ extra.promotion, business.promotion ]) {
        const promotion = parseObject(value);
        if (promotion && !0 === promotion.is_card) return !0;
    }
    const commercial = parseObject(retrieval.commercial_promotion_rpc_extra);
    return commercial && "object" == typeof commercial ? Object.keys(commercial).length > 0 : Boolean(commercial);
}

function isVideo(item) {
    const info = (item.unify_content || {}).content_info || {}, extra = item.extra || {}, target = item.target || {}, types = [ item.type, item.style, item.content_type, extra.content_type, info.content_type, target.type, target.answer_type, extra.answer_type ];
    if (Array.isArray(item.children)) for (const child of item.children) child && types.push(child.type, child.style);
    return types.some(type => "string" == typeof type && /^(?:video|zvideo|video_answer|video_collection|zvideo_collection|videocard|zvideocard|stylevideo)$/i.test(type));
}

const AD_CARD_TYPE = /(?:^|_)(?:ad|ads|advert|commercial|promotion)(?:_|$)/i, AD_CARD_MARKER = /"(?:ad_info|adjson|ad_list|third_business|ad_zone_id|creative_id|is_ad|isAd|advert)":/;

function hasMembershipPrompt(node) {
    if ("string" == typeof node) {
        const text = node.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
        return /(?:开通|成为|加入|订阅|续费)(?:知乎)?(?:超级)?(?:盐选|知识)?会员/.test(text) || /(?:会员专享|会员专属|盐选会员|知识会员)(?:内容|回答|阅读|解锁)/.test(text);
    }
    return Array.isArray(node) ? node.some(hasMembershipPrompt) : !(!node || "object" != typeof node) && Object.values(node).some(hasMembershipPrompt);
}

const PAID_SHARE = /(?:oia\.zhihu\.com\/km_paid_content|km_paid_content\/share|\/km_paid_content\b)/i, LINK_KEY = /(?:url|link|schema|href|parameter|route|target|jump|deeplink)$/i;

function decodeLoose(value) {
    let out = value;
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(out); i++) try {
        out = decodeURIComponent(out);
    } catch (e) {
        break;
    }
    return out;
}

function hasPaidShare(node) {
    if (Array.isArray(node)) return node.some(hasPaidShare);
    if (!node || "object" != typeof node) return !1;
    for (const [key, value] of Object.entries(node)) if ("string" == typeof value) {
        if (LINK_KEY.test(key) && PAID_SHARE.test(decodeLoose(value))) return !0;
    } else if (value && "object" == typeof value && hasPaidShare(value)) return !0;
    return !1;
}

const CARD_PLAIN_CT = new Set([ "ANSWER", "PIN" ]), SUSPECT_TEXT = /(?:盐选|会员专享|会员内容|会员文章|付费|试读|解锁|km_paid|paid_content|salt|vip_)/i, SUSPECT_HOST = /(?:^|\.)(?:zhihu\.com|zhimg\.com|zhihu\.dev)$/i;

function actionTarget(action) {
    const decoded = decodeLoose(action && "object" == typeof action ? String(action.parameter || "") : "").replace(/^route_url=/, ""), match = decoded.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i);
    return match ? {
        host: match[1].toLowerCase(),
        path: match[2] || "/"
    } : {
        host: "",
        path: decoded.slice(0, 80)
    };
}

function suspicion(item) {
    const biz = item.extra && item.extra.business_ext_map || {}, ct = String(biz.contentType || biz.content_type || "").toUpperCase(), target = actionTarget(item.action), reasons = [];
    return ct && !CARD_PLAIN_CT.has(ct) && reasons.push("content_type:" + ct), ct || reasons.push("content_type:missing"),
    target.host && !SUSPECT_HOST.test(target.host) && reasons.push("host:" + target.host),
    /km_paid|paid_content/i.test(target.path) && reasons.push("path:paid"), SUSPECT_TEXT.test(function(item) {
        const parts = [], walk = (node, depth) => {
            if (!(depth > 4 || parts.length > 40)) if (Array.isArray(node)) for (const value of node) walk(value, depth + 1); else if ("string" != typeof node) {
                if (node && "object" == typeof node) for (const value of Object.values(node)) walk(value, depth + 1);
            } else parts.push(node);
        };
        for (const child of Array.isArray(item.children) ? item.children : []) walk(child, 0);
        return parts.join(" ");
    }(item)) && reasons.push("text:salt"), reasons;
}

function summarizeFeed(item, verdict, reason) {
    const links = [], collect = (node, depth) => {
        if (!(depth > 4 || links.length >= 6)) if (Array.isArray(node)) for (const value of node) collect(value, depth + 1); else if (node && "object" == typeof node) for (const [key, value] of Object.entries(node)) if ("string" == typeof value) {
            if (LINK_KEY.test(key) && links.length < 8) {
                const decoded = decodeLoose(value).replace(/^route_url=/, "");
                links.push(decoded.length > 120 ? decoded.slice(0, 120) + "…" : decoded);
            }
        } else value && "object" == typeof value && collect(value, depth + 1);
    };
    collect(item, 0);
    const target = item.target && "object" == typeof item.target && item.target || item.object && "object" == typeof item.object && item.object || {}, children = Array.isArray(item.children) ? item.children : [], action = item.action && "object" == typeof item.action ? item.action : {}, biz = item.extra && item.extra.business_ext_map || {}, template = children.map(child => child && child.style || "").find(style => style && "divider_V_6_id" !== style && "divider_V_8_id" !== style && "divider_v_4_id" !== style && "text_recommend_title" !== style) || null;
    return {
        id: void 0 === item.id ? target.id : item.id,
        type: item.type || null,
        style: item.style || null,
        verdict,
        reason: reason || null,
        keys: Object.keys(item).slice(0, 12),
        targetKeys: Object.keys(target).slice(0, 12),
        targetType: target.type || null,
        template,
        ct: biz.contentType || biz.content_type || null,
        act: (() => {
            const t = actionTarget(action);
            return t.host ? t.host + t.path.slice(0, 60) : null;
        })(),
        action: action.type ? {
            type: action.type,
            parameter: decodeLoose(String(action.parameter || "")).replace(/^route_url=/, "").slice(0, 140)
        } : null,
        biz: {
            contentType: biz.contentType || biz.content_type || null,
            media: biz.media_type || null,
            deliver: biz.deliver_type || null
        },
        children: children.slice(0, 8).map(child => child && (child.style || child.type) || null),
        links
    };
}

function isMemberOnly(item) {
    if (!item || "object" != typeof item) return !1;
    const answer = item.target || item.object || item.answer || item.unify_content && item.unify_content.content_info || item;
    if (hasPaidShare(item)) return !0;
    const type = String(answer.type || answer.content_type || answer.producer || "").toLowerCase(), paid = parseObject(answer.paid_info);
    if (!0 === answer.has_purchased || !0 === answer.is_purchased || !0 === answer.is_free || paid && !0 === paid.has_purchased) return !1;
    if ("knowledge_ad" === item.type && ("knowledge_vip" === answer.card_type || /^(?:album_paid_column|paid_column_chapter)$/.test(answer.commodity_type || ""))) return !0;
    if (answer.label_info && "purchase_required" === answer.label_info.type) return !0;
    const paidType = /^(?:paid_content|paid_column|paid_column_sku|album)$/.test(type);
    if ("answer" !== type && !answer.question && !paidType) return !1;
    if (paid && !1 === paid.has_purchased) return !0;
    if (paidType && !1 === answer.is_purchased) return !0;
    for (const node of [ paid, answer.paywall, answer.vip_tip, answer.purchase_tip, answer.structured_content_vip ]) if (hasMembershipPrompt(node)) return !0;
    const segments = answer.structured_content && answer.structured_content.segments;
    return !(!Array.isArray(segments) || !segments.some(segment => segment && /^(?:card|vip|paid|paywall|purchase|membership)(?:_|$)/i.test(segment.type || "") && hasMembershipPrompt(segment))) || "string" == typeof answer.content && /class\s*=\s*["'][^"']*\bKfeCollection-PurchaseBtn\b/i.test(answer.content);
}

function scrub(node, state) {
    if (Array.isArray(node)) for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        item && "object" == typeof item && AD_TYPES.has(item.type) ? (node.splice(i, 1),
        state.removed++) : scrub(item, state);
    } else if (node && "object" == typeof node) for (const key of Object.keys(node)) [ "ad_info", "ad_answers", "ad_answer", "adjson", "ad_list" ].includes(key) ? (delete node[key],
    state.removed++) : scrub(node[key], state);
}

if (removeAds || purify) {
    let body;
    debug && console.log("ZHCLEAN-ENTER " + url.split("?")[0]), debug && SEARCH_URL.test(url) && function(raw) {
        if ("string" != typeof raw) return;
        const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10), parts = Math.max(1, Math.ceil(raw.length / 1200));
        console.log("ZHSEARCH-META " + JSON.stringify({
            id,
            url,
            length: raw.length,
            parts
        }));
        for (let part = 0; part < parts; part++) console.log("ZHSEARCH-BODY " + JSON.stringify({
            id,
            part: part + 1,
            parts,
            body: raw.slice(1200 * part, 1200 * (part + 1))
        }));
    }($response.body);
    try {
        body = JSON.parse($response.body);
    } catch (e) {
        debug && console.log("ZHCLEAN-BADJSON " + url.split("?")[0]), body = void 0;
    }
    void 0 === body ? $done({}) : function(body) {
        const state = {
            removed: 0,
            restricted: 0,
            videos: 0
        }, feedProbes = debug && FEED_URL.test(url) ? [] : null;
        if (purify && body && (FEED_URL.test(url) || NEXT_RENDER_URL.test(url) || QUESTION_URL.test(url) || SEARCH_URL.test(url))) for (const key of [ "data", "dataV1" ]) {
            if (!Array.isArray(body[key])) continue;
            const before = body[key].length;
            body[key] = body[key].filter(item => {
                const member = isMemberOnly(item);
                if (feedProbes && item && "object" == typeof item) {
                    const summary = summarizeFeed(item, member ? "dropped" : "kept", member ? "member_only" : "");
                    feedProbes.push(summary);
                    const reasons = member ? [] : suspicion(item);
                    if (reasons.length) {
                        const full = JSON.stringify(item);
                        console.log("ZHFEED-SUSPECT " + JSON.stringify({
                            url: url.split("?")[0],
                            id: summary.id,
                            reasons,
                            truncated: full.length > 2400,
                            card: full.slice(0, 2400)
                        }));
                    }
                }
                return !member;
            }), state.removed += before - body[key].length, state.restricted += before - body[key].length;
        }
        if (removeAds && scrub(body, state), NEXT_RENDER_URL.test(url) && body && Array.isArray(body.data) && (body.data = body.data.filter(item => !item || "object" != typeof item || (removeAds && "ad" === item.type ? (state.removed++,
        !1) : (removeAds && "adjson" in item && (delete item.adjson, state.removed++), !0)))),
        DETAIL_URL.test(url)) {
            const keys = [];
            removeAds && keys.push("third_business"), purify && keys.push("float_search_word", "interaction_bar_plugins", "ring_info");
            for (const key of keys) body && "object" == typeof body && key in body && (delete body[key],
            state.removed++);
            if (removeAds && body && body.structured_content && Array.isArray(body.structured_content.segments)) {
                const before = body.structured_content.segments.length;
                body.structured_content.segments = body.structured_content.segments.filter(s => !s || "card" !== s.type || !function(segment) {
                    if (!segment || "object" != typeof segment) return !1;
                    const card = segment.card, cardType = card && (card.card_type || card.type || card.subtype);
                    return !("string" != typeof cardType || !AD_CARD_TYPE.test(cardType)) || !("string" != typeof segment.subtype || !AD_CARD_TYPE.test(segment.subtype)) || AD_CARD_MARKER.test(JSON.stringify(segment));
                }(s)), state.removed += before - body.structured_content.segments.length;
            }
        }
        if (purify && QUESTION_URL.test(url) && body && "object" == typeof body && delete body.roundtable_info,
        purify && SEARCH_URL.test(url) && body && "object" == typeof body && delete body.pendant,
        FEED_URL.test(url) && body) for (const key of [ "data", "dataV1" ]) Array.isArray(body[key]) && (body[key] = body[key].filter(item => {
            if (!item || "object" != typeof item) return !0;
            if (purify && isVideo(item)) return state.videos++, state.removed++, !1;
            if (removeAds && isPromoted(item)) return state.removed++, !1;
            if (Array.isArray(item.children)) {
                const before = item.children.length;
                item.children = item.children.filter(c => c && (!purify || "ring" !== c.id) && (!removeAds || !AD_STYLE.test(c.style || ""))),
                state.removed += before - item.children.length;
            }
            return !0;
        }));
        feedProbes && console.log("ZHFEED " + JSON.stringify({
            url: url.split("?")[0],
            cards: feedProbes.slice(0, 12)
        })), debug && console.log("ZHCLEAN " + JSON.stringify({
            url: url.split("?")[0],
            removed: state.removed,
            restricted_removed: state.restricted,
            video_removed: state.videos,
            data: body && Array.isArray(body.data) ? body.data.length : null,
            dataV1: body && Array.isArray(body.dataV1) ? body.dataV1.length : null
        })), $done({
            body: JSON.stringify(body)
        });
    }(body);
} else debug && console.log("ZHCLEAN-OFF " + url.split("?")[0]), $done({});
