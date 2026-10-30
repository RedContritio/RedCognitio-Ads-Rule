# RedCognitio 去广告合集

合集版本格式为 **1.0.N**，第三位为构建号，按 `1.0.0 → 1.0.1 → 1.0.2` 递增。

Loon 3.5.1（983）及以上版本插件，按应用开关：**知乎 / 淘宝 / 网易云音乐 / 哔咔 / 高德 / missav / JAV 站族 / 多邻国**。

## 安装

在 Loon → 配置 → 插件 → 添加，选择一种构建安装。gh-proxy 地址：

| 构建 | 安装地址 | 设置 |
|---|---|---|
| Release | [RedCognitio-Ads-ghproxy.plugin](https://gh-proxy.com/https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/refs/heads/main/RedCognitio-Ads-ghproxy.plugin) | 九个功能开关，脚本仅保留过滤逻辑 |
| Debug | [RedCognitio-Ads-debug-ghproxy.plugin](https://gh-proxy.com/https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/refs/heads/main/RedCognitio-Ads-debug-ghproxy.plugin) | 九个功能开关、八个默认关闭的调试开关 |

直连使用同名去掉 `-ghproxy` 的文件；jsDelivr 使用 `-jsdelivr.plugin` 文件。两种构建择一启用。

## 设置页

Release 提供前九项；Debug 提供全部十七项：

| 开关 | 默认 | 作用 |
|---|---|---|
| 知乎-去广告 | 开 | 广告接口、回答流广告、首页推广 |
| 知乎-净化 | 开 | 隐藏首页视频与搜索视频栏、仅看当前问题、过滤会员及付费受限内容、隐藏会员开通入口 |
| 淘宝-去广告 | 开 | 淘宝开屏、TopShow、poplayer 弹层、HEIC 开屏兜底 |
| 网易云音乐-去广告 | 开 | 网易云广告接口、开屏、素材 CDN |
| 哔咔-去广告 | 开 | 哔咔广告服务器（iOS 原生与 PicaWeb 共用）、PicaWeb 注入与阅读器广告页跳过 |
| 高德地图-去广告 | 开 | 改写阿里妈妈开屏下发与实时「秒开」两条接口的响应，并清空本地素材池 |
| missav-去广告 | 开 | 拆掉 smartpop / popunder 弹窗、页面广告位与「更多好站」联盟推广位 |
| JAV 站族-去广告 | 开 | 按广告网络清掉 18AV / 123AV / JavBus 这类站的第三方广告 iframe、广告 SDK 与广告位占位 |
| 多邻国-去广告 | 关 | 改写首方用户数据的订阅档位，插屏（含 Super 推广）不再下发；改的是账号状态，先用小号验证 |
| 知乎-调试 | 关 | `ZHCLEAN` 过滤计数、解析错误，`ZHSEARCH-*` 完整搜索响应 |
| 淘宝-调试 | 关 | `TBCLEAN` 响应净化结果、JSON 解析错误 |
| 网易云音乐-调试 | 关 | `NCMDEBUG` 进入脚本的 API 请求方法与 URL |
| 哔咔-调试 | 关 | `PICA-CLEAN-*` 注入命中与跳过注入的原因 |
| 高德地图-调试 | 关 | `AMDEBUG` 开屏接口真实主机名，`AMDUMP-*` 完整响应 |
| missav-调试 | 关 | `MISSAV-CLEAN` 各项命中数（htmlAds / iframe / 联盟位 / pop()）与体积变化 |
| JAV 站族-调试 | 关 | `JAVCLEAN` 各站 iframe / 脚本 / 广告位命中数与体积变化 |
| 多邻国-调试 | 关 | `DUOLINGO-CLEAN` 命中的响应形态与改写结果；`DUODUMP` 输出候选键名（不含值） |

去广告与净化开关控制对应的 Rewrite / Script；知乎响应脚本与网络配置改写由去广告或净化启用。**域名与 QUIC 规则常驻**——哔咔的开关只控制 PicaWeb 注入，iOS 原生客户端不解析 HTML，靠域名规则即可；高德只有两条接口、没有可常驻的广告域，开关直接管住这两条；missav 的开关控制 HTML 注入与 `/pop` 拦截，广告域兜底常驻；JAV 站族的开关只控制注入，广告网络域名常驻；多邻国**没有可常驻的广告域**，插屏放不放由账号档位决定，开关直接管住那条响应改写脚本，默认关闭。完全停用需关闭插件。

Debug 按 App 独立控制脚本日志。知乎、淘宝、missav、JAV 站族在对应净化脚本运行时输出；网易云、高德按需启用请求 / 响应记录脚本。原生规则的拦截记录在 Loon 请求记录中查看。独立路径模块也提供对应调试开关。

维护清单：[知乎](Zhihu.md)、[淘宝](Taobao.md)、[网易云音乐](NetEase-CloudMusic.md)、[闲鱼](Xianyu.md)、[哔咔](Pica.md)、[高德](Amap.md)、[missav](MissAV.md)、[JAV 站族](JAV.md)、[多邻国](Duolingo.md)。

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
| 哔咔漫画 | `Pica-URL.module`、`Pica-Domain.module` | [Pica.md](Pica.md) |

高德只有两条开屏接口、没有能常驻的广告域，规则与开关都并在合集里，不单独拆模块。missav 与 JAV 站族同理：广告既在服务端直出的 HTML 里，也在内联脚本与播放器事件里，纯域名模块只会留下白块和弹窗，规则都并在合集里。多邻国也不拆：它要动的是账号档位那条响应，域名级规则对它无效（同域下发）。

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
