# 哔咔漫画 去广告

维护文档。目标端两个，共用一台自建广告服务器：

- **iOS 原生客户端** `com.picacomic.picacg.picacg` 2.5.85（Flutter，官网自签 IPA）
- **PicaWeb** `manhuabika.com`（哔咔官网的网页版入口，加主屏当 PWA 用）

Android 客户端 `com.picacomic.fregata` 作为旁证：同一套广告体系的早期形态。

配套模块：`Pica-URL.module`（注入层，需 MITM）、`Pica-Domain.module`（纯域名，无需 MITM）。
配套脚本：`scripts/pica-clean.js`。

## 0. 一句话结论

哔咔的广告不来自任何三方 SDK，iOS 与网页版都从自建广告服务器 `pica-ad-api.diwodiwo.xyz` 取。

- **iOS 原生端**：广告是 Dart 侧的 widget（弹窗、阅读器、详情页 WebView），域名规则封掉服务器后就没有素材可渲染。
- **PicaWeb**：广告位是网页里的固定容器，而且**阅读器那页全屏广告是本地分页算出来的**（每 21 页插一页），只封接口会在书里留一个空页——必须再加一次 HTML 注入，让阅读器自己翻过去。

## 1. 样本与取证

| 项目 | 值 |
|---|---|
| Android 样本 | `com.picacomic.fregata` 2.2.1.3.3.4，官方直链 `https://www.picacomic.com/apps/picacomic-v2.2.1.3.3.4.apk` |
| 体积 / SHA-256 | 13 MB / `64e86716d6ab49271201dfe9c9fe9a8d7be8ac97a8c641eb712f987c5945d26b` |
| 结构 | 单 dex（4.1 MB）+ `libJniTest.so`（签名用），无任何三方广告 SDK 原生库 |
| 反编译 | apktool 3.0.3、jadx 1.5.6 |
| iOS 样本 | `com.picacomic.picacg.picacg` 2.5.85，自签 IPA 16 MB，`https://manhuabika.com/down/ipa/PicACG-v2.5.85-unsigned.ipa`，SHA-256 `88cea75c8b171c69e12894c82dea0eb6c084a873b383e26ed6406164a2dbe2af` |
| iOS 结构 | Flutter：`Runner.app` + `App.framework/App`（10.9 MB AOT，5.1 万条字符串）；frameworks 里只有 Firebase / inappwebview / video_player 等，**没有任何三方广告 SDK** |
| Web 端 | 线上 bundle：`index-ea_4Germ.js`、`feature-comics-CkieQqfF.js`、`shared-core-D9Sg6H3u.js`（2026-10-29 拉取） |

线上接口探测（本机 DNS 被解析到 `198.18.x.x` 假地址，必须用 DoH 解析出的真实 IP）：

```sh
dig +short @1.1.1.1 pica-ad-api.diwodiwo.xyz A        # 104.18.28.70 / 104.18.29.70
curl -sS --resolve pica-ad-api.diwodiwo.xyz:443:104.18.28.70 \
  "https://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=zone_8,zone_24,zone_11"
```

返回（2026-10-29，节选）：

```json
{"code":200,"data":{"zones":[
  {"id":"zone_8","name":"front_2b_3a","remark":"彈出2b_3a, JGG",
   "ad":{"image":"https://pica-ad-api.diwodiwo.xyz/medias/e447e1bc-….gif",
         "title":"點廣告, 救嗶咔",
         "link":"https://pica-ad-api.diwodiwo.xyz/redirect/zone_8",
         "rawLink":"https://a.tp-lp3.org/?attributionId=13"}},
  {"id":"zone_24","remark":"彈出3b_4a, 棋牌",
   "ad":{"image":"https://pica-ad-api.diwodiwo.xyz/medias/8ee3cc7a-….mp4",
         "rawLink":"https://yy2-apk.juxiae.com/package/android-3.5.54/249_xxkyjy_kv7.apk"}}
]}}
```

`/redirect/{zone}` 实测 302 到落地页：

```
GET https://pica-ad-api.diwodiwo.xyz/redirect/zone_8
→ 302 location: https://a.tp-lp3.org/?attributionId=13
```

## 2. 广告结构

### 2.1 广告服务器

`AdService`（`feature-comics-*.js`）只有两个端点：

| 端点 | 作用 | 证据 |
|---|---|---|
| `GET /get-ad-zones?z=zone_a,zone_b,…` | 广告位下发，返回 `data.zones[]` | `ENDPOINTS.GET_AD_ZONES = "/get-ad-zones"` |
| `GET /redirect/{zone_id}` | 点击跳转，302 到落地页 | `ENDPOINTS.REDIRECT = "/redirect"` |

**iOS 原生客户端也走这台服务器**：Dart 侧 `AdRemoteDataSource.fetchZones` 拼的 BASE 就是 `https://pica-ad-api.diwodiwo.xyz`，日志前缀 `[AdRemoteDataSource] GET ` / `[AdRemoteDataSource] HTTP `，端点字符串 `/get-ad-zones?z=`、`/redirect/zone_` 与 Web 端完全一致。

同一域名下还有创意素材 `/medias/{uuid}.gif|mp4`，以及 H5 广告页：

```
GET https://pica-ad-api.diwodiwo.xyz/android/font
→ 302 https://pica-a-display.diwodiwo.xyz/show?zones=zone_7,zone_8,zone_10&round=2&location=wakamoment
```

广告位分组写死在 bundle 里，共 5 组：

| 用途 | zone 组合 |
|---|---|
| 瀑布流（4 组轮换） | `zone_8,zone_24,zone_11` / `zone_6,zone_7,zone_9` / `zone_24,zone_6,zone_25` / `zone_7,zone_8,zone_10` |
| 首页横幅 | `zone_26,zone_3,zone_17,zone_18,zone_4,zone_19,zone_5,zone_27` |

缓存 600 s（广告位）/ 900 s（横幅），前端每 300 s 刷新。**这几个数字决定了验证方法**：改完规则后最多等 5 分钟才看得到变化，或者清一次站点数据。

### 2.2 广告位清单

| 界面 | 容器 class | 尺寸特征 |
|---|---|---|
| 阅读器全屏广告页 | `.reader-ad-fullpage` | `position:absolute; width/height:100%` |
| 阅读器双页模式广告 | `.dual-page-content--ad` / `.dual-spread-ad-body` | 自带 `.dual-ad-nav-btn--next` 翻页按钮 |
| 阅读器上下滚动模式 | `.vw-ad-container` / `.vw-ad-placeholder` | 占位 `height:440px` |
| 漫画详情页（手机） | `.comic-detail-page-ad` → `.comic-detail-ad-mobile-container` | `height:80px!important` |
| 漫画详情页（桌面） | `.comic-detail-ad-desktop-wrapper` | swiper 轮播 |
| 章节列表底部 | `.chapter-navigation__ad` | 章节导航下方 |
| 支持页 / 广告聚合页 | `.ads-container` / `.ads-skeleton-container` | 两列大图 + 小图 |
| 分类页广告卡 | `.cats-item-ad` | 与分类卡同版式，仅 `adData` 存在时渲染 |
| 分类页广告标签（密集模式） | `.cats-tag-ad` | 标签云里的广告位 |

「支持嗶咔」这类入口的落地页是 `https://pica-ad-api.diwodiwo.xyz/android/*`，被域名规则一并封掉。

### 2.3 阅读器里那页广告不是接口给的

`feature-comics-*.js` 的分页换算：

```js
Oo = e => e + Math.floor(e / 20)          // 虚拟总页数：每 20 张图多算 1 页
Bo = e => (e - 1) % 21 == 20              // 第 21、42、63… 虚拟页 = 广告页
Uo = e => e - Math.floor((e - 1) / 21)    // 虚拟页 → 实际图序号
```

结论：**广告页是本地算出来的，与接口是否返回广告无关**。接口被拦后 `Us` 组件走错误分支，于是第 21 页变成「暂无广告内容」的空白页——这就是纯域名规则不够用的原因。

### 2.4 iOS 原生客户端

iOS 端是 Flutter App，广告在 Dart 层，路径取自 AOT 字符串表：

| Dart 源码路径 | 界面 |
|---|---|
| `data/ad/AdZoneConstants.dart`、`data/models/AdZone.dart`、`data/datasources/AdRemoteDataSource.dart` | 广告位常量、模型、拉取 |
| `ui/page/general/home/homeModalAdList/homeTipADList.dart`、`showHomeModalDialog.dart`、`showHomeModalPage.dart` | **首页弹窗广告**（对应广告位备注里的「彈出2b_3a」） |
| `ui/page/comic/ComicReader/readerPage/widget/ad/readerAdWidget.dart` | 阅读器广告 |
| `ui/page/comic/ComicDetails/widget/ad/ComicInfoAdWebView.dart` | 详情页广告 WebView |
| `ui/widgets/CommonWidgets/PicaAdWebView.dart`（`PicaAdWebViewState`） | 通用广告 WebView 容器 |
| `ui/page/general/category/widget/supportAdOverlay.dart`、`_SupportAdPage` | 分类页「支持」浮层 |
| `NativeAdWidget` / `NativeAdItemWidget` | 原生样式广告卡 |

zone 常量只有 `zone_28`–`zone_35`、`zone_51`–`zone_54` 这 12 个，与 PicaWeb 的 zone 组合不重叠：同一台广告服务器按端分广告位。

**iOS 端只需要域名规则**：App 不解析 HTML，注入层对它既不生效也不产生副作用；`PicaAdWebView` 加载的落地页同样在 `diwodiwo.xyz` 下，一并被封。

### 2.5 PicaWeb 是 PWA：注入先要拆 Service Worker

`https://manhuabika.com/sw.js`（7647 字节，Workbox）实际内容：

| 配置 | 原文 | 后果 |
|---|---|---|
| 预缓存 | `precacheAndRoute([{url:"index.html",revision:"ee7df9db…"}, …])` | 应用壳进 CacheStorage |
| 导航拦截 | `NavigationRoute(createHandlerBoundToURL("/index.html"))`，denylist 只有 `/^\/_/`、`/\/[^/?]+\.[^/]+$/`、`/\/api\/.*/` | **所有页面导航都返回预缓存壳**，注入的 HTML 进不去 |
| 图片 | `registerRoute(/\.(?:png\|jpg\|jpeg\|svg\|gif\|webp)$/i, CacheFirst("images-cache", maxAge 30 天))` | 广告创意 `/medias/*.gif` 命中，**30 天不回源** |
| 同源接口 | `registerRoute(/\/api\/.*/i, NetworkFirst("api-cache", maxAge 300 s))` | 广告位 JSON 可能被缓存 5 分钟 |

这正好解释「插件装了、广告一点没少」：域名规则拦得到网络，但页面来自缓存壳（注入没执行）、广告图来自 30 天 CacheFirst 缓存。

对策三层：

1. `[Rewrite]` 拒 `https://manhuabika.com/sw.js` 与 `workbox-*.js`，App 再也注册不回来；
2. 注入运行时注销现有 SW、清空整个 CacheStorage、把 `navigator.serviceWorker.register` 打成 rejected；
3. **一次性动作**：更新插件后要清一次站点缓存（删主屏图标从 Safari 重开，或 Safari → 设置 → 高级 → 网站数据 → 删 `manhuabika.com`），否则第一次导航仍由旧 SW 提供缓存壳。清过之后 1+2 保持现状。

## 3. 规则

### 3.1 域名层（两个模块都有）

| 规则 | 理由 |
|---|---|
| `DOMAIN-SUFFIX,diwodiwo.xyz,REJECT` | 广告服务器总域。下发、跳转、素材、H5 广告页都在它和它的子域（`pica-ad-api` / `pica-a-display`）下。iOS 原生端若真机出现空占位，按 §6 换成 `REJECT-DICT` |
| `DOMAIN,pica-juicy.picacomic.com,REJECT` | 旧版 Android 的 H5 广告位宿主，2026-10-29 实测已不响应；服务端由 `/api/v1/init` 的 `waka` 字段下发新地址，保留此条防回切 |
| `DOMAIN-KEYWORD,pica-ad-api,REJECT` | iOS 端把广告域写成前缀 `https://pica-ad-api.<domain>`，换域时这条兜底 |
| `AND,((DOMAIN-SUFFIX,manhuabika.com),(PROTOCOL,QUIC)),REJECT`<br>`AND,((DOMAIN-SUFFIX,picacomic.com),(PROTOCOL,QUIC)),REJECT` | 只有 `Pica-URL.module` 需要：Cloudflare 对 h3 有 Alt-Svc，走 QUIC 就 MITM 不到，注入静默失效 |
| `request … /manhuabika\.com\/(?:sw\.js|workbox-[^/?#]+\.js)/ then reject(404)` | 只有 `Pica-URL.module` 需要：见 §2.5，SW 会把导航喂成缓存壳 |

**不封 API 域**：`Me("picaapi")` 拼出的是 `https://picaapi.<当前 API 域名>`，域名会换（`go2778.com`、`acbbb.com` 是图片 CDN），封任何一个都会连坐登录与图片。广告域不跟着轮换，只封它。

### 3.2 注入层（`pica-clean.js`）

只对「路径里没有扩展名」的页面请求注入，避免给 assets/接口白拉响应体：

```
^https?://(?:www\.)?(?:manhuabika\.com|picacomic\.com)/+(?![^?#]*\.[a-z0-9]+(?:[?#]|$))
```

脚本再核一次 `PicaWeb` 标记，所以 `www.picacomic.com` 那张 Next.js 下载页不会被改。注入内容是 `<style id="pica-ad-clean">` + `<script id="pica-ad-runtime">`，落在 `</head>` 前（没有 `</head>` 时退到 `<body>` 起始处），重复注入直接放行。

### 3.3 运行时行为

| 行为 | 实现 | 为什么这么做 |
|---|---|---|
| 广告容器隐藏 | 一条 `display:none!important` 覆盖 2.2 节全部 class | 不删 DOM：这些节点是 React 渲染的，删了下一次 `setState` 会炸 |
| 广告接口短路 | 包一层 `window.fetch`，命中 `diwodiwo.xyz` 直接回 `{code:200,data:{zones:[]}}` | SPA 的 `transformResponse` 认 `code 200`，空数组走「暂无广告内容」，不进重试；比 404 干净 |
| 阅读器广告页跳过 | 派发 `KeyboardEvent("keydown",{key:"ArrowRight"})` | 翻页键盘监听挂在 `document` 上（`ArrowRight/L/End → 下一页`），移动端也照样生效 |
| 兜底 | 300 ms 后还在广告页 → 点 `.page-nav-button.nav-right` | 键盘被输入框之类拦掉时的退路 |
| 双页模式 | 优先点该广告页自带的 `.dual-ad-nav-btn--next` | 双页模式不吃键盘事件 |
| 限速 | 同一广告页 ≤3 次；相邻 ≥800 ms；10 s 窗口 ≤6 次 | React 重渲染会换节点，仅靠节点身份判重会空转 |

`Response` 用手搓对象而不用构造函数：老 WebView 里没有 `Response`，直接 `new` 会抛错把整段运行时带崩。

## 4. 为什么需要 URL 模块

只装 `Pica-Domain.module` 的效果：广告内容全部消失，但

- 阅读器翻到第 21 页会停在一张黑页上（`.reader-ad-fullpage` 被隐藏，页面本身还在分页里），需要手动再滑一次；
- 详情页、章节列表、分类页的广告位被 `display:none` 后**不占位**，版式正常。

要消掉那张黑页，就必须拿到页面 HTML 做注入 → 必须 MITM。

## 5. 明确不做

- **不拦 API 域与图片 CDN**（`picaapi.*`、`s3.picacomic.com`、`go2778.com`、`acbbb.com`、`storage*`）：封了等于封 App。
- **不拦 gtag**（`www.googletagmanager.com`）：站点用它做访问统计和错误上报，不是广告位；拦了会连带 `rec_track_unhealthy` 之类的自检事件丢失。要纯隐私向的拦截请自己加。
- **不动公告、推荐位、分类与标签**：`banners`、`announcements`、`rec/*` 都属于内容，不属于广告位。
- **不改分页公式**：`Oo/Bo/Uo` 是压缩后的局部变量名，按名字 patch bundle 每次发版都会失效；改用可降级的 DOM 方案。
- **不点广告、不伪造点击**：`/redirect/*` 只拦，不做「点掉」类处理。

## 6. 会失效 / 已知取舍

| 现象 | 原因 | 判断 |
|---|---|---|
| 「支持嗶咔」入口点开是空白/报错页 | 落地页在 `diwodiwo.xyz` 下，被域名规则拦了 | 预期内；这个入口本身就是广告 |
| 阅读器偶尔仍停一张黑页 | 键盘事件没生效且 `.page-nav-button.nav-right` 当时不可用（首尾页） | 滑一下即可；黑页不含任何可点内容 |
| 广告位消失后首页横幅区变窄 | 容器被 `display:none`，不占位 | 预期内，比留白更好 |
| PicaWeb 失去离线可用性 | SW 被拆，断网时不再有预缓存壳 | 换来注入长期生效；需要离线时把 `pica_enable` 关掉再访问一次即可重新安装 SW |
| 广告服务器换域后规则失效 | 广告域目前与 API 域解耦，但换域是随时可能的 | 换域时只需改 `DOMAIN-SUFFIX`，注入层不用动 |
| iOS 端出现广告位空占位或首屏变慢 | `REJECT` 让请求直接失败，Flutter 侧可能停在「加载中」而不是「无数据」 | 把域名规则改成 `REJECT-DICT`（回 200 空体）：`DOMAIN-SUFFIX,diwodiwo.xyz,REJECT-DICT,extended-matching,pre-matching`，App 会走 `code == null` → 无广告分支 |

## 7. 安装

1. Loon → 配置 → 模块 → 添加，三选一：
   - `RedCognitio-Ads.plugin` 合集（已并入，开关名「哔咔-去广告」，需 MITM + 信任 Loon CA）
   - `Pica-URL.module`（单模块，需 MITM + 信任 Loon CA）
   - `Pica-Domain.module`（不装 CA 也能用，阅读器留黑页）
2. URL 模块确认 MITM 已开，hostname 里有 `manhuabika.com`。
3. **清一次站点数据**（Safari → 设置 → 高级 → 网站数据 → 删 `manhuabika.com`，或删掉主屏图标重开一次）：PicaWeb 的 Service Worker 会把旧壳和广告图缓存住，不清这一次，插件装了也看不到任何变化。
4. 任选一本 ≥21 页的漫画，翻到第 21 页，应自动跳到第 22 页。

装好后先做两个决定性自测（手机 Safari，不经过 App）：

| 自测 | 期望 | 说明 |
|---|---|---|
| `https://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=zone_8` | 连接失败 / 空响应 | 能返回 `{"code":200,...}` 说明规则没生效：插件没更新到 1.0.4、开关关了，或流量没走 Loon |
| `https://manhuabika.com/sw.js` | 404 | 说明 SW 已被拦；还能拿到脚本就是旧插件 |

抓包复核用自己的工具链，见仓库外 `tools/MITM.md`：`bash tools/start_mitm.sh pica`。

## 8. 验证

### 8.1 已做的本地验证（2026-10-29）

`npm test`（`tests/pica.test.js`，18 项）覆盖：

- 域名模块只封 `diwodiwo.xyz` 与 `pica-juicy`，不含任何业务域；
- 注入规则正则：`/`、`/pdownload`、`/comic/…`、`/comic/reader/…` 命中；`assets/js/*.js`、`*.css`、`*.json`、`*.png`、`manifest.json`、`picaapi.*`、`pica-ad-api.*` 不命中；
- 注入只插一次（重复执行原样放行）、无 `</head>` 时退到 `<body>`；
- 样式覆盖 12 个广告容器 class；
- 非 HTML、无 `PicaWeb` 标记、开关关闭时都不改响应；
- 拒 `sw.js` / `workbox-*.js`，不误伤 assets 与 manifest；两个模块都带 `pica-ad-api` 关键字兜底；
- 运行时：注销 SW、清空 CacheStorage、`register` 被打成 rejected；广告域 fetch 被短路成空池且不发原生请求、其他域透传；广告页派发 `ArrowRight`；键盘无效时点 `.page-nav-button.nav-right`；双页模式点 `.dual-ad-nav-btn--next`；同页 ≤3 次、相邻 ≥800 ms、任意 10 s 窗口 ≤6 次；重复执行不挂第二套 `MutationObserver`。

另有 jsdom 冒烟（不进仓库，脚本临时写的）：把注入后的整页跑在真实 DOM 里，模拟 SPA 的 `document` 键盘监听 → 渲染 `.reader-ad-fullpage` 后 200 ms 内页面从 20 翻到 21、广告节点消失；`getComputedStyle(.comic-detail-ad-mobile-container).display === "none"`，普通块仍为 `block`；`window.fetch("https://pica-ad-api.diwodiwo.xyz/get-ad-zones?…")` 返回 `{"code":200,"data":{"zones":[]}}` 且未触达原生 fetch。

### 8.2 真机待验（本轮未做）

- [ ] iPhone 上 Loon 开 MITM，冷启动 PicaWeb，首页横幅区不再出现广告图；
- [ ] 详情页 80 px 广告条消失、下方 tab 上移；
- [ ] 阅读器第 21 / 42 页自动跳过（重点，键盘事件在 iOS WebView 是否生效）；
- [ ] 双页模式（设置 → 阅读模式 → 双页）广告页点「下一页」可跳过；
- [ ] 上下滚动模式无 440 px 空占位；
- [ ] 回归：登录、搜索、分类、章节列表、评论、图片加载正常。

iOS 原生客户端（`com.picacomic.picacg.picacg` 2.5.85，只装 `Pica-Domain.module` 即可）：

- [ ] 冷启动首页不再弹广告弹窗（`homeTipADList` / `showHomeModalDialog`）；
- [ ] 阅读器内不再出现广告页，且没有留下空白占位；
- [ ] 详情页 `ComicInfoAdWebView` 区域不占版式；
- [ ] 回归：登录、收藏、阅读、下载正常。

## 9. 版本策略

合集里哔咔的规则随合集构建号走（`1.0.3` 起并入），独立模块版本独立递增（`0.1.0` 起）。

规则或脚本行为变化升次位（`0.2.0`），只改文档或注释升末位（`0.1.1`）；两个模块与脚本版本号保持同步，脚本地址 `?v=` 跟着改，避免 CDN 缓存。
