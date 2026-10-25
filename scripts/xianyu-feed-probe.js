/* SPDX-License-Identifier: Apache-2.0 */
// 闲鱼信息流结构探针：不打印整包，只输出卡片类型与广告相关键，
// 用来确认广告卡是随 feed 下发还是独立取数。前缀 XYFEED。

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}

if (arg?.xianyu_debug === true || arg?.xianyu_debug === "true") {
  let body = null;
  try {
    body = JSON.parse($response.body || "{}");
  } catch (e) {
    body = null;
  }

  if (body === null) {
    console.log("XYFEED-PARSE-ERROR " + $request.url);
  } else {
    const adKey = (node) =>
      node && typeof node === "object"
        ? Object.keys(node).filter((k) => /ad|adv|promot|sponsor|mama/i.test(k))
        : [];

    const lists = [];
    for (const key of ["data", "dataV1", "items", "feedList"]) {
      if (Array.isArray(body[key])) lists.push([key, body[key]]);
      else if (body[key] && Array.isArray(body[key].items)) lists.push([`${key}.items`, body[key].items]);
    }

    const report = lists.map(([name, list]) => ({
      list: name,
      total: list.length,
      cards: list.slice(0, 12).map((item) => ({
        type: item?.type ?? item?.cardType ?? item?.itemType ?? null,
        id: item?.id ?? item?.cardId ?? null,
        keys: adKey(item),
        nested: Array.isArray(item?.children)
          ? item.children.slice(0, 6).map((c) => ({
              type: c?.type ?? c?.cardType ?? null,
              id: c?.id ?? null,
              keys: adKey(c),
            }))
          : undefined,
      })),
    }));

    console.log("XYFEED " + JSON.stringify({
      url: $request.url.split("?")[0],
      top: Object.keys(body),
      ret: body.ret,
      lists: report,
    }));
  }
}
$done({});
