# JAV 站族 去广告（按广告网络覆盖，不按站点）

规则位置：合集 `RedCognitio-Ads.plugin`（`jav_enable` / `jav_debug`），脚本 `scripts/jav-clean.js`。

## 0. 一句话结论

JAV 衍生站**没有共享内容模板**，但**共享广告网络**。所以不要一家一家写锚点，改成按广告网络写判据：
ExoClick 一族（`magsrv.com` / `pemsrv.com` / `exosrv.com` / `exoclick.com` / `realsrv.com`）、
JuicyAds 一族（`jads.co` / `juicyads.com`）、TrafficStars（`tsyndicate.com`）、TrafficJunky（`trafficjunky.net|com`）。
判断依据用 `ad-provider.js`、`iframe.php?zone=`、`<ins data-zoneid>`、内联 `popMagic` 这几个**不会随站点换皮而变**的特征。
新增一个站 = 加一个域名（脚本正则 + MITM），脚本不用改。

## 1. 实测矩阵（2026-10-30，移动 UA）

| 站点 | 广告网络 | 投放形态 | 广告请求（首页） | 处理方式 |
|---|---|---|---|---|
| 18AV `18av.mm-cg.com` | ExoClick | 服务端直出 `//a.magsrv.com/iframe.php?idzone=5037056&size=300x250`（2 个 300×250） | 12 | 删 iframe + 域名层 |
| 123AV `njav.tv` / `123av.com` | ExoClick | `a.magsrv.com/ad-provider.js` + `<ins data-zoneid=5901598>` + 内联 `popMagic`（弹窗引擎） | 6 | 删脚本 + 删 `<ins>` + 域名层 |
| JavBus `www.javbus.com` | JuicyAds | `poweredby.jads.co` + `i.jads.co` | 14 | 域名层 |
| JAVGG `javgg.net` | 无第三方 | 只有自家 `javcode.net` 素材 + GA | 0 | 无需处理 |
| JavDB `javdb.com` | 无第三方 | Yandex Metrica；详情页需登录 | 0 | 无需处理 |
| JAV321 `jav321.com` | 无（HTML 里只有 JuicyAds/TrafficJunky 的字符串残留） | 无 iframe | 0 | 无需处理 |
| SupJAV / JavLibrary | 未取到（Cloudflare 托管挑战拦住了无头浏览器） | — | — | 已进域名层与注入名单，真机再核 |
| AVMOO | 跳 `tellme.pw/jav` 网关 | — | — | 已进 MITM 名单 |
| missav 家族 | Stripchat 白标 + TrafficStars | 自建内联 `htmlAds` + 首方 `/pop` | 见 MissAV.md | **不在本模块**，走合集 |

关键观察：

- **ExoClick 是大头**：`18AV` 走服务端 iframe，`123AV` 走 SDK + `<ins>`，两家形态不同但判据同一批域名。
- **JuicyAds 只做脚本挂载**（`poweredby.jads.co`），拦域名即净。
- **JAVGG / JavDB / JAV321 首页根本没有第三方广告**——这类站不需要规则，写了只会增加维护面。
- missav 是唯一「站内自建广告」的样本，所以它单独一套锚点，见 `MissAV.md`。

## 2. 规则三层

### 2.1 域名层（`[Rule]`，无需 MITM）

```
DOMAIN-SUFFIX,exoclick.com / exosrv.com / magsrv.com / pemsrv.com / realsrv.com
DOMAIN-SUFFIX,jads.co / jads.cc / juicyads.com
DOMAIN-SUFFIX,tsyndicate.com
DOMAIN-SUFFIX,trafficjunky.com / trafficjunky.net
```

这 11 条与 anti-AD 的重合，但本模块独立启用时自带，免得依赖另一份规则集（AWAvenue 里一条都没有）。

### 2.2 QUIC 降级

9 个站点逐一 `AND,((DOMAIN-SUFFIX,<site>),(PROTOCOL,QUIC)),REJECT`。这些站多在 Cloudflare 后并带 `alt-svc h3`，不降级注入静默失效。

### 2.3 注入层（`[Script]` + `scripts/jav-clean.js`）

命中：名单内域名的文档请求（路径无扩展名）。四件事：

| # | 动作 | 判据 |
|---|---|---|
| 1 | 删广告 iframe（成对/自闭合都认） | `src` 的主机名命中广告域，协议相对与单引号写法都覆盖 |
| 2 | 删广告脚本 | `src` 命中广告域，**或**内联块里出现 `AdProvider` / `popMagic` |
| 3 | 删 `<ins>` 广告位 | `data-zoneid` 或 `class="eas…"` |
| 4 | 补 CSS | `iframe[src*="magsrv"] …`、`ins[data-zoneid]` 等，兜住运行时才插进来的 |

为什么要删脚本而不只删元素：`ad-provider.js` 里的 `popMagic` 是弹窗引擎，留着它，页面内广告位删干净了照样会弹新标签。实测 123AV 页面里那段内联 `popMagic` 占 15KB，删掉后 `window.open` 链路直接不存在。

## 3. 验证（2026-10-30）

真实整页过脚本再在浏览器里加载（外站请求全 abort）：

| 页面 | 广告 iframe | `<ins>` | 广告域请求 | 弹窗 | 页面保留 |
|---|---|---|---|---|---|
| 18AV 首页 | 2 → 0 | 0 | **0** | 0 | 528 条链接 / 9654 字正文 |
| 123AV 首页 | 0 | 1 → 0 | **0** | 0 | 85 条链接 / 1081 字正文 |

脚本统计：18AV `iframes=2 scripts=0 slots=0`，123AV `iframes=0 scripts=3 slots=1`（3 个脚本 = `ad-provider.js`、`AdProvider.push`、内联 `popMagic`）。

单元测试 `tests/jav.test.js` 6 组（其中一组断言合集模板里开关、域名、QUIC、注入与 MITM 都已接线），
另加 `build.test.js` / `app-debug.test.js` 对开关数量与调试参数的约束，`npm test` 115 项全过。

## 4. 做不到 / 取舍

| 项 | 说明 |
|---|---|
| 站内自建广告 | 如 missav 的 `htmlAds`、首方 `/pop`，需要逐站锚点，不进本模块 |
| 换模板即失效 | 判据是广告网络特征，站点换广告网络（比如从 ExoClick 换 Adsterra）时要补域名 |
| Cloudflare 挑战 | SupJAV / JavLibrary 在无头浏览器里停在「请稍候…」，真机（真人浏览器 + 信任 CA）正常，需要真机复核 |
| 误伤风险 | 只按主机名匹配，`example.com/exoclick-review` 这种链接不会被删（有测试覆盖） |
| MITM 范围 | 名单 9 个站点 + 4 个镜像，站长换域要同步 `[Script]` 正则与 `[MITM]` |

## 5. 新增一个站的做法

1. 抓一次首页：`node samples/jav/recon-any.mjs new https://<站>/`，看 `hosts` 里有没有已覆盖的广告域。
2. 广告域已覆盖 → 只把域名加进 `build/RedCognitio-Ads.plugin.tpl` 的三处：`[Rule]` 的 QUIC 降级、`[Script]` 正则、`[MITM]` hostname。
3. 出现新广告网络 → 补 `[Rule]` 域名 + `scripts/jav-clean.js` 的 `AD_HOSTS` 与 `HIDE`，再加一条 `tests/jav.test.js` 断言。
4. 有站内自建弹窗（`@click`、首方跳转页）→ 那是 missav 那种做法，单独写脚本，不要塞进通用层。

## 6. 为什么并在合集里而不是独立模块

广告清单里一半是「第三方网络」（域名层就能拦，合集共用），另一半才是「HTML 容器」（要注入）。
拆成独立模块只有两种结局：要么只剩域名层、留下白块和弹窗；要么两份域名规则重复维护。
合集的 `[Rule]` / `[Script]` / `[MITM]` 三段本来就是按 App 分段写的，`jav_enable` 只是再加一段，
规则合并后一次安装即可，不存在「装了两个模块互相覆盖」的问题。
