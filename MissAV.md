# missav 去广告

规则位置：合集 `RedCognitio-Ads.plugin`（`missav_enable` / `missav_debug`），注入脚本 `scripts/missav-clean.js`，离线样本与抓取工具在仓库外 `samples/missav/`。

## 0. 一句话结论

missav 没有「广告位接口」，广告有三条互相独立的来源：**服务端直出的 smartpop iframe**、**页面尾部内联的 `htmlAds` 脚本**（每次随机挑 1 条）、**播放器上的 `@click="pop()"`**。
所以只封域名会留下白块和一个点一下就开新标签的播放器；本方案的主力是 HTML 重写，域名层只做兜底。

## 1. 样本与取证

| 项目 | 值 |
|---|---|
| 站点 | `missav.ws`（Cloudflare 挑战，403）→ 现用主域 `missav123.com`，路径带 `/dmNNN/` 镜像前缀（本轮 `/dm247/`、`/dm278/`） |
| 其他入口 | `missav.ai`、`missav.live` 同样是 CF 挑战页；`missav.com`（S3）、`missav.tv`（Cowboy）是停放页，未纳入规则 |
| 托管 | Cloudflare，响应头 `alt-svc: h3=":443"`，`cf-mitigated: challenge` |
| 技术栈 | Laravel + Blade + Alpine.js，播放器 Plyr 3.6.8 + hls.js（cdnjs） |
| 取样 | 2026-10-30，移动 UA（iPhone Safari）与桌面 UA 各一轮；首页 `/cn/`、详情页 `/cn/marr-015`、列表页 `/dm278/cn/chinese-subtitle` |
| 工具 | Playwright bundled Chromium（本机 Chrome 走不通 TUN，`ERR_CONNECTION_CLOSED`）；`curl` 只能拿到 CF 挑战页 |
| 产物 | `samples/missav/`：`pw-mobile.*`、`detail.*`、`d-desktop.*`、`cat-mobile.*`、`xdata.txt`、`inline/*.js`、`adblock.*`、`recon*.mjs`、`verify-clean.mjs` |

复查方法：`node samples/missav/recon.mjs https://missav123.com/cn/ out mobile`（抓请求 + 最终 DOM），
`node samples/missav/adblock-probe.mjs`（封广告域后看是否上墙），`node samples/missav/verify-clean.mjs`（把样本过一遍注入脚本再加载）。

## 2. 广告结构

### 2.1 点击播放器弹窗（popunder）

播放器容器上绑着两个事件，点画面或按空格都会进：

```html
<div @click="pop()" @keyup.space.window="pop()" class="aspect-w-16 aspect-h-9">
```

`pop()` 在同一个 `x-data` 里，逻辑是：每页只弹一次（`popOnce`）、已弹过的 URL 记进
`sessionStorage`（`popped`）、24 小时后才重新进池子，然后 `window.open('/pop?url=' + 编码后的广告地址, '_blank')`，
并用 300ms 定时器盯着弹窗，弹窗一关就替你 `player.play()`——所以只封 `/pop` 会出现「点一下开空白标签、回来还要再点一次」。

广告池（iPhone 列表 `directUrlsIphone`，桌面列表内容相同，共 17 条）：

| 条数 | 落地 | 说明 |
|---|---|---|
| 10 | `tsyndicate.com/api/v1/direct/c65c80b4…`（`?2`…`?10`） | TrafficStars 直链 |
| 2 | `ad.twinrdengine.com/adraw?zone=01DXF6DT004000000000001JGA` | adraw 广告位 |
| 3 | `diffusedpassionquaking.com/1919723/`（`?2` `?3`） | 跳转型 dating 落地 |
| 1 | `go.myavlive.com/easy?campaignId=…` | Stripchat 白标 |
| 1 | `go.greentrafsa.com/smartpop/…` | smartpop |

### 2.2 服务端直出的 smartpop iframe

首页一次给 6 个（移动 300×100、桌面 728×90 各三条），详情页 `.under_player` 里 1 个 300×100：

```html
<iframe width="300px" height="100px" src="https://go.mayzaent.com/smartpop/<64 hex>?userId=<64 hex>">
```

跟随重定向：`go.mayzaent.com/smartpop/<hash>` → 302 `creative.greentrafsa.com/widgets/Spot/lib-auto.js?campaignType=smartpop&trafficType=videoSlider&limit=2&schemeType=mediabuyer`。
`lib-auto.js` 不是 banner，它自己继续 `window.open`，首页 12 秒实测开了 6 个新标签。

### 2.3 内联 `htmlAds` 脚本

页面尾部有一块 `<div id="html-ads"></div>` 与一段内联脚本，里面三个变体：

| 序号 | 变体 | 产物 |
|---|---|---|
| 0 | `creative.myavlive.com/widgets/Spot/lib.js` → `new StripchatSpot({...}).mount(document.body)` | 300×150（桌面）/ 300×100 悬浮摄像机窗 |
| 1 | 自建 `div.fixed.right-2.bottom-2` + `t.rallytrck.website/s1/<uuid>` iframe | 右下 300×100 悬浮条（带自绘关闭按钮） |
| 2 | `<script src="https://go.mayzaent.com/smartpop/<hash>&width=298px&height=98px">` | 再拉起一条 smartpop 链 |

调度：`htmlAdIndexes.push(0,0,0,0,0, 1,1,1, 2,2,2,2)` → `shuffle` → 只执行 `htmlAds[htmlAdIndexes[0]]()`，
即**每次页面加载随机命中 1 种**（权重 5 : 3 : 4）。这是「有时是弹窗、有时是悬浮条」的原因。

### 2.4 cam 白标广告位（详情页）

| 位置 | URL | 尺寸 |
|---|---|---|
| 桌面侧栏 | `creative.mavrtracktor.com/widgets/v4/Universal?campaignId=new_side_player` | 300×250 |
| 桌面侧栏（另一家） | `t.snaptrckr.fun/s1/<uuid>` | 300×250 |
| 播放器下方 | `creative.myavlive.com/widgets/v4/Universal?campaignId=under_player&tag=girls/chinese` | 398×135（2×1 网格） |

`under_player` 里那张还会被 Alpine 用 `$refs.stripchat.innerHTML` 重新拼一次（模板在属性里，转义为 `&lt;iframe …&gt;`），
所以样式兜底要按 `iframe[src*="myavlive"]` 写，不能只删服务端那一份。

### 2.5 「更多好站」联盟推广位

导航栏下拉，`rel="sponsored nofollow noopener noreferrer"`，实测首页 32 条 `<a>`、详情页 37 条（移动 + 桌面两套导航）：

```
免费成人ai短剧 / 海量短剧免费看 / 哔咔漫画 / 全球最大色情平台 / 全球好片看X站 / 黄果AI短剧 /
エロライブ配信 / 糖心VLOG / 成人抖阴破解版 / 禁果短剧最X尺度 / 黄果漫剧 / 黄果短剧免费版 /
AI女友任你肏 / 体育电子百家乐 / 同城约炮免费上门 / JerkDolls / ThePornDude …
```

全部是 `bit.ly` 短链 + 两个外站直达，属于静态联盟位，不是广告网络投放。

### 2.6 统计与第三方库（不拦）

| 域名 | 作用 | 处置 |
|---|---|---|
| `cdn.tsyndicate.com/sdk/v1/ms.js` | TrafficStars SDK（协议相对写法 `//cdn.tsyndicate.com`） | 拦 |
| `www.googletagmanager.com`（`GTM-P32NTRH6`） | 统计容器 | 保留（域名可选拦截，见合集注释） |
| `client-rapi-missav.recombee.com` | 推荐系统 | 保留，拦了推荐位空 |
| `fourhoi.com` | 封面 / 预览图 CDN | 保留，拦了全站无图 |
| `cdnjs.cloudflare.com` | Plyr / hls.js | 保留，拦了不能播 |

### 2.7 没有的东西

- 无视频 pre-roll：详情页 DOM 与请求里 `vast|vpaid|ima|preroll|adTagUrl` 全部 0 命中。
- 无 AdSense / ExoClick / JuicyAds / PopAds。
- 无 adblock 检测：把所有广告域 abort 后详情页正文 1168 字正常渲染，没有「关闭广告拦截」文案。

## 3. 规则

### 3.1 域名层（常驻，`[Rule]`）

```
DOMAIN-SUFFIX,myavlive.com / mavrtracktor.com / greentrafsa.com / mayzaent.com
DOMAIN-SUFFIX,rallytrck.website / snaptrckr.fun / tsyndicate.com / twinrdengine.com
DOMAIN-SUFFIX,diffusedpassionquaking.com
AND,((DOMAIN-SUFFIX,missav123.com),(PROTOCOL,QUIC)),REJECT   # missav.ws / .ai / .live 同
```

白标网络的子域前缀固定（`creative.` / `t.` / `go.`）、注册域会轮换，所以按注册域封。
QUIC 必须降级：站点带 `alt-svc h3`，Safari 走 h3 时 MITM 与注入全部静默失效。

### 3.2 首方路径层（`[Rewrite]`）

```
request if ${missav_enable} == true && ${url} ~= /…\/pop\?url=/ then reject(404)
```

`/pop` 只服务弹窗。**必须和 3.3 的 `pop()` 摘除同批上线**，否则就是 2.1 里说的「点一下开空白标签、回来再点一次」。

### 3.3 注入层（`scripts/missav-clean.js`）

命中：missav 三个域名的文档请求（路径无扩展名），`requires_body=true`。做六件事：

| # | 动作 | 锚点 |
|---|---|---|
| 1 | 删整块含 `htmlAds` 的内联脚本 | `<script>` 块内含 `htmlAds`（主块 + 末尾调度块各一块） |
| 2 | 删占位容器 | `<div id="html-ads"></div>` |
| 3 | 删广告脚本标签 | `id="SCSpotScript"`，或 src 命中广告域（含 `//cdn.tsyndicate.com` 协议相对写法） |
| 4 | 删广告 iframe | 先连 `<div class="mx-auto" style="width:…">` 外壳一起删，再清零散的 `<iframe …></iframe>` 对 |
| 5 | 删联盟推广位 | `rel="sponsored"` 的 `<a>`；「更多好站」入口（`showCollapse === 'partners'` 的 `<a>`）与面板（同名 `<span>`，按标签深度配对删） |
| 6 | 摘弹窗事件 | `@click="pop()"`、`@keyup.space.window="pop()"` 两个属性 |

### 3.4 兜底样式

```
#html-ads,.under_player,iframe[src*="myavlive"],iframe[src*="mavrtracktor"],
iframe[src*="greentrafsa"],iframe[src*="mayzaent"],iframe[src*="rallytrck"],
iframe[src*="snaptrckr"],body > .fixed.right-2.bottom-2{display:none!important}
```

域名层拦掉之后 DOM 里会留 300×100 / 300×250 的白块，这一条负责消掉；
Alpine 若把 `under_player` 那张 iframe 重新拼回来，样式也能压住。

## 4. 为什么不能只封域名

| 广告 | 只封域名的结果 |
|---|---|
| 服务端 smartpop iframe | 白块留在版式里（实测 300×100 与 398×135 各一个） |
| `htmlAds` 三种变体 | 脚本还在跑，随机命中的那一条依旧创建容器；命中的是右下悬浮条时甚至只剩一个关不掉的空框 |
| `@click="pop()"` | 点播放器仍开新标签（404 或空白），且 `player.play()` 要等弹窗关掉才触发 |
| 「更多好站」 | 32 条 `bit.ly` 与站点同域，域名层完全碰不到 |

## 5. 明确不做

- **不拆独立 `.module`**：广告主体在 HTML 与服务端直出的 iframe 里，纯域名模块只会留白块 + 弹窗，见 §4。
- **不整域封 `bit.ly`**：短链在别处也在用，只在注入层从 HTML 里删 `<a>`。
- **不删 `x-data` 里的 `directUrls` / `pop()` 定义**：函数留着没人调用最安全，Alpine 少一个方法会在初始化时抛错，`initClip` / `updateHash` 还要共用同一份状态。
- **不包 `window.open`**：站内正常外链（地址发布、电报群、下载页）都用 `target=_blank`，全局打桩会误伤。
- **不动 GTM**：页面里 `window.dataLayer.push` 依赖 GTM 那段初始化，删了会抛错；要断统计就在 `[Rule]` 取消那行注释。
- **不拦 `fourhoi.com` / `cdnjs.cloudflare.com` / `recombee`**：封面、播放器、推荐位。

## 6. 会失效 / 已知取舍

- 关掉 `missav_enable` 后，广告域仍然常驻拦截：弹窗与第三方投放不会回来，但页面内的 `htmlAds` 悬浮条会回来（容器由内联脚本创建）。
- 站点改版改名（`htmlAds` → 别的）时注入层命中数会掉到 0，用 `missav_debug` 的 `MISSAV-CLEAN … htmlAds=0` 就能看出来。
- `missav.com` / `missav.tv` 是停放页，没有纳入；若哪天成为入口，注入层与域名层都要补。
- Cloudflare 若对 MITM 后的请求加严，最坏情况是注入不生效，域名层仍保底。

## 7. 安装

1. Loon → 配置 → 插件，安装合集（Release 或 Debug）。
2. 开启 MITM，确认 `missav.ws` / `missav123.com` / `missav.ai` / `missav.live` 与通配子域在 MITM 列表里（合集已带）。
3. 信任 Loon CA。
4. 设置页确认「missav-去广告」为开。

## 8. 验证

### 8.1 已做的本地验证（2026-10-30）

- `tests/missav.test.js`：8 组断言，用 `tests/fixtures/missav-home.html`、`missav-detail.html`（从真实抓取抽出的片段，含属性顺序、`&amp;`、`\u0022` 转义、Alpine 模板）。
- 真实整页样本过脚本（`samples/missav/*.html`，含首页 / 详情 / 列表 / 桌面详情）：

  | 样本 | htmlAds | scriptTags | iframes | 联盟位 | pop() | 结果 |
  |---|---|---|---|---|---|---|
  | `pw-mobile.html` | 2 | 1 | 6 | 34 | 0 | 广告 iframe 0、`rel="sponsored"` 0 |
  | `detail.html` | 2 | 1 | 4 | 39 | 2 | 同上，`pop()` 定义与 `<video>` 保留 |
  | `cat-mobile.html` | 2 | 1 | 0 | 34 | 0 | 同上 |
  | `d-desktop.html` | 2 | 0 | 5 | 39 | 2 | 同上 |

- `samples/missav/verify-clean.mjs`：改写后的页面在浏览器里加载，广告域请求 **0**、广告 iframe **0**、`rel="sponsored"` **0**、点播放器 `window.open` **0**，首页 441 条链接 / 72 个 `<video>`、详情页 356 条链接 / 30 个 `<video>` 均在。

### 8.2 真机待验

1. 首页：无右下 300×100 悬浮条、无 300×150 摄像机浮窗、不自动跳新标签。
2. 详情页：点播放器直接播放、不弹标签；播放器下方无 398×135 网格。
3. 任意页：地址栏不出现 `/pop?url=`；「更多好站」不再有推广项。
4. Loon 日志：`missav123.com` 文档命中「missav 去广告注入」，广告域命中 REJECT。
5. 回归：登录、搜索、语言切换、片单、收藏、评论、下载、拖动进度。

## 9. 维护锚点与版本

- 站点改版时先看 `samples/missav/recon.mjs` 抓回的 DOM，确认三个锚点还在：`id="html-ads"`、`let htmlAds`、`@click="pop()"`。
- 广告域轮换时补 `DOMAIN-SUFFIX`（注册域级），并同步 `AD_SRC_RE`（脚本内）。
- 脚本版本随合集 `1.0.N` 递增，`npm run build` 自动更新 `?v=`；`tests/missav.test.js` 里对注入结果做的是结构断言，改锚点必须同步改测试。
