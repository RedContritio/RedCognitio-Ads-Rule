/* SPDX-License-Identifier: Apache-2.0 */

const url = $request.url;
const AD_TYPES = new Set([
  "feed_advert",
  "short_advert",
  "externalad",
  "AdCard",
  "ZhiPlusCard",
  "BusinessCard",
  "MarketCard",
  "RecommendedProductsCard",
]);
const AD_STYLE = /^(plutus_card_|brand_card_)/;
const DETAIL_URL = /(?:api\/)?(?:v[0-9]+\/)?(?:answers|articles|pins)(?:\/v[0-9]+)?\/[0-9]+/;
const FEED_URL = /\/topstory\/recommend/;
const NEXT_RENDER_URL = /\/(?:simple-)?next-render(?:\?|$)/;
const QUESTION_URL = /\/(?:api\/)?(?:v[0-9]+\/)?questions\/[0-9]+(?:\/|\?|$)/;
const SEARCH_URL = /\/search_v[0-9]+(?:\?|$)/;

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
function enabled(name, fallback = true) {
  const value = arg ? arg[name] : undefined;
  return value === undefined ? fallback : value === true || value === "true";
}
const removeAds = enabled("zhihu_enable");
const purify = enabled("zhihu_purify");
const debug = enabled("zhihu_debug", false);

function parseObject(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  return value;
}

function isPromoted(item) {
  const content = item.unify_content || {};
  const extra = item.extra || {};
  const business = content.biz_ext || {};
  const retrieval = (content.rec && content.rec.RetrievalInfo) || {};

  for (const value of [extra.promotion, business.promotion]) {
    const promotion = parseObject(value);
    if (promotion && promotion.is_card === true) return true;
  }

  const commercial = parseObject(retrieval.commercial_promotion_rpc_extra);
  return commercial && typeof commercial === "object"
    ? Object.keys(commercial).length > 0
    : Boolean(commercial);
}

function isVideo(item) {
  const content = item.unify_content || {};
  const info = content.content_info || {};
  const extra = item.extra || {};
  const target = item.target || {};
  const types = [
    item.type, item.style, item.content_type, extra.content_type, info.content_type,
    target.type, target.answer_type, extra.answer_type,
  ];
  if (Array.isArray(item.children)) {
    for (const child of item.children) {
      if (child) types.push(child.type, child.style);
    }
  }
  return types.some((type) => typeof type === "string" &&
    /^(?:video|zvideo|video_answer|video_collection|zvideo_collection|videocard|zvideocard|stylevideo)$/i.test(type));
}

function hasMembershipPrompt(node) {
  if (typeof node === "string") {
    const text = node.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
    return /(?:开通|成为|加入|订阅|续费)(?:知乎)?(?:超级)?(?:盐选|知识)?会员/.test(text) ||
      /(?:会员专享|会员专属|盐选会员|知识会员)(?:内容|回答|阅读|解锁)/.test(text);
  }
  if (Array.isArray(node)) return node.some(hasMembershipPrompt);
  if (!node || typeof node !== "object") return false;
  return Object.values(node).some(hasMembershipPrompt);
}

function isMemberOnly(item) {
  if (!item || typeof item !== "object") return false;
  const answer = item.target || item.object || item.answer ||
    (item.unify_content && item.unify_content.content_info) || item;
  const type = String(answer.type || answer.content_type || answer.producer || "").toLowerCase();
  const paid = parseObject(answer.paid_info);
  if (answer.has_purchased === true || answer.is_purchased === true ||
    answer.is_free === true || (paid && paid.has_purchased === true)) return false;
  if (item.type === "knowledge_ad" &&
    (answer.card_type === "knowledge_vip" ||
      /^(?:album_paid_column|paid_column_chapter)$/.test(answer.commodity_type || ""))) return true;
  if (answer.label_info && answer.label_info.type === "purchase_required") return true;
  const paidType = /^(?:paid_content|paid_column|paid_column_sku|album)$/.test(type);
  if (type !== "answer" && !answer.question && !paidType) return false;
  if (paid && paid.has_purchased === false) return true;
  if (paidType && answer.is_purchased === false) return true;
  for (const node of [
    paid, answer.paywall, answer.vip_tip, answer.purchase_tip,
    answer.structured_content_vip,
  ]) {
    if (hasMembershipPrompt(node)) return true;
  }
  const segments = answer.structured_content && answer.structured_content.segments;
  if (Array.isArray(segments) && segments.some((segment) => segment &&
    /^(?:card|vip|paid|paywall|purchase|membership)(?:_|$)/i.test(segment.type || "") &&
    hasMembershipPrompt(segment))) return true;
  return typeof answer.content === "string" &&
    /class\s*=\s*["'][^"']*\bKfeCollection-PurchaseBtn\b/i.test(answer.content);
}

function logSearchResponse(raw) {
  if (typeof raw !== "string") return;
  const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  const chunkSize = 1200;
  const parts = Math.max(1, Math.ceil(raw.length / chunkSize));
  console.log("ZHSEARCH-META " + JSON.stringify({
    id, url, length: raw.length, parts,
  }));
  for (let part = 0; part < parts; part++) {
    console.log("ZHSEARCH-BODY " + JSON.stringify({
      id, part: part + 1, parts,
      body: raw.slice(part * chunkSize, (part + 1) * chunkSize),
    }));
  }
}

function scrub(node, state) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      if (item && typeof item === "object" && AD_TYPES.has(item.type)) {
        node.splice(i, 1);
        state.removed++;
      } else {
        scrub(item, state);
      }
    }
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const key of Object.keys(node)) {
    if (["ad_info", "ad_answers", "ad_answer", "adjson", "ad_list"].includes(key)) {
      delete node[key];
      state.removed++;
    } else {
      scrub(node[key], state);
    }
  }
}

function handle(body) {
  const state = { removed: 0, restricted: 0, videos: 0 };
  if (purify && body && (FEED_URL.test(url) || NEXT_RENDER_URL.test(url) || QUESTION_URL.test(url) || SEARCH_URL.test(url))) {
    for (const key of ["data", "dataV1"]) {
      if (!Array.isArray(body[key])) continue;
      const before = body[key].length;
      body[key] = body[key].filter((item) => !isMemberOnly(item));
      state.removed += before - body[key].length;
      state.restricted += before - body[key].length;
    }
  }
  if (removeAds) scrub(body, state);

  if (NEXT_RENDER_URL.test(url) && body && Array.isArray(body.data)) {
    body.data = body.data.filter((item) => {
      if (!item || typeof item !== "object") return true;
      if (removeAds && item.type === "ad") {
        state.removed++;
        return false;
      }
      if (removeAds && "adjson" in item) {
        delete item.adjson;
        state.removed++;
      }
      return true;
    });
  }

  if (DETAIL_URL.test(url)) {
    const keys = [];
    if (removeAds) keys.push("third_business");
    if (purify) keys.push("float_search_word", "interaction_bar_plugins", "ring_info");
    for (const key of keys) {
      if (body && typeof body === "object" && key in body) {
        delete body[key];
        state.removed++;
      }
    }
    if (
      removeAds && body &&
      body.structured_content &&
      Array.isArray(body.structured_content.segments)
    ) {
      const before = body.structured_content.segments.length;
      body.structured_content.segments =
        body.structured_content.segments.filter((s) => !s || s.type !== "card");
      state.removed += before - body.structured_content.segments.length;
    }
  }

  if (purify && QUESTION_URL.test(url) && body && typeof body === "object") {
    delete body.roundtable_info;
  }
  if (purify && SEARCH_URL.test(url) && body && typeof body === "object") {
    delete body.pendant;
  }

  if (FEED_URL.test(url) && body) {
    for (const key of ["data", "dataV1"]) {
      if (!Array.isArray(body[key])) continue;
      body[key] = body[key].filter((item) => {
        if (!item || typeof item !== "object") return true;
        if (purify && isVideo(item)) {
          state.videos++;
          state.removed++;
          return false;
        }
        if (removeAds && isPromoted(item)) {
          state.removed++;
          return false;
        }
        if (Array.isArray(item.children)) {
          const before = item.children.length;
          item.children = item.children.filter(
            (c) => c && (!purify || c.id !== "ring") &&
              (!removeAds || !AD_STYLE.test(c.style || ""))
          );
          state.removed += before - item.children.length;
        }
        return true;
      });
    }
  }

  if (debug) console.log(
    "ZHCLEAN " +
      JSON.stringify({
        url: url.split("?")[0],
        removed: state.removed,
        restricted_removed: state.restricted,
        video_removed: state.videos,
        data: body && Array.isArray(body.data) ? body.data.length : null,
        dataV1: body && Array.isArray(body.dataV1) ? body.dataV1.length : null,
      })
  );

  $done({ body: JSON.stringify(body) });
}

if (!removeAds && !purify) {
  if (debug) console.log("ZHCLEAN-OFF " + url.split("?")[0]);
  $done({});
} else {
  if (debug) console.log("ZHCLEAN-ENTER " + url.split("?")[0]);
  if (debug && SEARCH_URL.test(url)) logSearchResponse($response.body);
  let body;
  try {
    body = JSON.parse($response.body);
  } catch (e) {
    if (debug) console.log("ZHCLEAN-BADJSON " + url.split("?")[0]);
    body = undefined;
  }
  if (body === undefined) {
    $done({});
  } else {
    handle(body);
  }
}
