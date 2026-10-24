const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const builder = import("../tools/build.mjs");
const metadata = JSON.parse(fs.readFileSync(path.join(root, "build/build.json"), "utf8"));

function run(filename, argument, url, body) {
  let result;
  const logs = [];
  const request = { url, method: "GET", headers: {} };
  const response = { body, headers: {}, status: 200 };
  const snapshot = JSON.stringify([request, response]);
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), "utf8"), {
    $argument: argument, $request: request, $response: response,
    $done(value) { assert.equal(result, undefined); result = value; },
    console: { log: (...args) => logs.push(args.join(" ")) },
  });
  assert.equal(JSON.stringify([request, response]), snapshot);
  return { result: JSON.parse(JSON.stringify(result)), logs };
}

test("committed artifacts reproduce exactly with a shared version and build number", async () => {
  const { generateArtifacts, checkArtifacts } = await builder;
  const artifacts = await generateArtifacts(metadata);
  assert.equal(artifacts.size, 13);
  checkArtifacts(artifacts);
  for (const [filename, content] of artifacts) {
    if (!filename.endsWith(".plugin")) continue;
    const debug = filename.includes("-debug");
    assert(content.includes("#!version=1.0.0\n"), filename);
    assert(content.includes(`#!build=${metadata.build}\n`), filename);
    assert.equal((content.match(/^\w+ = switch,/gm) || []).length, debug ? 7 : 4, filename);
    assert.equal((content.match(/^\w+_debug = switch,false,/gm) || []).length, debug ? 3 : 0, filename);
    const scripts = [...content.matchAll(/then script\("([^"]+)"/g)].map(match => match[1]);
    assert.equal(scripts.length, debug ? 5 : 4, filename);
    for (const url of scripts) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("build"), String(metadata.build), filename);
      const resource = parsed.pathname.match(/dist\/(debug|release)\/scripts\/[^/]+$/)[0];
      assert.equal(resource.split("/")[1], debug ? "debug" : "release");
      assert(artifacts.has(resource), `${filename}: ${url}`);
      if (filename.includes("ghproxy")) assert(url.startsWith("https://gh-proxy.com/"));
      else if (filename.includes("jsdelivr")) assert(url.startsWith("https://cdn.jsdelivr.net/"));
      else assert(url.startsWith("https://raw.githubusercontent.com/"));
    }
  }
});

test("Release strips debug code and stays silent even with every debug argument enabled", () => {
  const argument = { zhihu_debug: true, taobao_debug: true, netease_debug: true };
  const cases = [
    ["zhihu-clean.js", "https://api.zhihu.com/search_v3", '{"data":[{"type":"feed_advert"}]}'],
    ["Taobao-ads-clean.js", "https://poplayer.template.alibaba.com/test.json", '{"enable":true}'],
    ["zhihu-ad-preload.js", "http://192.0.2.1/", ""],
  ];
  assert.deepEqual(fs.readdirSync(path.join(root, "dist/release/scripts")).sort(), cases.map(item => item[0]).sort());
  for (const [script, url, body] of cases) {
    const filename = `dist/release/scripts/${script}`;
    const source = fs.readFileSync(path.join(root, filename), "utf8");
    assert(!/console\s*\.|\bdebug\b|\w+_debug|ZHCLEAN|ZHSEARCH|TBCLEAN|NCMDEBUG|logSearchResponse|__DEBUG__/.test(source));
    for (const raw of [body, "not-json", ""]) assert.deepEqual(run(filename, argument, url, raw).logs, []);
  }
});

test("compiled Zhihu builds match source filtering for every feature switch combination", () => {
  const free = { type: "answer", id: "free", question: { id: "question" }, content: "正文", images: ["image.jpg"] };
  const locked = { type: "answer", id: "locked", paid_info: { has_purchased: false } };
  const courses = { type: "knowledge_ad", object: { commodity_type: "album_paid_column", card_type: "knowledge_vip" } };
  const paging = { next: "/next?page=2", is_end: false, totals: 20 };
  const cases = [
    ["topstory/recommend", { data: [free, locked, { type: "feed_advert" }, { type: "zvideo" }], dataV1: [free, { type: "zvideo" }], paging }],
    ["next-render?type=answer&scenes=question", { data: [free, locked, { type: "ad", adjson: "{}" }], paging }],
    ["v4/questions/123/answers", { data: [free, locked], paging }],
    ["search_v3?q=小说", { data: [courses, { type: "search_result", object: free }], pendant: {}, paging }],
    ["answers/v2/123", { ...free, ad_info: {}, third_business: {}, ring_info: {}, structured_content: { segments: [{ type: "image", src: "image.jpg" }, { type: "card" }] } }],
  ];
  for (const zhihu_enable of [true, false]) {
    for (const zhihu_purify of [true, false]) {
      const argument = { zhihu_enable, zhihu_purify, zhihu_debug: true };
      for (const [endpoint, body] of cases) {
        const url = "https://api.zhihu.com/" + endpoint;
        for (const raw of [JSON.stringify(body), "not-json", "null", ""]) {
          const expected = run("scripts/zhihu-clean.js", argument, url, raw).result;
          for (const mode of ["debug", "release"]) {
            const result = run(`dist/${mode}/scripts/zhihu-clean.js`, argument, url, raw);
            assert.deepEqual(result.result, expected, `${mode}: ${endpoint}`);
            assert.equal(result.logs.length > 0, mode === "debug");
          }
        }
      }
    }
  }
});

test("compiled Debug retains full search diagnostics and independent default-off switches", () => {
  const body = JSON.stringify({ data: [], arbitrary: "完整响应😀".repeat(2000) });
  const cases = [
    ["zhihu-clean.js", "zhihu_debug", "https://api.zhihu.com/search_v3", body],
    ["Taobao-ads-clean.js", "taobao_debug", "https://poplayer.template.alibaba.com/test.json", '{"enable":true}'],
    ["netease-debug.js", "netease_debug", "https://music.163.com/eapi/batch", ""],
  ];
  for (const [script, flag, url, raw] of cases) {
    const filename = `dist/debug/scripts/${script}`;
    const otherFlags = Object.fromEntries(["zhihu_debug", "taobao_debug", "netease_debug"].filter(key => key !== flag).map(key => [key, true]));
    for (const argument of [undefined, { [flag]: false }, otherFlags]) {
      assert.deepEqual(run(filename, argument, url, raw).logs, []);
    }
    for (const argument of [{ [flag]: true }, JSON.stringify({ [flag]: true })]) {
      const on = run(filename, argument, url, raw);
      assert(on.logs.length > 0, script);
      if (flag === "zhihu_debug") {
        const chunks = on.logs.filter(line => line.startsWith("ZHSEARCH-BODY ")).map(line => JSON.parse(line.slice(14)));
        assert.equal(chunks.map(chunk => chunk.body).join(""), body);
      }
    }
  }
});

test("compiled Taobao and preload behavior match source in both builds", () => {
  const cases = [
    ["Taobao-ads-clean.js", "https://guide-acs.m.taobao.com/gw/mtop.taobao.wireless.home.splash.awesome.get", {
      data: { containers: { splash_home_base: { base: { sections: [{ bizData: { "taobao-splash": { data: [{ imgUrl: "ad.jpg", videoUrl: "ad.mp4" }] } } }] } } } },
    }],
    ["Taobao-ads-clean.js", "https://guide-acs.m.taobao.com/gw/mtop.taobao.cloudvideo.video.query", { data: { duration: "10", resources: ["ad"], caches: ["ad"] } }],
    ["Taobao-ads-clean.js", "https://poplayer.template.alibaba.com/test.json", { enable: true, res: { images: ["ad"], videos: ["ad"] }, mainRes: { images: ["ad"] } }],
    ["zhihu-ad-preload.js", "http://192.0.2.1/", {}],
  ];
  for (const [script, url, body] of cases) {
    for (const raw of [JSON.stringify(body), "{}", "null", "not-json", ""]) {
      const argument = { taobao_debug: true };
      const expected = run(`scripts/${script}`, argument, url, raw).result;
      for (const mode of ["debug", "release"]) {
        assert.deepEqual(run(`dist/${mode}/scripts/${script}`, argument, url, raw).result, expected);
      }
    }
  }
});

test("both build modes preserve all native rules and business script conditions", () => {
  function rules(source) {
    return source.split("\n").filter(line => !/^#!|^\w+_debug = |netease-debug\.js/.test(line))
      .map(line => line.replaceAll(", ${zhihu_debug}", "").replaceAll(", {${taobao_debug}}", "")
        .replace(/https:[^"]+\/dist\/(release|debug)\/scripts\//g, "scripts/"))
      .join("\n").trim();
  }
  const expected = rules(fs.readFileSync(path.join(root, "RedCognitio-Ads.plugin"), "utf8"));
  for (const filename of fs.readdirSync(root).filter(name => /^RedCognitio-Ads.*\.plugin$/.test(name))) {
    assert.equal(rules(fs.readFileSync(path.join(root, filename), "utf8")), expected, filename);
  }
});

test("build increments only the build number and supports checks and reproducible rebuilding", async t => {
  const { buildProject, metadataPath, checkArtifacts, writeArtifacts } = await builder;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-ads-build-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.cpSync(path.join(root, "build"), path.join(projectRoot, "build"), { recursive: true });
  fs.cpSync(path.join(root, "scripts"), path.join(projectRoot, "scripts"), { recursive: true });
  const now = new Date("2026-10-24T16:00:00Z");
  const built = await buildProject({ projectRoot, now });
  assert.deepEqual(built.metadata, { version: "1.0.0", build: metadata.build + 1, date: "2026-10-25" });
  const snapshot = fs.readFileSync(path.join(projectRoot, metadataPath), "utf8");
  assert.deepEqual((await buildProject({ projectRoot, increment: false })).artifacts, built.artifacts);
  assert.deepEqual((await buildProject({ projectRoot, check: true })).metadata, built.metadata);
  assert.equal(fs.readFileSync(path.join(projectRoot, metadataPath), "utf8"), snapshot);
  for (const [filename, content] of built.artifacts) {
    if (filename.endsWith(".plugin")) assert(content.includes(`?build=${metadata.build + 1}`));
  }
  const release = path.join(projectRoot, "dist/release/scripts/zhihu-clean.js");
  fs.appendFileSync(release, "changed");
  await assert.rejects(buildProject({ projectRoot, check: true }), /zhihu-clean/);
  assert.equal(fs.readFileSync(path.join(projectRoot, metadataPath), "utf8"), snapshot);
  fs.writeFileSync(path.join(projectRoot, "dist/release/scripts/obsolete.js"), "obsolete");
  assert.throws(() => checkArtifacts(built.artifacts, projectRoot), /obsolete/);
  writeArtifacts(built.artifacts, projectRoot);
  checkArtifacts(built.artifacts, projectRoot);
  assert(!fs.existsSync(path.join(projectRoot, "dist/release/scripts/obsolete.js")));
});

test("build rejects version changes and invalid build numbers before writing artifacts", async t => {
  const { buildProject, generateArtifacts, metadataPath } = await builder;
  for (const build of [-1, 0, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(generateArtifacts({ ...metadata, build }), /构建号/);
  }
  await assert.rejects(generateArtifacts({ ...metadata, version: "1.1.0" }), /固定/);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-ads-version-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, "build"));
  const changed = JSON.stringify({ ...metadata, version: "1.1.0" });
  fs.writeFileSync(path.join(projectRoot, metadataPath), changed);
  await assert.rejects(buildProject({ projectRoot }), /固定/);
  assert.equal(fs.readFileSync(path.join(projectRoot, metadataPath), "utf8"), changed);
  assert(!fs.existsSync(path.join(projectRoot, "dist")));
});
