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
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) && enabled("zhihu_debug", false);

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

const AD_CARD_TYPE = /(?:^|_)(?:ad|ads|advert|commercial|promotion)(?:_|$)/i;
const AD_CARD_MARKER = /"(?:ad_info|adjson|ad_list|third_business|ad_zone_id|creative_id|is_ad|isAd|advert)":/;

// 详情页的 structured_content.segments 里，card 段绝大多数是正文组件
// （reward_tail_truncate 送礼卡、free_column_card、pin 图文卡等），
// 早期「删所有 type=card」会把正文卡片连同图片一起删掉。只删带广告标记的。
function isAdCardSegment(segment) {
  if (!segment || typeof segment !== "object") return false;
  const card = segment.card;
  const cardType = card && (card.card_type || card.type || card.subtype);
  if (typeof cardType === "string" && AD_CARD_TYPE.test(cardType)) return true;
  if (typeof segment.subtype === "string" && AD_CARD_TYPE.test(segment.subtype)) return true;
  return AD_CARD_MARKER.test(JSON.stringify(segment));
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

// 盐选 / 会员文章的分享落地页。卡片外形可能是普通 answer/article，
// 只有链接稳定可辨：https://oia.zhihu.com/km_paid_content/share?km_pst=……&share_code=……
// 只认「链接类字段」里的值，正文 content 里出现的同名字符串不算，避免误删引用该链接的回答。
// 卡片的跳转目标有两种写法：直接的 url 字段，或 SDUI 的 action.parameter（形如
// route_url=https%3A%2F%2F...，整条 URL 被百分号编码过）。所以匹配前先解码。
const PAID_SHARE = /(?:oia\.zhihu\.com\/km_paid_content|km_paid_content\/share|\/km_paid_content\b)/i;
const LINK_KEY = /(?:url|link|schema|href|parameter|route|target|jump|deeplink)$/i;

function decodeLoose(value) {
  let out = value;
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(out); i++) {
    try {
      out = decodeURIComponent(out);
    } catch (e) {
      break;
    }
  }
  return out;
}

function hasPaidShare(node) {
  if (Array.isArray(node)) return node.some(hasPaidShare);
  if (!node || typeof node !== "object") return false;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (LINK_KEY.test(key) && PAID_SHARE.test(decodeLoose(value))) return true;
    } else if (value && typeof value === "object" && hasPaidShare(value)) return true;
  }
  return false;
}

// 可疑卡片自动留证：盐选/会员文章不一定把链接放在卡片上（分享落地页是点开后才拼的），
// 所以换个思路——只要卡片有「像会员内容」的迹象，就把这张卡完整打一份，等它自然出现即可，
// 不需要刻意复现同一篇。判定：非白名单 contentType、跳转主机不是知乎、或正文命中关键词。
const CARD_PLAIN_CT = new Set(["ANSWER", "PIN"]);
const SUSPECT_TEXT = /(?:盐选|会员专享|会员内容|会员文章|付费|试读|解锁|km_paid|paid_content|salt|vip_)/i;
const SUSPECT_HOST = /(?:^|\.)(?:zhihu\.com|zhimg\.com|zhihu\.dev)$/i;

function actionTarget(action) {
  const raw = action && typeof action === "object" ? String(action.parameter || "") : "";
  const decoded = decodeLoose(raw).replace(/^route_url=/, "");
  const match = decoded.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i);
  if (match) return { host: match[1].toLowerCase(), path: match[2] || "/" };
  return { host: "", path: decoded.slice(0, 80) };
}

function cardText(item) {
  const parts = [];
  const walk = (node, depth) => {
    if (depth > 4 || parts.length > 40) return;
    if (Array.isArray(node)) {
      for (const value of node) walk(value, depth + 1);
      return;
    }
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  for (const child of Array.isArray(item.children) ? item.children : []) walk(child, 0);
  return parts.join(" ");
}

function suspicion(item) {
  const biz = (item.extra && item.extra.business_ext_map) || {};
  const ct = String(biz.contentType || biz.content_type || "").toUpperCase();
  const target = actionTarget(item.action);
  const reasons = [];
  if (ct && !CARD_PLAIN_CT.has(ct)) reasons.push("content_type:" + ct);
  if (!ct) reasons.push("content_type:missing");
  if (target.host && !SUSPECT_HOST.test(target.host)) reasons.push("host:" + target.host);
  if (/km_paid|paid_content/i.test(target.path)) reasons.push("path:paid");
  if (SUSPECT_TEXT.test(cardText(item))) reasons.push("text:salt");
  return reasons;
}

// 推荐流卡片摘要（仅调试）：把「这张卡长什么样、为什么留/删」压成一行，
// 用来判断没被删掉的会员卡到底把链接放在哪个字段。不打完整 body。
function summarizeFeed(item, verdict, reason) {
  const links = [];
  const collect = (node, depth) => {
    if (depth > 4 || links.length >= 6) return;
    if (Array.isArray(node)) {
      for (const value of node) collect(value, depth + 1);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        if (LINK_KEY.test(key) && links.length < 8) {
          const decoded = decodeLoose(value).replace(/^route_url=/, "");
          links.push(decoded.length > 120 ? decoded.slice(0, 120) + "…" : decoded);
        }
      } else if (value && typeof value === "object") {
        collect(value, depth + 1);
      }
    }
  };
  collect(item, 0);
  const target = (item.target && typeof item.target === "object" && item.target) ||
    (item.object && typeof item.object === "object" && item.object) || {};
  const children = Array.isArray(item.children) ? item.children : [];
  const action = item.action && typeof item.action === "object" ? item.action : {};
  const biz = (item.extra && item.extra.business_ext_map) || {};
  const template = children.map((child) => (child && child.style) || "")
    .find((style) => style && style !== "divider_V_6_id" && style !== "divider_V_8_id" &&
      style !== "divider_v_4_id" && style !== "text_recommend_title") || null;
  return {
    id: item.id === undefined ? target.id : item.id,
    type: item.type || null,
    style: item.style || null,
    verdict,
    reason: reason || null,
    keys: Object.keys(item).slice(0, 12),
    targetKeys: Object.keys(target).slice(0, 12),
    targetType: target.type || null,
    template,
    ct: biz.contentType || biz.content_type || null,
    act: (() => { const t = actionTarget(action); return t.host ? t.host + t.path.slice(0, 60) : null; })(),
    action: action.type ? { type: action.type, parameter: decodeLoose(String(action.parameter || "")).replace(/^route_url=/, "").slice(0, 140) } : null,
    biz: {
      contentType: biz.contentType || biz.content_type || null,
      media: biz.media_type || null,
      deliver: biz.deliver_type || null,
    },
    children: children.slice(0, 8).map((child) => (child && (child.style || child.type)) || null),
    links,
  };
}

function isMemberOnly(item) {
  if (!item || typeof item !== "object") return false;
  const answer = item.target || item.object || item.answer ||
    (item.unify_content && item.unify_content.content_info) || item;
  if (hasPaidShare(item)) return true;
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
  const feedProbes = debug && FEED_URL.test(url) ? [] : null;
  if (purify && body && (FEED_URL.test(url) || NEXT_RENDER_URL.test(url) || QUESTION_URL.test(url) || SEARCH_URL.test(url))) {
    for (const key of ["data", "dataV1"]) {
      if (!Array.isArray(body[key])) continue;
      const before = body[key].length;
      body[key] = body[key].filter((item) => {
        const member = isMemberOnly(item);
        if (feedProbes && item && typeof item === "object") {
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
              card: full.slice(0, 2400),
            }));
          }
        }
        return !member;
      });
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
      body.structured_content.segments = body.structured_content.segments.filter(
        (s) => !s || s.type !== "card" || !isAdCardSegment(s)
      );
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

  if (feedProbes) console.log("ZHFEED " + JSON.stringify({
    url: url.split("?")[0],
    cards: feedProbes.slice(0, 12),
  }));

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
