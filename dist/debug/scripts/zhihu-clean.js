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

function hasMembershipPrompt(node) {
    if ("string" == typeof node) {
        const text = node.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
        return /(?:开通|成为|加入|订阅|续费)(?:知乎)?(?:超级)?(?:盐选|知识)?会员/.test(text) || /(?:会员专享|会员专属|盐选会员|知识会员)(?:内容|回答|阅读|解锁)/.test(text);
    }
    return Array.isArray(node) ? node.some(hasMembershipPrompt) : !(!node || "object" != typeof node) && Object.values(node).some(hasMembershipPrompt);
}

function isMemberOnly(item) {
    if (!item || "object" != typeof item) return !1;
    const answer = item.target || item.object || item.answer || item.unify_content && item.unify_content.content_info || item, type = String(answer.type || answer.content_type || answer.producer || "").toLowerCase(), paid = parseObject(answer.paid_info);
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
        };
        if (purify && body && (FEED_URL.test(url) || NEXT_RENDER_URL.test(url) || QUESTION_URL.test(url) || SEARCH_URL.test(url))) for (const key of [ "data", "dataV1" ]) {
            if (!Array.isArray(body[key])) continue;
            const before = body[key].length;
            body[key] = body[key].filter(item => !isMemberOnly(item)), state.removed += before - body[key].length,
            state.restricted += before - body[key].length;
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
                body.structured_content.segments = body.structured_content.segments.filter(s => !s || "card" !== s.type),
                state.removed += before - body.structured_content.segments.length;
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
        debug && console.log("ZHCLEAN " + JSON.stringify({
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
