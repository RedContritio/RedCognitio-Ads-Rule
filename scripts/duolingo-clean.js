/* SPDX-License-Identifier: Apache-2.0 */

// 多邻国（Duolingo）去广告：改写首方用户数据的订阅档位
//
// 每小节结束那条插屏放不放，客户端读的是**账号档位**，不是广告接口。所以改写点选在首方
// 用户数据响应上，把三处字段改成付费态：
//
//   userdata.shopItems[]                          补一条 gold_subscription（含 productId / renewer / 到期）
//   userdata.subscriberLevel                      改 "GOLD"
//   userdata.trackingProperties.has_item_*_subscription   immersive / premium / live / gold / max 全 true
//
// 拦的是 ios-api-* / api\d+ 的 `2023-05-23/batch`（批量包裹）与 `2023-05-23/users/{id}`（裸 userdata）。
// 三种 body 形态都要接住：
//   1) responses[i].body 是 JSON 字符串
//   2) responses[i].body 已是对象（服务端把嵌套形态换过一次）
//   3) 整个响应就是裸 userdata
//
// 缓存语义：带 etag 的那一条一律原样放行。App 用 ETag 走条件请求，命中 304 时 body 为空；
// 硬改会解析失败或污染缓存，表现为「会员状态时有时无」。
//
// 有意不改的（别人脚本里顺手做的那些）：xp_boost_stackable、pathSectioned 关卡状态、
// liveOpsChallenges 时长、题池清空。它们与去广告没有因果关系，只会把「伪造订阅」升级成
// 「伪造进度与收益」，风控处置不是一个量级。

const SUBSCRIPTION_ID = "gold_subscription";
const SUBSCRIPTION_PRODUCT = "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168";
const TRACKING_KEYS = ["immersive", "premium", "live", "gold", "max"].map(name => "has_item_" + name + "_subscription");
const ONE_YEAR = 31536000;

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
const enabled = arg?.duolingo_enable === true || arg?.duolingo_enable === "true" || arg?.duolingo_enable === undefined;
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) &&
  (arg?.duolingo_debug === true || arg?.duolingo_debug === "true");

const body = $response && typeof $response.body === "string" ? $response.body : "";
const short = String(($request && $request.url) || "").split("?")[0];

function hasEtag(headers) {
  if (!headers || typeof headers !== "object") return false;
  return Object.keys(headers).some(key => key.toLowerCase() === "etag");
}

// 幂等：已有金标订阅只续期，不重复 push。batch 一次响应可能被连改多次，
// 早期脚本每命中一次就 push 一条，shopItems 里能堆十几条金标订阅。
function applySubscription(userdata, now) {
  if (!Array.isArray(userdata.shopItems)) userdata.shopItems = [];
  const existing = userdata.shopItems.find(item => item && item.id === SUBSCRIPTION_ID);
  if (existing) {
    const info = existing.subscriptionInfo && typeof existing.subscriptionInfo === "object"
      ? existing.subscriptionInfo
      : {};
    info.expectedExpiration = now + ONE_YEAR;
    info.renewing = true;
    existing.subscriptionInfo = info;
    return "renew";
  }
  userdata.shopItems.push({
    id: SUBSCRIPTION_ID,
    purchaseDate: now - 172800,
    purchasePrice: 0,
    subscriptionInfo: {
      expectedExpiration: now + ONE_YEAR,
      productId: SUBSCRIPTION_PRODUCT,
      renewer: "APPLE",
      renewing: true,
      tier: "twelve_month",
      type: "gold",
    },
  });
  return "push";
}

function applyTier(userdata) {
  let level = 0;
  if (userdata.subscriberLevel !== "GOLD") {
    userdata.subscriberLevel = "GOLD";
    level = 1;
  }
  if (!userdata.trackingProperties || typeof userdata.trackingProperties !== "object") userdata.trackingProperties = {};
  let tracking = 0;
  for (const key of TRACKING_KEYS) {
    if (userdata.trackingProperties[key] !== true) {
      userdata.trackingProperties[key] = true;
      tracking += 1;
    }
  }
  return { level, tracking };
}

// 只认「用户数据对象」：免费态的 userdata 至少带 shopItems / subscriberLevel 之一，
// 或者是有 id 且带 trackingProperties 的裸对象（users/{id} 的形态）。
function isUserdata(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value.shopItems !== undefined ||
      value.subscriberLevel !== undefined ||
      (value.id !== undefined && value.trackingProperties !== undefined));
}

function patchOne(raw, now) {
  let userdata = raw;
  let stringify = false;
  if (typeof raw === "string") {
    try {
      userdata = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    stringify = true;
  }
  if (!isUserdata(userdata)) return null;
  const subscription = applySubscription(userdata, now);
  const tier = applyTier(userdata);
  return { body: stringify ? JSON.stringify(userdata) : userdata, subscription, tier };
}

if (!enabled) {
  if (debug) console.log("DUOLINGO-CLEAN-OFF " + short);
  $done({});
} else if (!body) {
  // requires_body 未生效或响应体被丢弃：不动
  if (debug) console.log("DUOLINGO-CLEAN-NOBODY " + short);
  $done({});
} else {
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") {
    if (debug) console.log("DUOLINGO-CLEAN-SKIP " + short);
    $done({});
  } else {
    const now = Math.floor(Date.now() / 1000);
    const detail = [];
    let changed = 0;
    let skipped = 0;
    if (Array.isArray(payload.responses)) {
      for (const entry of payload.responses) {
        if (!entry || typeof entry !== "object") continue;
        if (hasEtag(entry.headers)) {
          skipped += 1;
          continue;
        }
        const result = patchOne(entry.body, now);
        if (!result) {
          skipped += 1;
          continue;
        }
        entry.body = result.body;
        changed += 1;
        detail.push(result.subscription + "/" + result.tier.level + "/" + result.tier.tracking);
      }
    } else {
      const result = patchOne(payload, now);
      if (result) {
        payload = result.body;
        changed += 1;
        detail.push(result.subscription + "/" + result.tier.level + "/" + result.tier.tracking);
      } else {
        skipped += 1;
      }
    }
    if (!changed) {
      if (debug) console.log("DUOLINGO-CLEAN-SKIP " + short + " skip=" + skipped);
      $done({});
    } else {
      if (debug) {
        console.log("DUOLINGO-CLEAN " + short + " changed=" + changed + " skip=" + skipped + " " + detail.join(","));
      }
      $done({ body: JSON.stringify(payload) });
    }
  }
}
