/* SPDX-License-Identifier: Apache-2.0 */
const TRACKING_KEYS = [ "immersive", "premium", "live", "gold", "max" ].map(name => "has_item_" + name + "_subscription");

let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

const enabled = !0 === arg?.duolingo_enable || "true" === arg?.duolingo_enable || void 0 === arg?.duolingo_enable, debug = !0 === arg?.duolingo_debug || "true" === arg?.duolingo_debug, body = $response && "string" == typeof $response.body ? $response.body : "", short = String($request && $request.url || "").split("?")[0];

function hasEtag(headers) {
    return !(!headers || "object" != typeof headers) && Object.keys(headers).some(key => "etag" === key.toLowerCase());
}

function patchOne(raw, now) {
    let userdata = raw, stringify = !1;
    if ("string" == typeof raw) {
        try {
            userdata = JSON.parse(raw);
        } catch (e) {
            return null;
        }
        stringify = !0;
    }
    if (!(value = userdata) || "object" != typeof value || Array.isArray(value) || void 0 === value.shopItems && void 0 === value.subscriberLevel && (void 0 === value.id || void 0 === value.trackingProperties)) return null;
    var value;
    const subscription = function(userdata, now) {
        Array.isArray(userdata.shopItems) || (userdata.shopItems = []);
        const existing = userdata.shopItems.find(item => item && "gold_subscription" === item.id);
        if (existing) {
            const info = existing.subscriptionInfo && "object" == typeof existing.subscriptionInfo ? existing.subscriptionInfo : {};
            return info.expectedExpiration = now + 31536e3, info.renewing = !0, existing.subscriptionInfo = info,
            "renew";
        }
        return userdata.shopItems.push({
            id: "gold_subscription",
            purchaseDate: now - 172800,
            purchasePrice: 0,
            subscriptionInfo: {
                expectedExpiration: now + 31536e3,
                productId: "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168",
                renewer: "APPLE",
                renewing: !0,
                tier: "twelve_month",
                type: "gold"
            }
        }), "push";
    }(userdata, now), tier = function(userdata) {
        let level = 0;
        "GOLD" !== userdata.subscriberLevel && (userdata.subscriberLevel = "GOLD", level = 1),
        userdata.trackingProperties && "object" == typeof userdata.trackingProperties || (userdata.trackingProperties = {});
        let tracking = 0;
        for (const key of TRACKING_KEYS) !0 !== userdata.trackingProperties[key] && (userdata.trackingProperties[key] = !0,
        tracking += 1);
        return {
            level,
            tracking
        };
    }(userdata);
    return {
        body: stringify ? JSON.stringify(userdata) : userdata,
        subscription,
        tier
    };
}

if (enabled) if (body) {
    let payload = null;
    try {
        payload = JSON.parse(body);
    } catch (e) {
        payload = null;
    }
    if (payload && "object" == typeof payload) {
        const now = Math.floor(Date.now() / 1e3), detail = [];
        let changed = 0, skipped = 0;
        if (Array.isArray(payload.responses)) for (const entry of payload.responses) {
            if (!entry || "object" != typeof entry) continue;
            if (hasEtag(entry.headers)) {
                skipped += 1;
                continue;
            }
            const result = patchOne(entry.body, now);
            result ? (entry.body = result.body, changed += 1, detail.push(result.subscription + "/" + result.tier.level + "/" + result.tier.tracking)) : skipped += 1;
        } else {
            const result = patchOne(payload, now);
            result ? (payload = result.body, changed += 1, detail.push(result.subscription + "/" + result.tier.level + "/" + result.tier.tracking)) : skipped += 1;
        }
        changed ? (debug && console.log("DUOLINGO-CLEAN " + short + " changed=" + changed + " skip=" + skipped + " " + detail.join(",")),
        $done({
            body: JSON.stringify(payload)
        })) : (debug && console.log("DUOLINGO-CLEAN-SKIP " + short + " skip=" + skipped),
        $done({}));
    } else debug && console.log("DUOLINGO-CLEAN-SKIP " + short), $done({});
} else debug && console.log("DUOLINGO-CLEAN-NOBODY " + short), $done({}); else debug && console.log("DUOLINGO-CLEAN-OFF " + short),
$done({});
