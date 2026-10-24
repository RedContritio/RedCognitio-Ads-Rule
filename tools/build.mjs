import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { minify } from "terser";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const metadataPath = "build/build.json";
const repository = "RedContritio/RedCognitio-Ads-Rule";
const mirrors = [
  { suffix: "", label: "", base: `https://raw.githubusercontent.com/${repository}/refs/heads/main` },
  { suffix: "-ghproxy", label: "ghproxy 镜像", base: `https://gh-proxy.com/https://raw.githubusercontent.com/${repository}/refs/heads/main` },
  { suffix: "-jsdelivr", label: "jsDelivr 镜像", base: `https://cdn.jsdelivr.net/gh/${repository}@main` },
];
const commonScripts = ["zhihu-clean.js", "Taobao-ads-clean.js", "zhihu-ad-preload.js"];

export function validateMetadata(metadata) {
  if (typeof metadata.version !== "string" || !/^1\.0\.(0|[1-9]\d*)$/.test(metadata.version)) {
    throw new Error("合集版本格式为 1.0.N，第三位为构建号");
  }
  if (!Number.isSafeInteger(Number(metadata.version.split(".")[2]))) throw new Error("构建号超出整数范围");
  if ("build" in metadata) throw new Error("构建号使用版本第三位");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) throw new Error("构建日期须为 YYYY-MM-DD");
}

export async function generateArtifacts(metadata, sourceRoot = root) {
  validateMetadata(metadata);
  const template = fs.readFileSync(path.join(sourceRoot, "build/RedCognitio-Ads.plugin.tpl"), "utf8");
  const artifacts = new Map();
  for (const mode of ["release", "debug"]) {
    const debug = mode === "debug";
    const scripts = debug ? [...commonScripts, "netease-debug.js"] : commonScripts;
    for (const filename of scripts) {
      const source = fs.readFileSync(path.join(sourceRoot, "scripts", filename), "utf8");
      const { code } = await minify(source, {
        ecma: 2020,
        mangle: false,
        compress: { global_defs: { __DEBUG__: debug }, passes: 3, toplevel: true, drop_console: !debug },
        format: { beautify: true, comments: /SPDX-License-Identifier/ },
      });
      if (!debug && /console\s*\.|\bdebug\b|\w+_debug|ZHCLEAN|ZHSEARCH|TBCLEAN|NCMDEBUG|logSearchResponse/.test(code)) {
        throw new Error(`Release 脚本含调试代码：${filename}`);
      }
      artifacts.set(`dist/${mode}/scripts/${filename}`, code.replace(/[ \t]+$/gm, "") + "\n");
    }
    for (const mirror of mirrors) {
      const labels = [debug ? "Debug" : "", mirror.label].filter(Boolean);
      const values = {
        ...metadata,
        name_suffix: labels.length ? `（${labels.join(" · ")}）` : "",
        mode: debug ? "Debug" : "Release",
        mirror_desc: mirror.label ? `；${mirror.label}` : "",
        scripts: `${mirror.base}/dist/${mode}/scripts`,
      };
      let plugin = template;
      if (!debug) {
        plugin = plugin.split("\n").filter(line =>
          !/^\w+_debug = /.test(line) && !line.includes("netease-debug.js")
        ).join("\n");
        plugin = plugin.replaceAll(", ${zhihu_debug}", "").replaceAll(", {${taobao_debug}}", "");
      }
      plugin = plugin.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in values)) throw new Error(`未知模板变量：${key}`);
        return values[key];
      });
      if (plugin.includes("{{")) throw new Error("模板变量尚未替换");
      if (!debug && /_debug|netease-debug/.test(plugin)) throw new Error("Release 插件含调试配置");
      artifacts.set(`RedCognitio-Ads${debug ? "-debug" : ""}${mirror.suffix}.plugin`, plugin);
    }
  }
  return artifacts;
}

export function checkArtifacts(artifacts, outputRoot = root) {
  const mismatches = [];
  for (const [filename, content] of artifacts) {
    const target = path.join(outputRoot, filename);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) mismatches.push(filename);
  }
  for (const mode of ["debug", "release"]) {
    const directory = `dist/${mode}/scripts`;
    if (!fs.existsSync(path.join(outputRoot, directory))) continue;
    for (const filename of fs.readdirSync(path.join(outputRoot, directory))) {
      const relative = `${directory}/${filename}`;
      if (!artifacts.has(relative)) mismatches.push(relative);
    }
  }
  if (mismatches.length) throw new Error("构建产物需要更新：\n" + mismatches.join("\n"));
}

export function writeArtifacts(artifacts, outputRoot = root) {
  for (const [filename, content] of artifacts) {
    const target = path.join(outputRoot, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  for (const mode of ["debug", "release"]) {
    const directory = `dist/${mode}/scripts`;
    for (const filename of fs.readdirSync(path.join(outputRoot, directory))) {
      if (!artifacts.has(`${directory}/${filename}`)) fs.unlinkSync(path.join(outputRoot, directory, filename));
    }
  }
}

export async function buildProject({ projectRoot = root, check = false, increment = true, now = new Date() } = {}) {
  const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, metadataPath), "utf8"));
  validateMetadata(metadata);
  if (!check && increment) {
    metadata.version = `1.0.${Number(metadata.version.split(".")[2]) + 1}`;
    metadata.date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
  }
  const artifacts = await generateArtifacts(metadata, projectRoot);
  if (check) {
    checkArtifacts(artifacts, projectRoot);
  } else {
    writeArtifacts(artifacts, projectRoot);
    fs.writeFileSync(path.join(projectRoot, metadataPath), JSON.stringify(metadata, null, 2) + "\n");
  }
  return { metadata, artifacts };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !["--check", "--no-increment"].includes(arg))) {
    throw new Error("用法：node tools/build.mjs [--check | --no-increment]");
  }
  const { metadata, artifacts } = await buildProject({ check: args[0] === "--check", increment: args.length === 0 });
  console.log(`${metadata.version}：` + (args[0] === "--check"
    ? "构建产物一致"
    : `已生成 Release / Debug 及三种下载源，共 ${artifacts.size} 个文件`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
