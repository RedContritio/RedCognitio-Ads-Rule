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
  "RedCognitio-Ads-jsdelivr.plugin", "Zhihu-URL.module",
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

test("all plugin variants route answer and recommendation bodies to both script switches", () => {
  for (const filename of [
    "RedCognitio-Ads.plugin", "RedCognitio-Ads-ghproxy.plugin",
    "RedCognitio-Ads-jsdelivr.plugin", "Zhihu-URL.module",
  ]) {
    const lines = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").split("\n");
    const script = lines.find((line) => line.includes("zhihu-clean.js") && line.startsWith("response if"));
    assert(script.includes('(${zhihu_enable} == true || ${zhihu_purify} == true)'), filename);
    assert(script.includes('{${zhihu_enable}, ${zhihu_purify}, ${zhihu_debug}}'), filename);
    const expression = new RegExp(script.match(/~= \/(.*?)\/i then/)[1], "i");
    const urls = [
      "https://api.zhihu.com/next-render?type=answer&id=first",
      "https://api.zhihu.com/simple-next-render?type=answer&id=first",
      "https://api.zhihu.com/topstory/recommend",
      "https://api.zhihu.com/questions/123/feeds",
      "https://api.zhihu.com/v4/questions/123/answers",
      "https://www.zhihu.com/api/v4/questions/123/answers",
      "https://api.zhihu.com/answers/v2/123",
      "https://api.zhihu.com/search_v3?t=general",
    ];
    for (const url of urls) {
      assert(expression.test(url), `${filename}: ${url}`);
      for (const line of lines.filter((line) => line.startsWith("response if") && line.includes("response.json."))) {
        const match = line.match(/~= \/(.*?)\/i then/);
        if (match) assert(!new RegExp(match[1], "i").test(url), `${filename}: body rewrite suppresses script for ${url}`);
      }
    }
    assert.deepEqual(rewrite(answerFlow, filename, "next-render"), cleanAnswerFlow, filename);
  }
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

test("plugin switches are declared, shared by transport and isolated for ads and interface rules", () => {
  for (const filename of variants) {
    const lines = fs.readFileSync(path.join(__dirname, "..", filename), "utf8").split("\n");
    assert(lines.some(line => line.startsWith("zhihu_enable = switch,true,type=boolean,")), filename);
    assert(lines.some(line => line.startsWith("zhihu_purify = switch,true,type=boolean,")), filename);
    const commercial = lines.find(line => line.startsWith("request if") && line.includes("commercial_api"));
    assert(commercial.includes("${zhihu_enable} == true"), filename);
    assert(!commercial.includes("zhihu_purify"), filename);
    const tabs = lines.find(line => line.startsWith("response if") && line.includes("root\\/tab"));
    assert(tabs.includes("${zhihu_purify} == true"), filename);
    assert(!tabs.includes("zhihu_enable"), filename);
    const cloud = lines.find(line => line.startsWith("response if") && line.includes("cloud\\/zhihu"));
    assert(cloud.includes("(${zhihu_enable} == true || ${zhihu_purify} == true)"), filename);
    const preload = lines.find(line => line.startsWith("request if") && line.includes("zhihu-ad-preload.js"));
    assert(preload.includes("enable=${zhihu_enable}"), filename);
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
