const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const source = fs.readFileSync(
  path.join(__dirname, "../scripts/zhihu-clean.js"),
  "utf8"
);
const variants = [
  "RedCognitio-Ads.plugin", "RedCognitio-Ads-ghproxy.plugin",
  "RedCognitio-Ads-jsdelivr.plugin", "RedCognitio-Ads-debug.plugin",
  "RedCognitio-Ads-debug-ghproxy.plugin", "RedCognitio-Ads-debug-jsdelivr.plugin",
];

function rewrite(body, filename, endpoint) {
  const lines = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").split("\n");
  const rule = lines.find((line) => line.includes(endpoint) && line.includes("response.json.jq("));
  if (!rule) {
    const script = lines.find((line) => line.includes("zhihu-clean.js") && line.startsWith("response if"));
    assert(script, `${filename}: ${endpoint}`);
    const url = endpoint === "topstory" ? "https://api.zhihu.com/topstory/recommend"
      : `https://api.zhihu.com/${endpoint}?type=answer`;
    const expression = new RegExp(script.match(/~= \/(.*?)\/i then/)[1], "i");
    assert(expression.test(url), `${filename}: ${url}`);
    return clean(body, { url });
  }
  const program = JSON.parse(rule.slice(rule.indexOf("response.json.jq(") + 17, -1));
  const result = spawnSync("jq", ["-c", program], { input: JSON.stringify(body), encoding: "utf8" });
  assert.equal(result.status, 0, `${filename}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function run(body, options = {}) {
  let result;
  vm.runInNewContext(source, {
    $request: {
      url: options.url || "https://api.zhihu.com/topstory/recommend",
    },
    $response: { body: options.raw ? body : JSON.stringify(body) },
    $argument: options.argument,
    $done(value) {
      assert.equal(result, undefined);
      result = value;
    },
    console: { log(...args) { if (options.logs) options.logs.push(args.join(" ")); } },
  });
  return JSON.parse(JSON.stringify(result));
}

function clean(body, options) {
  return JSON.parse(run(body, options).body);
}

function rewriteAnswerUrl(url, filename, enabled = true) {
  const rule = fs.readFileSync(path.join(__dirname, "..", filename), "utf8")
    .split("\n").find((line) => line.includes('as answerFlow then url.replace('));
  assert(rule, filename);
  if (!enabled && rule.includes("${zhihu_purify}")) return url;
  const expression = new RegExp(rule.match(/~= \/(.*?)\/i as answerFlow/)[1], "i");
  const replacement = JSON.parse(rule.match(/url\.replace\((".*")\)$/)[1]);
  return url.replace(expression, (...args) => replacement.replace(
    /\$\{answerFlow\.(\d+)\}/g, (_, index) => args[Number(index)]
  ));
}

test("详情页只删带广告标记的 card 段，正文卡片与图片保留", () => {
  const body = {
    type: "pin",
    third_business: { ads: [] },
    structured_content: { segments: [
      { type: "image", src: "https://pic1.zhimg.com/pin.jpg" },
      { type: "card", card: { card_type: "reward_tail_truncate" }, id: "" },
      { type: "card", subtype: "free_column_card" },
      { type: "card", card: { card_type: "ad_creative" } },
      { type: "card", card: { card_type: "pin_image", ad_info: { x: 1 } } },
      { type: "paragraph", text: "hello" },
    ] },
  };
  const out = clean(body, { url: "https://api.zhihu.com/pins/v2/2097062424318850643?single_content=1" });
  assert.equal("third_business" in out, false);
  // ad_creative 按 card_type 判定删除；pin_image 只是带 ad_info 的图文卡，ad_info 被 scrub 清掉后保留
  assert.deepEqual(out.structured_content.segments.map((s) => s.card?.card_type || s.subtype || s.type),
    ["image", "reward_tail_truncate", "free_column_card", "pin_image", "paragraph"]);
  assert.equal("ad_info" in out.structured_content.segments[3].card, false);
});

test("详情页普通 card 段多的响应不会被清空", () => {
  const body = {
    type: "answer",
    structured_content: { segments: [
      { type: "card", card: { card_type: "reward_tail_truncate" } },
      { type: "card", card: { card_type: "video_card" } },
      { type: "card", card: { card_type: "pin_image" } },
    ] },
  };
  const out = clean(body, { url: "https://api.zhihu.com/v4/answers/123" });
  assert.equal(out.structured_content.segments.length, 3);
});

test("answer scrolling requests the current question regardless of query order", () => {
  for (const filename of variants) {
    for (const endpoint of ["next-render", "simple-next-render"]) {
      for (const query of [
        "id=1000000000000000011&type=answer&scenes=recommend&context_expand=1&is_native=1",
        "scenes=recommend&type=answer&id=1000000000000000011",
        "type=answer&id=1000000000000000011&scenes=recommend",
        "scenes=search&id=1000000000000000011&type=answer",
        "context_expand=1&id=1000000000000000011&limit=5&page_id=2&scenes=recommend&session_id=2000000000000000022&type=answer",
        "type=answer&scenes=question&id=1000000000000000011",
      ]) {
        const url = `https://api.zhihu.com/${endpoint}?${query}`;
        const expected = query.replace(/scenes=[^&]*/, "scenes=question");
        assert.equal(rewriteAnswerUrl(url, filename), `https://api.zhihu.com/${endpoint}?${expected}`, filename);
      }
    }
  }
});

test("answer scene rewrite preserves other content, endpoints, domains and disabled plugins", () => {
  const urls = [
    "https://api.zhihu.com/next-render?type=pin&scenes=recommend&id=123",
    "https://api.zhihu.com/simple-next-render?type=article&scenes=recommend&id=123",
    "https://api.zhihu.com/next-render?type=answer_extra&scenes=recommend",
    "https://api.zhihu.com/next-render?subtype=answer&scenes=recommend",
    "https://api.zhihu.com/next-render?id=123&redirect=type%3Danswer&scenes=recommend",
    "https://api.zhihu.com/next-render?type=answer&id=123",
    "https://api.zhihu.com/answers/v2/123?type=answer&scenes=recommend",
    "https://api.zhihu.com/topstory/recommend?type=answer&scenes=recommend",
    "https://api.zhihu.com.evil.test/next-render?type=answer&scenes=recommend",
  ];
  for (const filename of variants) {
    for (const url of urls) assert.equal(rewriteAnswerUrl(url, filename), url, filename);
    const url = "https://api.zhihu.com/next-render?type=answer&scenes=recommend&id=123";
    assert.equal(rewriteAnswerUrl(url, filename, false), url, filename);
  }
});

const answerFlow = {
  data: [
    { type: "answer", id: "first", structured_content: { segments: [
      { type: "image", src: "https://pic1.zhimg.com/image.jpg" },
      { type: "card", subtype: "free_column_card" },
    ] }, ad_info: { data: "embedded-ad" } },
    { type: "ad", id: "advert", adjson: JSON.stringify({ ads: [{ ad_zone_id: 1621 }] }) },
    { type: "answer", id: "second", adjson: "embedded-ad" },
    null,
    { type: "future_answer", id: "third" },
  ],
  paging: { next: "/next-render?type=answer&id=second", is_end: false },
};
const cleanAnswerFlow = {
  data: [
    { type: "answer", id: "first", structured_content: answerFlow.data[0].structured_content },
    { type: "answer", id: "second" },
    null,
    { type: "future_answer", id: "third" },
  ],
  paging: answerFlow.paging,
};

test("removes answer-stream ads while preserving answers, images, cards and paging", () => {
  for (const endpoint of ["next-render", "simple-next-render"]) {
    assert.deepEqual(clean(answerFlow, {
      url: `https://api.zhihu.com/${endpoint}?type=answer&id=first`,
    }), cleanAnswerFlow);
  }
});

test("does not remove an unknown ad type outside the answer stream", () => {
  const body = { data: [{ type: "ad", text: "ordinary content" }] };
  assert.deepEqual(clean(body), body);
});

test("removes independent and promoted ads from both feed representations", () => {
  const promotion = JSON.stringify({ is_card: true, id: "campaign" });
  const body = {
    data: [
      { type: "ComponentCard", id: "normal" },
      { type: "ComponentCard", extra: { promotion } },
      { type: "feed_advert", adjson: "{}" },
    ],
    dataV1: [
      { type: "sdui", id: "normal" },
      { type: "sdui", unify_content: { biz_ext: { promotion } } },
      { type: "feed_advert", adjson: "{}" },
    ],
    paging: { next: "/next", is_end: false },
  };
  assert.deepEqual(clean(body), {
    data: [{ type: "ComponentCard", id: "normal" }],
    dataV1: [{ type: "sdui", id: "normal" }],
    paging: body.paging,
  });
});

test("supports a response containing only dataV1", () => {
  assert.deepEqual(clean({
    dataV1: [
      { type: "sdui", id: "normal" },
      { type: "sdui", unify_content: { rec: { RetrievalInfo: {
        commercial_promotion_rpc_extra: JSON.stringify({ campaign_id: "ad" }),
      } } } },
    ],
  }), { dataV1: [{ type: "sdui", id: "normal" }] });
});

test("removes homepage videos from legacy and SDUI feeds without changing text, images or paging", () => {
  const normal = [
    { type: "ComponentCard", extra: { content_type: "answer" }, children: [
      { type: "Text", text: "关于 video、zvideo 和 StyleVideo 的讨论" },
      { type: "Images", style: "BIG_IMAGE", src: "https://pic1.zhimg.com/image.jpg" },
    ] },
    { type: "AnswerCard", target: { type: "answer" } },
  ];
  const modern = [{ type: "sdui", unify_content: { content_info: { content_type: "ARTICLE" } } }];
  const body = {
    data: [
      ...normal,
      { type: "ComponentCard", extra: { content_type: "zvideo" } },
      { type: "ComponentCard", target: { type: "zvideo" } },
      { type: "ComponentCard", children: [{ type: "Video" }] },
      { type: "ComponentCard", children: [{ type: "View", style: "StyleVideo" }] },
      { type: "video_collection" },
      { type: "ComponentCard", extra: { answer_type: "video_answer" } },
    ],
    dataV1: [
      ...modern,
      { type: "sdui", unify_content: { content_info: { content_type: "ZVIDEO" } } },
      { type: "sdui", unify_content: { content_info: { content_type: "VIDEO" } } },
    ],
    paging: { next: "/topstory/recommend?after_id=last", is_end: false },
  };
  const expected = { data: normal, dataV1: modern, paging: body.paging };
  assert.deepEqual(clean(body), expected);
  for (const filename of variants) {
    assert.deepEqual(rewrite(body, filename, "topstory"), expected, filename);
    assert.deepEqual(rewrite({ dataV1: body.dataV1 }, filename, "topstory"), { dataV1: modern }, filename);
  }
});

test("homepage rewrites preserve unknown cards, absent lists and literal ad marker text", () => {
  const bodies = [
    {}, { data: [] }, { dataV1: [] },
    { data: [{ type: "FutureCard", text: "commercial_promotion_rpc_extra plutus_adreaper zhi_plus" }] },
    { dataV1: [{ type: "sdui", unify_content: { biz_ext: { promotion: "invalid" } } }] },
    { dataV1: [{ type: "sdui", unify_content: { biz_ext: { promotion: { is_card: false } } } }] },
  ];
  for (const body of bodies) {
    assert.deepEqual(clean(body), body);
    for (const filename of variants) {
      assert.deepEqual(rewrite(body, filename, "topstory"), body, filename);
    }
  }
});

test("homepage rewrites remove structured promotions and nested ads in both representations", () => {
  const items = [
    { type: "ComponentCard", children: [{ type: "Text", text: "retained" }, { type: "AdCard" }], adjson: "{}", ad_list: [] },
    { type: "ComponentCard", extra: { promotion: JSON.stringify({ is_card: true }) } },
    { type: "sdui", unify_content: { biz_ext: { promotion: { is_card: true } } } },
    { type: "sdui", unify_content: { rec: { RetrievalInfo: { commercial_promotion_rpc_extra: '{"id":"ad"}' } } } },
    { type: "feed_advert" },
  ];
  const body = { data: items, dataV1: items };
  const retained = { type: "ComponentCard", children: [items[0].children[0]] };
  const expected = { data: [retained], dataV1: [retained] };
  assert.deepEqual(clean(body), expected);
  for (const filename of variants) assert.deepEqual(rewrite(body, filename, "topstory"), expected, filename);
});

test("keeps videos outside the homepage recommendation feed", () => {
  const body = { data: [{ type: "answer", target: { type: "zvideo" }, children: [{ type: "Video" }] }] };
  assert.deepEqual(clean(body, { url: "https://api.zhihu.com/next-render?type=answer" }), body);
  assert.deepEqual(clean(body, { url: "https://api.zhihu.com/v4/questions/123/answers" }), body);
});

test("preserves content types and ordinary text mentioning ad markers", () => {
  const body = {
    data: [{ type: "AnswerCard", text: "zhi_plus plutus_adreaper commercial_promotion_rpc_extra" }],
    dataV1: [{ type: "NewContentCard", id: "normal" }],
  };
  assert.deepEqual(clean(body), body);
});

test("preserves empty, false and malformed promotion metadata", () => {
  const body = { data: [
    { type: "ComponentCard", extra: { promotion: null } },
    { type: "ComponentCard", extra: { promotion: { is_card: false } } },
    { type: "ComponentCard", extra: { promotion: "invalid" } },
    { type: "ComponentCard", unify_content: { rec: { RetrievalInfo: {
      commercial_promotion_rpc_extra: "{}",
    } } } },
  ] };
  assert.deepEqual(clean(body), body);
});

test("removes nested ads while retaining adjacent content", () => {
  assert.deepEqual(clean({ data: [{ type: "ComponentCard", children: [
    { type: "Text", text: "normal" },
    { type: "AdCard" },
    { type: "View", style: "plutus_card_banner" },
    { type: "View", style: "brand_card_image" },
  ] }] }), { data: [{ type: "ComponentCard", children: [
    { type: "Text", text: "normal" },
  ] }] });
});

test("preserves an already clean feed", () => {
  const body = { data: [{ type: "ComponentCard", id: "normal" }], styles: {}, extra: {} };
  assert.deepEqual(clean(body), body);
  assert.deepEqual(clean({}), {});
});

test("leaves the response untouched when disabled", () => {
  for (const argument of [{ zhihu_enable: false, zhihu_purify: false }, JSON.stringify({ zhihu_enable: false, zhihu_purify: false })]) {
    assert.deepEqual(run({ data: [{ type: "feed_advert" }] }, { argument }), {});
  }
  for (const argument of [undefined, null, {}, { zhihu_enable: true }, JSON.stringify({ zhihu_enable: true })]) {
    assert.deepEqual(clean({ data: [{ type: "feed_advert" }] }, { argument }), { data: [] });
  }
});

test("leaves non-JSON responses untouched", () => {
  assert.deepEqual(run("<html>body</html>", { raw: true }), {});
});

test("advertising and purification switches independently control homepage content", () => {
  const normal = { type: "answer", id: "normal", content: "关于会员服务的普通讨论" };
  const advert = { type: "feed_advert", id: "advert" };
  const promoted = { type: "ComponentCard", id: "promoted", extra: { promotion: { is_card: true } } };
  const video = { type: "ComponentCard", id: "video", extra: { content_type: "zvideo" } };
  const locked = { type: "answer", id: "locked", paid_info: { has_purchased: false } };
  const items = [normal, advert, promoted, video, locked];
  for (const [ads, purify, retained] of [
    [true, true, [normal]],
    [true, false, [normal, video, locked]],
    [false, true, [normal, advert, promoted]],
  ]) {
    for (const argument of [
      { zhihu_enable: ads, zhihu_purify: purify },
      JSON.stringify({ zhihu_enable: ads, zhihu_purify: purify }),
    ]) {
      assert.deepEqual(clean({ data: items, dataV1: items }, { argument }), { data: retained, dataV1: retained });
    }
  }
  assert.deepEqual(run({ data: items }, { argument: { zhihu_enable: false, zhihu_purify: false } }), {});
});

test("member restriction filtering skips answers in both scrolling APIs and question lists", () => {
  const normal = { type: "answer", id: "normal", question: { id: "question" } };
  const purchased = { type: "answer", id: "purchased", paid_info: { has_purchased: true } };
  const restricted = [
    { type: "answer", id: "unpaid", paid_info: { has_purchased: false, is_official: true } },
    { type: "answer", id: "vip-tip", structured_content_vip: { button: { text: "开通盐选会员，继续阅读" } } },
    { type: "answer", id: "paywall", structured_content: { segments: [
      { type: "paragraph", paragraph: { text: "免费试读部分" } },
      { type: "card", card: { button: { text: "开通会员阅读全文" } } },
    ] } },
    { type: "answer", id: "html", content: '<div class="KfeCollection-PurchaseBtn">开通会员</div>' },
  ];
  const paging = { next: "/next?page_id=3", is_end: false, totals: 99 };
  for (const endpoint of ["next-render?type=answer", "simple-next-render?type=answer", "v4/questions/123/answers", "questions/123/feeds"]) {
    const wrapped = endpoint.includes("feeds");
    const wrap = (target) => wrapped ? { type: "feed", target } : target;
    const body = { data: [normal, ...restricted, purchased].map(wrap), paging };
    const options = { url: `https://api.zhihu.com/${endpoint}`, argument: { zhihu_enable: false, zhihu_purify: true } };
    assert.deepEqual(clean(body, options), { data: [normal, purchased].map(wrap), paging });
    assert.deepEqual(clean(body, { ...options, argument: { zhihu_enable: true, zhihu_purify: false } }).data.map(x => (x.target || x).id), body.data.map(x => (x.target || x).id));
  }
});

test("membership filtering preserves ordinary discussion, author badges, empty metadata and purchased answers", () => {
  const data = [
    { type: "answer", id: "discussion", content: "不建议开通盐选会员，为什么很多网站都要求开通会员？" },
    { type: "answer", id: "paragraph", structured_content: { segments: [
      { type: "paragraph", paragraph: { text: "开通会员阅读全文这句话常见于付费网站。" } },
    ] } },
    { type: "answer", id: "author", author: { vip_info: { is_vip: true }, name: "盐选会员" } },
    { type: "answer", id: "empty", paid_info: {}, structured_content_vip: null },
    { type: "answer", id: "purchased", paid_info: { has_purchased: true, button: "开通会员" } },
    { type: "article", id: "article", paid_info: { has_purchased: false } },
  ];
  assert.deepEqual(clean({ data }, { url: "https://api.zhihu.com/next-render?type=answer", argument: { zhihu_enable: false, zhihu_purify: true } }), { data });
});

test("suspicious cards are dumped whole so a membership article need not be re-found", () => {
  const article = { id: "art-1", type: "ComponentCard", style: "card_padding_dynamic_GBK99A_V3",
    action: { type: "Route", parameter: "route_url=https%3A%2F%2Fwww.zhihu.com%2Farticle%2F123" },
    extra: { business_ext_map: { contentType: "ARTICLE", media_type: "IMAGE_TEXT" } },
    children: [{ style: "text_recommend_title", text: "盐选专栏：某篇会员文章" }] };
  const answer = { id: "ans-1", type: "ComponentCard",
    action: { type: "Route", parameter: "route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F1%2Fanswer%2F2" },
    extra: { business_ext_map: { contentType: "ANSWER" } },
    children: [{ style: "text_recommend_title", text: "普通回答" }] };
  const logs = [];
  clean({ data: [article, answer] }, { url: "https://api.zhihu.com/topstory/recommend", logs,
    argument: { zhihu_purify: true, zhihu_debug: true } });
  const suspects = logs.filter(line => line.startsWith("ZHFEED-SUSPECT ")).map(line => JSON.parse(line.slice("ZHFEED-SUSPECT ".length)));
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].id, "art-1");
  assert(suspects[0].reasons.includes("content_type:ARTICLE"));
  assert(suspects[0].reasons.includes("text:salt"));
  assert(suspects[0].card.includes("盐选专栏"));
  const feed = JSON.parse(logs.find(line => line.startsWith("ZHFEED ")).slice(7));
  assert.deepEqual(feed.cards.map(card => card.ct), ["ARTICLE", "ANSWER"]);
  assert.equal(feed.cards[1].act, "zhihu.com/question/1/answer/2");
});

test("paid share is detected through percent-encoded SDUI action routes", () => {
  const encoded = "route_url=https%3A%2F%2Foia.zhihu.com%2Fkm_paid_content%2Fshare%3Fkm_pst%3DAAA%26share_code%3DBBB";
  const paid = { id: "paid-card", type: "ComponentCard", style: "card_padding_dynamic_GBK99A_V3",
    action: { type: "Route", parameter: encoded },
    extra: { business_ext_map: { contentType: "KM_PAID_CONTENT", media_type: "IMAGE_TEXT", deliver_type: "Normal" } },
    children: [{ style: "text_recommend_title", text: "会员文章标题" }] };
  const normal = { id: "normal-card", type: "ComponentCard",
    action: { type: "Route", parameter: "route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F1%2Fanswer%2F2" },
    children: [{ style: "text_recommend_title", text: "普通回答" }] };
  const body = { data: [paid, normal], paging: { is_end: false } };
  const url = "https://api.zhihu.com/topstory/recommend";
  const logs = [];
  assert.deepEqual(clean(body, { url, logs, argument: { zhihu_purify: true, zhihu_debug: true } }),
    { data: [normal], paging: body.paging });
  const feed = JSON.parse(logs.find(line => line.startsWith("ZHFEED ")).slice(7));
  assert.deepEqual(feed.cards.map(card => [card.id, card.verdict]), [["paid-card", "dropped"], ["normal-card", "kept"]]);
  assert.equal(feed.cards[0].action.type, "Route");
  assert(feed.cards[0].action.parameter.startsWith("https://oia.zhihu.com/km_paid_content/share"));
  assert.deepEqual(feed.cards[0].biz, { contentType: "KM_PAID_CONTENT", media: "IMAGE_TEXT", deliver: "Normal" });
  assert.equal(feed.cards[1].links[0], "https://zhihu.com/question/1/answer/2");
});

test("feed diagnostics summarise each card so an unfiltered membership card can be identified", () => {
  const share = "https://oia.zhihu.com/km_paid_content/share?km_pst=AAA&share_code=BBB";
  const body = { data: [
    { type: "answer", id: "kept-1", target: { type: "answer", id: 1, url: "https://www.zhihu.com/question/1/answer/1" } },
    { type: "answer", id: "drop-1", target: { type: "answer", id: 2, link: { url: share } } },
  ], paging: { is_end: false } };
  const url = "https://api.zhihu.com/topstory/recommend";
  const logs = [];
  const kept = clean(body, { url, logs, argument: { zhihu_purify: true, zhihu_debug: true } });
  assert.deepEqual(kept, { data: [body.data[0]], paging: body.paging });
  const feed = JSON.parse(logs.find(line => line.startsWith("ZHFEED ")).slice(7));
  assert.equal(feed.url, url);
  assert.deepEqual(feed.cards.map(card => [card.id, card.verdict, card.reason]), [
    ["kept-1", "kept", null],
    ["drop-1", "dropped", "member_only"],
  ]);
  assert.deepEqual(feed.cards[0].links, ["https://www.zhihu.com/question/1/answer/1"]);
  assert.deepEqual(feed.cards[1].links, [share]);
  assert(feed.cards[0].keys.includes("target"));
  const quiet = [];
  clean(body, { url, logs: quiet, argument: { zhihu_purify: true } });
  assert(!quiet.some(line => line.startsWith("ZHFEED")));
});

test("feed drops paid-content share cards but keeps answers that merely quote the link", () => {
  const share = "https://oia.zhihu.com/km_paid_content/share?km_pst=3AYYrJmn7f5SE5cVu&share_code=VuFVcaaA3jdO&utm_psn=2100932556011188460";
  const wrapped = { type: "answer", target: { type: "answer", link: { url: share }, title: "会员文章" } };
  const nested = { type: "ComponentCard", id: "card", children: [
    { type: "answer", url: "https://www.zhihu.com/question/1/answer/2" },
    { type: "answer", target: { link: { url: share } } },
  ] };
  const quoted = { type: "answer", target: {
    type: "answer", content: "这条回答里贴了 " + share + " 的原文", url: "https://www.zhihu.com/question/1/answer/3",
  } };
  const normal = { type: "answer", target: {
    type: "answer", url: "https://www.zhihu.com/question/1/answer/4", content: "普通回答",
  } };
  const body = { data: [wrapped, nested, quoted, normal], paging: { is_end: false } };
  const url = "https://api.zhihu.com/topstory/recommend";
  const logs = [];
  const kept = clean(body, { url, logs, argument: {
    zhihu_enable: false, zhihu_purify: true, zhihu_debug: true,
  } });
  assert.deepEqual(kept, { data: [quoted, normal], paging: body.paging });
  const summary = JSON.parse(logs.find(line => line.startsWith("ZHCLEAN ")).slice(8));
  assert.equal(summary.restricted_removed, 2);
  assert.deepEqual(clean(body, { url, argument: { zhihu_purify: false } }), body);
});

test("membership filtering handles SDUI answers and retains pagination when an entire page is restricted", () => {
  const free = { type: "sdui", unify_content: { content_info: {
    content_type: "ANSWER", paid_info: { has_purchased: true },
  } } };
  const locked = { type: "sdui", unify_content: { content_info: {
    content_type: "ANSWER", paid_info: { has_purchased: false },
  } } };
  const paging = { next: "/topstory/recommend?page=next", is_end: false };
  const argument = { zhihu_enable: false, zhihu_purify: true };
  assert.deepEqual(clean({ dataV1: [free, locked], paging }, { argument }), { dataV1: [free], paging });
  assert.deepEqual(clean({ dataV1: [locked], paging }, { argument }), { dataV1: [], paging });
});

test("request rules allow image downloads and bare-IP connectivity probes while retaining ad blocking", () => {
  const requests = [
    ...["116.162.169.116", "211.97.84.77", "125.88.253.207", "43.242.197.211"].flatMap(host => [
      `http://${host}/`, `https://${host}/`,
    ]),
    ...["pic1", "pic2", "pic3", "pic4", "picx", "pica"].flatMap(host => [
      `https://${host}.zhimg.com/v2-image.jpg?source=7e7ef6e2&needBackground=1`,
      `https://${host}.zhimg.com/100/v2-image_qhd.heic`,
      `https://${host}.zhimg.com/v2-image_r.jpg`,
    ]),
  ];
  for (const filename of variants) {
    const lines = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").split("\n");
    const rules = lines.filter(line => line.startsWith("request if"))
      .map(line => new RegExp(line.match(/~= \/(.*?)\/[i]? (?:then|&&|as)/)[1], "i"));
    for (const url of requests) {
      assert(!rules.some(expression => expression.test(url)), `${filename}: ${url}`);
    }
    for (const url of [
      "https://api.zhihu.com/commercial_api/launch_v2",
      "https://api.zhihu.com/commercial_api/answer/123/bottom-v2",
      "https://zhstatic.zhihu.com/brand-ad/creative.pag",
    ]) assert(rules.some(expression => expression.test(url)), `${filename}: ${url}`);
    assert(!lines.some(line => /^(?:AND|IP-CIDR)/.test(line) && /IP-CIDR/.test(line)), filename);
  }
});

test("purification keeps answer videos and controls interface extras independently of ads", () => {
  const body = {
    type: "answer", id: "123", video: { id: "video" },
    ad_info: { data: "ad" }, third_business: { campaign: "ad" },
    float_search_word: "search", interaction_bar_plugins: [], ring_info: {},
  };
  const url = "https://api.zhihu.com/answers/v2/123";
  assert.deepEqual(clean(body, { url, argument: { zhihu_enable: true, zhihu_purify: false } }), {
    type: "answer", id: "123", video: body.video,
    float_search_word: "search", interaction_bar_plugins: [], ring_info: {},
  });
  assert.deepEqual(clean(body, { url, argument: { zhihu_enable: false, zhihu_purify: true } }), {
    type: "answer", id: "123", video: body.video, ad_info: body.ad_info, third_business: body.third_business,
  });
});

test("search purification removes explicitly restricted paid products and preserves free or purchased content", () => {
  const items = [
    { type: "search_result", object: { type: "column", id: "ordinary-column", title: "知识专栏" } },
    { type: "search_result", object: { type: "answer", id: "discussion", content: "开通知识会员是否值得？" } },
    { type: "search_result", object: { type: "paid_content", id: "labelled", label_info: { type: "purchase_required", text: "购买后阅读" } } },
    { type: "search_result", object: { type: "album", id: "paid-album", is_purchased: false } },
    { type: "search_result", object: { type: "paid_column", id: "purchased", is_purchased: true, label_info: { type: "purchase_required" } } },
    { type: "search_result", object: { type: "paid_column", id: "free", is_free: true, is_purchased: false } },
    { type: "search_result", object: { type: "paid_column", id: "unknown" } },
    { type: "search_result", object: { type: "answer", id: "knowledge-tip", vip_tip: { button: "开通知识会员，继续阅读" } } },
  ];
  const paging = { next: "/search_v3?offset=10", is_end: false };
  const url = "https://api.zhihu.com/search_v3?t=general";
  const logs = [];
  const result = clean({ data: items, paging, pendant: { campaign: "membership" } }, {
    url, argument: { zhihu_enable: false, zhihu_purify: true, zhihu_debug: true }, logs,
  });
  assert.deepEqual(result, { data: [items[0], items[1], items[4], items[5], items[6]], paging });
  const summary = JSON.parse(logs.find(line => line.startsWith("ZHCLEAN ")).slice(8));
  assert.equal(summary.restricted_removed, 3);
  assert.equal(summary.video_removed, 0);
  const untouched = { data: items, paging, pendant: { campaign: "membership" } };
  assert.deepEqual(clean(untouched, { url, argument: { zhihu_enable: true, zhihu_purify: false } }), untouched);
});

test("search purification removes knowledge courses and paid novel cards using their actual commodity metadata", () => {
  const courses = [
    { type: "knowledge_ad", object: {
      header: { card_title: "" }, body: { title: "课程第一讲", images: [] },
      commodity_type: "album_paid_column", card_type: "knowledge_vip",
    } },
    { type: "knowledge_ad", object: {
      header: { card_title: "" }, body: { title: "课程第二讲", images: [] },
      commodity_type: "album_paid_column", card_type: "knowledge_vip",
    } },
  ];
  const novels = [
    { type: "knowledge_ad", object: {
      header: { card_title: "小说" }, body: { title: "小说第一篇", images: ["cover.jpg"] },
      commodity_type: "paid_column_chapter", card_type: "", footer: "盐选专栏 · 赞同",
    } },
    { type: "knowledge_ad", object: {
      header: { card_title: "小说" }, body: { title: "小说第二篇", images: ["cover.jpg"] },
      commodity_type: "paid_column_chapter", card_type: "", footer: "盐选专栏 · 评论",
    } },
  ];
  const normal = [
    { type: "search_result", object: { type: "answer", title: "小说", content: "普通回答" } },
    { type: "search_result", object: { type: "article", title: "知识专栏", content: "普通文章" } },
    { type: "relevant_query", query: "小说开头" },
  ];
  const paging = { next: "/search_v3?offset=20", is_end: false };
  const body = { data: [...courses, normal[0], ...novels, ...normal.slice(1)], paging };
  const url = "https://api.zhihu.com/search_v3?t=general";
  const logs = [];
  assert.deepEqual(clean(body, { url, logs, argument: {
    zhihu_enable: false, zhihu_purify: true, zhihu_debug: true,
  } }), { data: normal, paging });
  const summary = JSON.parse(logs.find(line => line.startsWith("ZHCLEAN ")).slice(8));
  assert.equal(summary.restricted_removed, 4);
  assert.deepEqual(clean(body, { url, argument: {
    zhihu_enable: true, zhihu_purify: false,
  } }), body);
  assert.deepEqual(clean({ data: [...courses, ...novels], paging }, { url }), { data: [], paging });
});

test("knowledge card filtering preserves explicit access and unknown products", () => {
  const objects = [
    { commodity_type: "paid_column_chapter", is_purchased: true },
    { commodity_type: "album_paid_column", has_purchased: true },
    { card_type: "knowledge_vip", paid_info: { has_purchased: true } },
    { commodity_type: "paid_column_chapter", is_free: true },
    { commodity_type: "unknown_product", body: { title: "知识专栏", description: "盐选小说" } },
  ];
  const data = objects.map(object => ({ type: "knowledge_ad", object }));
  data.push({ type: "search_result", object: { commodity_type: "paid_column_chapter" } });
  const body = { data };
  assert.deepEqual(clean(body, { url: "https://api.zhihu.com/search_v3" }), body);
});

test("search diagnostics reconstruct the complete original response before filtering", () => {
  const body = {
    data: [{ type: "search_result", object: {
      type: "album", is_purchased: false, title: "知识专栏",
      content: "中文😀\\\"\n".repeat(5000),
      author: { id: "account", name: "name" },
      arbitrary: { nested: { unknown_field: "full-value" } },
    } }],
    paging: { next: "/search_v3?offset=20", is_end: false },
  };
  const raw = JSON.stringify(body, null, 2);
  const logs = [];
  const url = "https://api.zhihu.com/search_v3?q=知识";
  const result = run(raw, { url, raw: true, logs, argument: { zhihu_debug: true } });
  assert.deepEqual(JSON.parse(result.body), { data: [], paging: body.paging });
  const meta = JSON.parse(logs.find(line => line.startsWith("ZHSEARCH-META ")).slice(14));
  const chunks = logs.filter(line => line.startsWith("ZHSEARCH-BODY "))
    .map(line => JSON.parse(line.slice(14)));
  assert.equal(meta.url, url);
  assert.equal(meta.length, raw.length);
  assert.equal(meta.parts, chunks.length);
  assert(chunks.length > 1);
  chunks.forEach((chunk, i) => {
    assert.equal(chunk.id, meta.id);
    assert.equal(chunk.part, i + 1);
    assert.equal(chunk.parts, meta.parts);
    assert(chunk.body.length <= 1200);
  });
  assert.equal(chunks.map(chunk => chunk.body).join(""), raw);
});

test("search diagnostics cover malformed responses and ads-only mode but skip unrelated or disabled requests", () => {
  for (const raw of ["", "not-json", '{"data":[]}']) {
    const logs = [];
    run(raw, { raw: true, logs, url: "https://api.zhihu.com/search_v3", argument: {
      zhihu_enable: true, zhihu_purify: false, zhihu_debug: true,
    } });
    const chunks = logs.filter(line => line.startsWith("ZHSEARCH-BODY "))
      .map(line => JSON.parse(line.slice(14)));
    assert.equal(chunks.map(chunk => chunk.body).join(""), raw);
    assert(chunks.length >= 1);
  }
  for (const options of [
    { url: "https://api.zhihu.com/topstory/recommend" },
    { url: "https://api.zhihu.com/search_v3", argument: { zhihu_enable: false, zhihu_purify: false } },
  ]) {
    const logs = [];
    run({ data: [] }, { ...options, logs });
    assert(!logs.some(line => line.startsWith("ZHSEARCH-")));
  }
});

test("search tabs hide video while retaining ordinary columns and other supported categories", () => {
  const body = { data: [
    { t: "general", name: "综合" }, { t: "zvideo", name: "视频" },
    { t: "people", name: "用户" }, { t: "column", name: "专栏" },
    { t: "pin", name: "想法" },
  ], other: "retained" };
  for (const filename of variants) {
    assert.deepEqual(rewrite(body, filename, "search\\/tabs"), {
      data: body.data.filter(item => item.t !== "zvideo"), other: "retained",
    }, filename);
    const rule = fs.readFileSync(path.join(__dirname, "..", filename), "utf8")
      .split("\n").find(line => line.startsWith("response if") && line.includes("search\\/tabs"));
    assert(rule.includes("${zhihu_purify} == true"), filename);
  }
});

test("profile membership card rule covers the current all endpoint and legacy versions without blocking account APIs", () => {
  for (const filename of variants) {
    const line = fs.readFileSync(path.join(__dirname, "..", filename), "utf8")
      .split("\n").find(line => line.includes("unlimited\\/go\\/my_card"));
    assert(line.includes('${zhihu_purify} == true'), filename);
    assert(line.endsWith('then reject_dict(200)'), filename);
    const expression = new RegExp(line.match(/~= \/(.*?)\/i then/)[1], "i");
    for (const endpoint of ["all", "all?scene=profile", "v2", "v12?scene=profile"]) {
      assert(expression.test(`https://api.zhihu.com/unlimited/go/my_card/${endpoint}`), filename);
    }
    for (const url of [
      "https://api.zhihu.com/people/self",
      "https://api.zhihu.com/market/people/self",
      "https://api.zhihu.com/settings/vip",
      "https://api.zhihu.com/unlimited/go/my_card/all_settings",
      "https://api.zhihu.com/unlimited/go/my_card/v2_settings",
      "https://api.zhihu.com.evil.test/unlimited/go/my_card/all",
    ]) assert(!expression.test(url), `${filename}: ${url}`);
  }
});

test("profile purification removes both membership entrance families and retains subscription status and account data", () => {
  const body = {
    name: "example", follower_count: 12,
    vip_info: { is_vip: false, vip_type: 0, entrance: {}, entrance_new: { right_button: { title: "开通盐选会员" } }, entrance_v2: { title: "开通盐选会员" } },
    kvip_info: { is_vip: true, expires_at: 123456, entrance: { title: "开通知识会员" }, entrance_v3: { button_text: "立即开通" } },
    other: { entrance: "ordinary account shortcut" },
  };
  const expected = {
    ...body, vip_info: { is_vip: false, vip_type: 0 }, kvip_info: { is_vip: true, expires_at: 123456 },
  };
  for (const filename of variants) {
    assert.deepEqual(rewrite(body, filename, "people\\/self"), expected, filename);
    for (const unchanged of [{}, { vip_info: null }, { kvip_info: { is_vip: false } }]) {
      assert.deepEqual(rewrite(unchanged, filename, "people\\/self"), unchanged, filename);
    }
  }
});

test("network rewrite explicitly disables HTTPDNS variants and retains unrelated configuration", () => {
  const entries = [
    { configKey: "tarsMixAb", status: true, configVersion: "20230510.16.22.20773", configValue: {
      whiteHosts: ["api.zhihu.com"], isDetectorClosed: 0, isBackupIPClosed: 0,
      isDowngradeClosed: 0, fetchIPsUrl: "http://192.0.2.1/v2/resolv",
    } },
    { configKey: "httpdns_new_config_tars", status: true, configValue: { whiteHosts: ["api.zhihu.com"] } },
    { configKey: "preFetchHttpDns", status: true, configValue: null },
    { configKey: "quicMixAB", status: true, configValue: {
      dnsParser: { httpdnsEnable: 1, localDnsEnable: 1, localDnsTTL: 60 },
    } },
    { configKey: "ordinary_feature", status: true, configValue: { HTTPDNS: { value: "retained" }, data: [1, 2] } },
  ];
  const body = { data: { configs: entries, other: "retained" } };
  for (const filename of variants) {
    const result = rewrite(body, filename, "cloud");
    assert.equal(result.data.configs.length, entries.length, filename);
    for (const item of result.data.configs.slice(0, 4)) {
      assert.equal(item.status, false, filename);
      assert.equal(item.configVersion, "20261024.03.30.00001", filename);
    }
    assert.deepEqual(result.data.configs[0].configValue, {
      ...entries[0].configValue, whiteHosts: [], isDetectorClosed: 1, isBackupIPClosed: 1,
    }, filename);
    assert.deepEqual(result.data.configs[3].configValue.dnsParser, {
      httpdnsEnable: 0, localDnsEnable: 1, localDnsTTL: 60,
    }, filename);
    assert.deepEqual(result.data.configs[4], entries[4], filename);
    assert.equal(result.data.other, body.data.other, filename);
  }
});

test("cloud config disables ad preload switches so a Loon-off window cannot prefetch creatives", () => {
  const entries = [
    { configKey: "ad_resource_preload", status: true, configVersion: "20261022.17.00.47422", configValue: null },
    { configKey: "check_preload_ad", status: true, configVersion: "20261022.17.00.47422", configValue: null },
    { configKey: "ad_optimize_Preload", status: true, configVersion: "20261022.17.00.47422", configValue: null },
    { configKey: "feed_prefetch", status: true, configVersion: "20261022.17.00.47422", configValue: 0 },
    { configKey: "ad_cache_clear", status: true, configVersion: "20261022.17.00.47422", configValue: null },
    { configKey: "preload_scene", status: true, configVersion: "20261022.17.00.47422", configValue: { recommend: true } },
  ];
  const body = { data: { configs: entries, etag: "W/keep" } };
  for (const filename of variants) {
    const result = rewrite(body, filename, "cloud");
    assert.equal(result.data.configs.length, entries.length, filename);
    for (const item of result.data.configs.slice(0, 4)) {
      assert.equal(item.status, false, `${filename}: ${item.configKey}`);
      assert.equal(item.configVersion, "20261024.03.30.00001", `${filename}: ${item.configKey}`);
    }
    // ad_cache_clear 是「清理行为」，关掉它等于放任缓存堆积，不能一起置 false
    assert.deepEqual(result.data.configs[4], entries[4], `${filename}: ad_cache_clear`);
    assert.deepEqual(result.data.configs[5], entries[5], `${filename}: preload_scene`);
    assert.equal(result.data.etag, "W/keep", filename);
  }
});

test("network rewrite disables new and legacy IP substitution without deleting core settings", () => {
  const value = {
    ZHSwitchHTTPDNSFunction_switchHTTPDNS: "1",
    ZHSwitchHTTPDNSFunction_switchHTTPDNSNew: { ratio: 1, whiteHosts: ["api.zhihu.com"] },
    ZHBackUpIP_Switch_Open: "1", LocalDNSSetHostWhiteList: ["www.zhihu.com"],
    ZHNSURLNSURLRequestTraceID: "1",
  };
  const body = { data: { configs: ["coreNetworkConf_useTars", "km_coreNetworkConf_useTars"].map((configKey) => ({
    configKey, status: true, configVersion: "20230613.10.23.17951", configValue: value,
  })) } };
  for (const filename of variants) {
    const result = rewrite(body, filename, "cloud");
    for (const item of result.data.configs) {
      assert.equal(item.status, true, filename);
      assert.notEqual(item.configVersion, body.data.configs[0].configVersion, filename);
      assert.equal(item.configValue.ZHSwitchHTTPDNSFunction_switchHTTPDNS, "0", filename);
      assert.equal(item.configValue.ZHBackUpIP_Switch_Open, "0", filename);
      assert.deepEqual(item.configValue.ZHSwitchHTTPDNSFunction_switchHTTPDNSNew, { ratio: 0, whiteHosts: [] }, filename);
      assert.deepEqual(item.configValue.LocalDNSSetHostWhiteList, [], filename);
      assert.equal(item.configValue.ZHNSURLNSURLRequestTraceID, "1", filename);
    }
    for (const other of [{}, { data: {} }, { data: { configs: null } }, { data: { configs: [null, {}, "unknown"] } }]) {
      assert.deepEqual(rewrite(other, filename, "cloud"), other, filename);
    }
  }
});

// 判据来源：本机 2026-11-04→11-09 日志的 answer/2064025651724514331（会员专享回答进推荐流）。
// 卡片两条路径都带 deliver_type=Paid：组件卡在 extra.business_ext_map，SDUI 项在 unify_content.biz_ext。
// 社区规则（哲也 / 知乎助手 / GY AdBlock）都没有用这个字段，判据由抓包确认，见 REFERENCE-CROSSCHECK-20261109.md。
test("deliver_type 判付费：组件卡与 SDUI 项同判，已购与免费回答保留", () => {
  const paidCard = { id: "paid", type: "ComponentCard", style: "card_padding_dynamic_GBK99A_V3",
    action: { type: "Route", parameter: "route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F1983323859353616532%2Fanswer%2F2064025651724514331" },
    extra: { business_ext_map: { contentType: "ANSWER", media_type: "IMAGE_TEXT", deliver_type: "Paid" } },
    children: [{ style: "text_recommend_title", text: "12 条内容让你眼界大开，不要错过哦" }] };
  const sduiPaid = { id: "sdui-paid", type: "sdui",
    unify_content: { content_info: { content_id: "791188065", content_token: "2064025651724514331", content_type: "ANSWER" },
      biz_ext: { deliver_type: "Paid" } } };
  const sduiNormal = { id: "sdui-normal", type: "sdui",
    unify_content: { content_info: { content_id: "803622137", content_type: "ANSWER" }, biz_ext: { deliver_type: "Normal" } } };
  // 知+ 商业推广：默认不删（观察项），但要进留证
  const sduiZplus = { id: "sdui-zplus", type: "sdui",
    unify_content: { content_info: { content_id: "2076627069597922472", content_type: "ANSWER" }, biz_ext: { deliver_type: "ZPlus" } } };
  const purchased = { id: "bought", type: "answer",
    extra: { business_ext_map: { deliver_type: "Paid" } },
    target: { type: "answer", id: 3, paid_info: { has_purchased: true } } };
  const free = { id: "free", type: "answer", target: { type: "answer", id: 4, is_free: true } };
  const body = { data: [paidCard, sduiPaid, sduiNormal, sduiZplus, purchased, free], paging: { is_end: false } };
  const url = "https://api.zhihu.com/topstory/recommend";
  const logs = [];
  assert.deepEqual(clean(body, { url, logs, argument: { zhihu_purify: true, zhihu_debug: true } }),
    { data: [sduiNormal, sduiZplus, purchased, free], paging: body.paging });

  const feed = JSON.parse(logs.find(line => line.startsWith("ZHFEED ")).slice(7));
  assert.deepEqual(feed.cards.map(card => [card.id, card.verdict]),
    [["paid", "dropped"], ["sdui-paid", "dropped"], ["sdui-normal", "kept"], ["sdui-zplus", "kept"],
      ["bought", "kept"], ["free", "kept"]]);
  // SDUI 项的 contentType / deliver 从 unify_content 读出，不再落成 null
  assert.deepEqual(feed.cards[2].biz, { contentType: "ANSWER", media: null, deliver: "Normal" });

  // 留证理由：留下的知+ 卡带 deliver:zplus，且不再误报 content_type:missing（contentType 从 SDUI 读出）
  const suspects = logs.filter(line => line.startsWith("ZHFEED-SUSPECT "))
    .map(line => JSON.parse(line.slice("ZHFEED-SUSPECT ".length)));
  const zplusReasons = suspects.find(item => item.id === "sdui-zplus").reasons;
  assert(zplusReasons.includes("deliver:zplus"));
  assert(!zplusReasons.includes("content_type:missing"));
});

// 来源：哲也 zheye.min.js isFiltered（`"market_card"===e.type`、`"SvipActivity"===e.extra?.type`）。
// 本机日志里 feed_advert 卡已被 AD_TYPES 覆盖，market_card 与 SvipActivity 在旧判据下漏放。
test("下划线命名的 market_card 与会员活动卡按类型整条删除", () => {
  const body = { data: [
    { id: "m", type: "market_card", target: { id: 9 } },
    { id: "s", type: "answer", extra: { type: "SvipActivity" }, target: { type: "answer", id: 5 } },
    { id: "keep", type: "answer", target: { type: "answer", id: 6 } },
  ] };
  const url = "https://api.zhihu.com/topstory/recommend";
  assert.deepEqual(clean(body, { url, argument: { zhihu_purify: true } }),
    { data: [{ id: "keep", type: "answer", target: { type: "answer", id: 6 } }] });
  // 关闭去广告时只做会员净化，不删这两类卡
  assert.deepEqual(clean(body, { url, argument: { zhihu_enable: false, zhihu_purify: true } }), body);
});

// 来源：哲也 zheye.lnplugin `URL-REGEX,^https://api.zhihu.com/guide_center/strategy,REJECT`
// （注释「屏蔽 - 付费回答用户营销引导」）。本仓库按 scenes 收窄，避免关掉评论列表/个人页的功能引导。
test("会员引导接口只拦详情页 scenes，其余引导放行", () => {
  for (const filename of variants) {
    const lines = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").split("\n");
    const rule = lines.find(line => line.includes("guide_center") && line.includes("response.json.jq("));
    assert(rule, filename);
    const expression = new RegExp(rule.match(/~= \/(.*?)\/i then/)[1], "i");
    const detail = "https://api.zhihu.com/guide_center/strategy?content_id=2064025651724514331&content_type=answer&launch_id=1794191035719&scenes=answer_detail_page&source=recommend";
    assert(expression.test(detail), filename);
    assert(expression.test("https://api.zhihu.com/guide_center/strategy?scenes=article_detail_page"), filename);
    assert(expression.test("https://api.zhihu.com/guide_center/strategy?scenes=pin_detail_page"), filename);
    assert(!expression.test("https://api.zhihu.com/guide_center/strategy?scenes=comment_list_page"), filename);
    assert(!expression.test("https://api.zhihu.com/guide_center/strategy"), filename);
    const program = JSON.parse(rule.slice(rule.indexOf("response.json.jq(") + 17, -1));
    const result = spawnSync("jq", ["-c", program], { input: JSON.stringify({ data: [{ id: 1 }], strategy: {} }), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
  }
});
