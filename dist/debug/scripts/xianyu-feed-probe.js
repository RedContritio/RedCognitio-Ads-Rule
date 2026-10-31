/* SPDX-License-Identifier: Apache-2.0 */
let arg = $argument;

if ("string" == typeof arg) try {
    arg = JSON.parse(arg);
} catch (e) {
    arg = null;
}

if (!0 === arg?.xianyu_debug || "true" === arg?.xianyu_debug) {
    let body = null;
    try {
        body = JSON.parse($response.body || "{}");
    } catch (e) {
        body = null;
    }
    if (null === body) console.log("XYFEED-PARSE-ERROR " + $request.url); else {
        const adKey = node => node && "object" == typeof node ? Object.keys(node).filter(k => /ad|adv|promot|sponsor|mama/i.test(k)) : [], lists = [];
        for (const key of [ "data", "dataV1", "items", "feedList" ]) Array.isArray(body[key]) ? lists.push([ key, body[key] ]) : body[key] && Array.isArray(body[key].items) && lists.push([ `${key}.items`, body[key].items ]);
        const report = lists.map(([name, list]) => ({
            list: name,
            total: list.length,
            cards: list.slice(0, 12).map(item => ({
                type: item?.type ?? item?.cardType ?? item?.itemType ?? null,
                id: item?.id ?? item?.cardId ?? null,
                keys: adKey(item),
                nested: Array.isArray(item?.children) ? item.children.slice(0, 6).map(c => ({
                    type: c?.type ?? c?.cardType ?? null,
                    id: c?.id ?? null,
                    keys: adKey(c)
                })) : void 0
            }))
        }));
        console.log("XYFEED " + JSON.stringify({
            url: $request.url.split("?")[0],
            top: Object.keys(body),
            ret: body.ret,
            lists: report
        }));
    }
}

$done({});
