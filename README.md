# RedCognitio 去广告合集

合集版本格式为 **1.0.N**，第三位为构建号，按 `1.0.0 → 1.0.1 → 1.0.2` 递增。

Loon 3.5.1（983）及以上版本插件，按应用开关：**知乎 / 淘宝 / 网易云音乐**。

## 安装

在 Loon → 配置 → 插件 → 添加，选择一种构建安装。gh-proxy 地址：

| 构建 | 安装地址 | 设置 |
|---|---|---|
| Release | [RedCognitio-Ads-ghproxy.plugin](https://gh-proxy.com/https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/refs/heads/main/RedCognitio-Ads-ghproxy.plugin) | 四个功能开关，脚本仅保留过滤逻辑 |
| Debug | [RedCognitio-Ads-debug-ghproxy.plugin](https://gh-proxy.com/https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/refs/heads/main/RedCognitio-Ads-debug-ghproxy.plugin) | 四个功能开关、三个默认关闭的调试开关 |

直连使用同名去掉 `-ghproxy` 的文件；jsDelivr 使用 `-jsdelivr.plugin` 文件。两种构建择一启用。

## 设置页

Release 提供前四项；Debug 提供全部七项：

| 开关 | 默认 | 作用 |
|---|---|---|
| 知乎-去广告 | 开 | 广告接口、回答流广告、首页推广 |
| 知乎-净化 | 开 | 隐藏首页视频与搜索视频栏、仅看当前问题、过滤会员及付费受限内容、隐藏会员开通入口 |
| 淘宝-去广告 | 开 | 淘宝开屏、TopShow、poplayer 弹层、HEIC 开屏兜底 |
| 网易云音乐-去广告 | 开 | 网易云广告接口、开屏、素材 CDN |
| 知乎-调试 | 关 | `ZHCLEAN` 过滤计数、解析错误，`ZHSEARCH-*` 完整搜索响应 |
| 淘宝-调试 | 关 | `TBCLEAN` 响应净化结果、JSON 解析错误 |
| 网易云音乐-调试 | 关 | `NCMDEBUG` 进入脚本的 API 请求方法与 URL |

去广告与净化开关控制对应的 Rewrite / Script；知乎响应脚本与网络配置改写由去广告或净化启用。**域名与 QUIC 规则常驻**；完全停用需关闭插件。

Debug 按 App 独立控制脚本日志。知乎、淘宝在对应净化脚本运行时输出；网易云按需启用请求记录脚本。原生规则的拦截记录在 Loon 请求记录中查看。独立路径模块也提供对应调试开关。

知乎规则目标、来源与验证状态见 [维护清单](Zhihu.md)。

## 说明

- 需要开启 MITM 并信任 Loon CA；插件已带 hostname。
- 合集与独立 `.module` 模块择一启用。

## 独立模块

合集之外按应用提供独立模块，规则与合集同步维护；不再列出的即未拆分。

| 应用 | 模块 | 维护文档 |
|---|---|---|
| 知乎 | `Zhihu-URL.module`、`Zhihu-Domain.module`、`Zhihu-Dump*.module` | [Zhihu.md](Zhihu.md) |
| 淘宝 | `Taobao-URL.module` | [Taobao.md](Taobao.md) |
| 网易云音乐 | `NetEase-CloudMusic-URL.module`、`NetEase-CloudMusic-Domain.module` | [NetEase-CloudMusic.md](NetEase-CloudMusic.md) |
| 闲鱼 | `Xianyu-URL.module`、`Xianyu-Domain.module`、`Xianyu-Dump.module`（诊断） | [Xianyu.md](Xianyu.md) |

## 构建

Node.js 20+；规则测试使用 `jq`。

```sh
npm ci
npm run build
npm test
npm run build:check
```

- 修改 `build/RedCognitio-Ads.plugin.tpl` 和 `scripts/` 源码。
- `npm run build` 自动递增 `build/build.json` 中版本号的第三位，生成两种构建及三种下载源；脚本产物位于 `dist/release/`、`dist/debug/`。
- `npm run build -- --no-increment` 按当前构建号重建；`npm run build:check` 只校验产物一致性。
- Release 构建移除调试开关、调试路由及日志代码。提交模板、源码、构建信息和生成产物，保持在线安装地址同步。
