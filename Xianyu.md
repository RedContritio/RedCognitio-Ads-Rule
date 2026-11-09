# 闲鱼 广告拦截

样本 `com.taobao.idlefish` **7.28.86.1（versionCode 529）**（2026-11-09 取包，`samples/xianyu/xianyu-7.28.86.1.xapk`，391,028,599 B）；历史样本 7.27.96.8（versionCode 528，targetSdk 35，2026-10 取包）。取包方式：APKPure XAPK（base 60 MB + `config.arm64_v8a` 325 MB），apktool 3.0.3 解资源、jadx 1.5.6 反编译 10 个 dex。

iOS 与 Android 共用同一套 mtop 接口（广告下发是服务端能力），规则按路径匹配，不依赖 Android 侧实现。

取包备忘：`apkeep -d apk-pure` 在当前版本（1.1.0）无论怎么写 `-o` 都只打印风险提示后退出。可用 APKPure 接口绕过：`POST https://api.pureapk.com/m/v3/cms/app_version?hl=en-US&package_name=com.taobao.idlefish`（头 `x-cv/x-sv/x-gp/x-abis`）返回 protobuf，用 `tools/pbdump.py` 读出 `version_list[].9` 的 XAPK 直链后 `curl` 下载。

## 广告结构

闲鱼是**自建开屏 + 三方 SDK 混合**，与淘宝（纯自建 + poplayer）不同：

| 层 | 实现 | 证据 |
|---|---|---|
| 自建开屏 | `com.taobao.fleamarket.splashad` | `SplashAdController`、`SplashAdResp`、`SplashAdCacheManager` |
| 三方聚合 | 穿山甲 + GroMore（`com.bytedance.msdk`）、优量汇、快手、倍孜、Sigmob | `AndroidManifest` 组件、`com.bytedance.msdk.adapter.gdt/sigmob` |
| 阿里妈妈 | `com.taobao.alimama`、`com.alimm.xadsdk`、`com.taobao.munion.taosdk` | `AlimamaAdvertising`、`AlimamaZzAdGetRequest` |
| 激励视频 | `com.taobao.fleamarket.rewardad` | `RewardAdActivity`、`RewardAdCsjAdapter`、`RewardAdYlhAdapter` |
| 优先级直投 | `com.insightvision.openadsdk`（FanTi） | `FanTiAdSdk`、字符串 `fanti_reward_ad`、`fanti_feed_ad_desc_image_logo` |

包内权限 `com.taobao.idlefish.openadsdk.permission.TT_PANGOLIN` 直接标明穿山甲内嵌；native 侧仅 `libpanglearmor.so`，快手 / 倍孜 / Sigmob 无 so，故它们的投放域不以明文出现在包里。

## 开屏链路

```
冷/热启动
  └─ SplashAdController.requestSplashAd
       ├─ mtop.taobao.idlecommerce.splash.ads         (2.0, 同步)
       ├─ mtop.taobao.idlecommerce.splash.async.ads   (1.0, 预取)
       ├─ MtopCachePrefetch.usePrefetch(cacheKey)     (mtop 缓存)
       └─ SplashAdCacheManager                        (本地素材池，按日期分桶)
```

响应模型 `SplashAdResp`：

| 字段 | 含义 |
|---|---|
| `adMap` | `Map<日期, List<SplashAd>>`，开屏素材池 |
| `cacheAdInfo` | 命中缓存素材，`fromDsp = mamaAd` 走阿里妈妈 adapter |
| `realTimeAd` | 实时广告，`showType` 决定 adapter |
| `config` | 交互配置：`click.area`、`shake.{count,duration,intensity}`、`swipe` |
| `dspList` | 参与本次请求的 DSP 名单 |
| `spaceIdMap` | 三方 SDK 广告位 ID |
| `hotStartInterval` | 热启动间隔（默认 60s） |
| `pageBlacklist` | 不出开屏的页面 |

adapter key：`csj`（穿山甲）、`ylh`（优量汇）、`mamaAd`（阿里妈妈）、`adPlus`（倍孜）、`toCSplashAd`。

三方 SDK 广告位 ID 有明文兜底值：`ylhSpaceId = 2138110733853185`、`adPlusSpaceId = 115982`。

### 关键结论：开屏只能清响应，不能拦请求

`SplashAdController` 的失败分支是：

```
onFailed → handleFailureResponse → requestAsyncSplashAd(再次请求异步接口)
```

异步接口再失败时，客户端仍会读 `SplashAdCacheManager` 与 `MtopCachePrefetch` 里的旧素材。所以 request 级 `REJECT` 只会让广告换个来源继续出，还可能拉长启动等待。正确做法是让响应成功但广告池为空：

```jq
if (.data | type) == "object"
then .data |= (.adMap = {} | .cacheAdInfo = null | .realTimeAd = null)
else . end
```

`data` 必须保留为对象：`SplashAdResp.getData()` 为 null 时，`onSuccess` 里仍有 `splashAdResponse.getData().requestId` 的取值路径，会走异常分支。清空 `adMap` 后 `adCount() = 0`，`getAdapterKey()` 返回 null，不进入任何 adapter，同时把空池写回本地缓存。

**装规则前已缓存的素材不会立刻消失**（`SplashAd` 带 `beginTime` / `endTime` / `campaignDate`，`todayAdCount` 按日期统计）。验证前必须清缓存或冷启动数次。

### 第二套开屏：阿里妈妈 SS

`com.taobao.fleamarket.advert.AdvertiseSplash` 在启动阶段额外初始化阿里妈妈 xadsdk（`@ExecNewInit`，`AdSdkConfig.setAppSite("12")`），并注册 MMA 曝光器。它自带 `SplashAdModel` / `splashAdCacheManager` / `advIds` 缓存链路，与自建开屏是两套独立实现。

包内可见的阿里妈妈侧候选域：`ssp.iytcdn.com`、`pre-ssp.iytcdn.com`（SSP）、`mamasearchad.cloudvideocdn.taobao.com`、`alimama.cloudvideocdn.taobao.com`、`s-gm.mmstat.com`、`log.mmstat.com`（MMA 曝光监测）。

**2026-10-25 抓包已证实这条链路在跑**（见下节）：开屏期间出现 `df.tanx.com/spf3`、`bdlog.tanx.com/imp`、`s-gm.mmstat.com/arms`、`log.mmstat.com/eg.js`，且 `Munion-SDK2.0.0` 也打 `df.tanx.com`。`ssp.iytcdn.com` 零请求，SSP 直连未参与。

## 首次抓包结果（2026-10-25 23:21）

手段：普通 HTTP 代理（`bash tools/start_mitm.sh xianyu`），44 MB / 883 flows / 143 hosts，Loon 已暂停。

### 关键结论：阿里系 App 走 anet，系统代理抓不到业务接口

| 观察 | 数据 |
|---|---|
| 闲鱼流量总量 | 138 flows，全部是 SDK 基础设施 |
| mtop 业务调用 | **0 条**（整包只有 `mtop.common.getTimestamp`：闲鱼 6 次、淘宝 1 次） |
| `goofish.com` TLS 握手 | **0 条**（无 clienthello，不是证书失败） |
| 出现在包里的闲鱼域 | `atoken.m.taobao.com`、`abtest.alibaba.com`、`dypnsapi`、`amap`、`tinyapp-gateway.alipay.com`、`h-adashx`、`df.tanx.com` |

原因：闲鱼（和淘宝）用阿里 anet / 自研 socket 发业务请求，不读 iOS 系统 HTTP 代理设置；只有走 CFNetwork/NSURLSession 的 SDK 调用被代理看到。知乎、美团、哔咔这类 NSURLSession 应用不受影响（知乎 1 万+ 条、美团 200+ 条均正常入库）。

**结论：普通代理模式对闲鱼无效**，要么上 WireGuard 全量模式，要么在 Loon 侧用脚本抓响应。

### 但广告侧证据是有效的

本次开屏（用户目视确认出现过一次）对应的流量特征：

| 请求 | 意义 |
|---|---|
| `df.tanx.com/spf3?e=...`（闲鱼 UA，3 次） | TanX 东风投放/落地，**开屏素材来自阿里妈妈 DSP** |
| `bdlog.tanx.com/imp?...` | TanX 曝光上报 |
| `h-adashx.ut.taobao.com/upload`（12 次） | 阿里妈妈曝光/点击上报 |
| `s-gm.mmstat.com/arms.1.x`、`log.mmstat.com/eg.js` | MMA 可见性监测（`MmaExposer`） |
| `Munion-SDK2.0.0` → `df.tanx.com/spf3` | 淘客 Munion 同时出广告 |

同时 `pglstatp-toutiao.com` / `pangolin-sdk-toutiao.*` **零请求**：这次开屏没有走穿山甲，`dspList` 实际命中的是阿里妈妈（`mamaAd`）。

这解释了为什么首版规则里 `tanx.com` 段是对的、穿山甲段暂时处于"备用"状态。也说明**只封三方域不够**——素材与会话都由一方 mtop 接口驱动。

## 竞价与其余广告

| 接口 | 职能 | 处置 |
|---|---|---|
| `mtop.taobao.idlecommerce.adx.bid` (1.0) | 三方 SDK 竞价入口，参数含 `adCodeId`、`adSlotId`、`platform`、`ecpm` | 待验证，默认不拦 |
| `mtop.taobao.idlecommerce.game.iaa.ads` | 游戏中心激励广告 | 不拦（用户主动触发） |
| `mtop.taobao.idle.home.welcome` | 首页欢迎/引导弹窗，一次投放一个 `data` 容器 → 1.0.26 起响应清空 | 社区名单（blackmatrix7）+ 已实施 |
| `mtop.idle.idleadv.scene.restore` | 场景恢复弹窗（启动后 restore 上次弹层）→ 1.0.26 起响应清空；同族的 `idleadv.app.launch.report` 是上报，不动 | 社区名单（huijingfei）+ 本机日志 |
| `mtop.taobao.idle.live.home.ads.material.get` | 直播广告素材 | 待验证 |
| `mtop.alimama.zz.ad.get` | 阿里妈妈推荐位取数（`munion.taosdk`） | 待验证 |
| `mtop.idle.ad.click` / `.expose` / `.failed.batch.*` | 广告点击与曝光埋点 | 不拦 |
| `mtop.taobao.idlemtopsearch.search.shade` | 搜索结果遮罩广告位 | 待验证 |

**`adx.bid` 默认不拦**：它是出价请求，不是素材请求。拦掉可能让 SDK 退回非竞价瀑布流，广告位照样填充，甚至因为缺少竞价记录导致 eCPM 帧率下降。是否有效只能真机对照。

信息流 / 搜索 / 详情里的广告卡由阿里妈妈 native 模板下发，卡片数据可能随 feed 响应一起返回（`isAliMaMaAD` 为点击路由标记，不是数据开关），也可能走 `zz.ad.get` 单独取数。**未抓包前不能定规则**：拦 `zz.ad.get` 有可能把正常商品推荐一起打掉。

## 域名

| 域名 | 说明 | 处置 |
|---|---|---|
| `acs.m.taobao.com`、`guide-acs.m.taobao.com`、`trade-acs.m.taobao.com` | mtop 网关（闲鱼仍用淘宝网关） | 不拦 |
| `g-acs.m.goofish.com`、`h5.m.goofish.com`、`api.goofish.com` | 闲鱼自有域 | 不拦 |
| `sf3-fe-tos.pglstatp-toutiao.com` | 穿山甲素材与模板静态资源（包内 61 处） | `REJECT-DICT` |
| `api-access.pangolin-sdk-toutiao{1,-b}.com`、`3log-api` / `5log-api` | 穿山甲竞价与日志 | `REJECT-DICT` |
| `gdt.qq.com` | 优量汇 | `REJECT-DICT` |
| `click.tanx.com`、`ef-dongfeng.tanx.com` | TanX / 阿里妈妈交易侧 | `REJECT-DICT` |
| `gw.alicdn.com`、`cdn-img.ingoofish.com`、`heic.alicdn.com` | 商品图与素材 | 不拦 |
| `adash.m.taobao.com`、`h-adashx.ut.taobao.com`、`adashx.m.taobao.com` | 阿里系埋点与归因 | 不拦 |
| 快手 / 倍孜 / Sigmob 投放域 | 包内无明文，组件与 GroMore adapter 存在 | 待抓包补入 |

## 明确不拦截

| 对象 | 原因 |
|---|---|
| `mtop.taobao.idle.home.firstdata` / `.nextfresh` / `.nextnearby` | 首页主数据与分页，广告卡混在其中 |
| `mtop.taobao.idle.item.recommend.list`、`mtop.taobao.detail.data.get` | 推荐流与商品详情 |
| `mtop.taobao.idlemtopsearch.*`（除 `search.shade`） | 搜索结果主链路 |
| `mtop.idle.trade.*`、`mtop.idle.x.message.*` | 交易与消息 |
| `mtop.alibaba.ucc.*`、`mtop.idle.idleadv.*` | 账号与推送保活 |
| `h5.m.goofish.com`、`pages.goofish.com` | H5 容器与页面 |
| `gw.alicdn.com`、`img.alicdn.com` | 商品图 CDN |

## 会失效的功能

| 功能 | 原因 |
|---|---|
| 开屏广告、开屏品牌彩蛋 | 目标，已消除 |
| 三方 SDK 开屏兜底（穿山甲 / 优量汇 / 倍孜） | 域名拦截与广告池清空 |
| 「看广告领闲鱼币 / 权益」 | 若依赖 `game.iaa.ads` 或 `adx.bid`，后续开启拦截时会失效；当前默认不拦，功能保留 |

## 安装

闲鱼规则已并入合集插件，**装合集即覆盖，不另装模块**：

1. Loon → 配置 → 插件 → 添加 `RedCognitio-Ads.plugin`（或 `-ghproxy` / `-jsdelivr` / Debug 同名文件）。
2. 确认开关「闲鱼-去广告」为开；需要抓响应时改用 Debug 合集并打开「闲鱼-调试」。
3. 确认 MITM 已开、CA 已信任，hostname 里有 `goofish.com` / `*.goofish.com`（插件已带）。

### 装没装，用日志一行就能确认（2026-10-31）

2026-10-31 那份 `2026-10-31 11_34_24.log` 里闲鱼一条规则都没生效——当时的合集还不含闲鱼，
配置里也没有独立模块。用这份日志当反例，两条命令就能判定：

| 判据 | 该日志里的值 | 含义 |
|---|---|---|
| `Load plugin:` 行 | 只有「RedCognitio 去广告合集（Debug）」「…（ghproxy 镜像）」「AWAvenue Ads Rule」 | 没有闲鱼模块（当时必须另装） |
| `Load MITM Domains` 列表 | 有 `*.taobao.com`，**没有** `goofish.com` / `*.goofish.com` | 闲鱼侧 MITM 未生效 |
| `Load N rules. N scripts. N rewrites` | `1056 rules / 10 scripts / 41 rewrites` | 合集 Debug 构建当时的规模，闲鱼规则一条没进来 |
| `idlecommerce` / `goofish` 字样 | 0 | 规则与流量都没有 |

```sh
grep -A40 "Load MITM Domains" ~/path/to/loon.log | grep -c goofish   # 0 → 闲鱼 MITM 没生效
grep -c "idlecommerce" RedCognitio-Ads.plugin                        # 0 → 装的是旧版合集
```

## 规则归属

合集插件的 `[Argument]` / `[Rule]` / `[Rewrite]` / `[Script]` / `[MITM]` 里各有一段闲鱼内容：

| 位置 | 内容 |
|---|---|
| `[Argument]` | `xianyu_enable`（默认开）、`xianyu_debug`（默认关，仅 Debug 构建） |
| `[Rule]` | `goofish.com` / `taobao.com` 的 QUIC 降级；穿山甲 / 优量汇 / TanX / pglstatp 域名拦截 |
| `[Rewrite]` | 开屏池清空、信息流广告卡（`nextfresh` / `newitem.page` / `local.home`）、搜索广告（`idlemtopsearch.search`）共 5 条 |
| `[Script]` | Debug 构建注入 `xianyu-debug.js` / `xianyu-dump.js` / `xianyu-feed-probe.js` |
| `[MITM]` | `goofish.com`、`*.goofish.com` |

诊断脚本：

| 脚本 | 输出 |
|---|---|
| `scripts/xianyu-debug.js` | `XYDEBUG` 记录进入广告接口的请求方法与本 URL |
| `scripts/xianyu-dump.js` | `XYDUMP` 按 1200 字符切段打印广告接口完整响应 |
| `scripts/xianyu-feed-probe.js` | `XYFEED` 只输出卡片类型与广告相关键，不回显正文 |

**范围只到去广告。** 社区的「净化」类规则——整段推广位拒绝（猜你喜欢、购买推荐、播放页推荐、策略位、同城角落、搜索底纹）、圈头白名单、顶栏精简——会让整块内容消失，超出「去广告」的预期，一律不纳入。判断标准只有一条：这张卡标记为广告就删，否则原样留着。

## 验证方法

1. `npm test`（`tests/xianyu.test.js` 覆盖开屏清池、异常响应直通、信息流/搜索广告卡过滤、诊断脚本）。
2. 抓包二选一：
   - **WireGuard 全量**：`MITM_MODE=wireguard bash tools/start_mitm.sh xianyu-wg`，手机装 WireGuard App 导入打印出的配置。能抓到 anet 业务请求。
   - **Loon 侧诊断**：装 Debug 合集并打开「闲鱼-调试」，日志里看 `XYDUMP-*` / `XYFEED`。无需 Mac。
3. 冷启动 3 次，确认 `idlecommerce.splash.ads` 与 `.async.ads` 的实际 host、请求体 `dspList`、响应 `adMap` 结构。
4. 装规则后清一次 App 缓存，再冷启动 3~5 次，确认开屏消失且首页、详情、搜索、消息、交易正常。
5. 若开屏仍在：先看 `splash.ads` 是否命中 rewrite；再看是否只剩三方 SDK 直投（此时补域名段）。

### 7.27.96.8 → 7.28.86.1 的开屏差异（2026-11-09 复核）

用同样方法取到 7.28.86.1（`cms/app_version` 接口 + `pbdump` 读 `version_list[].9`），比对结论：

| 项 | 结果 |
|---|---|
| `SplashAdController` 方法集合 | **与 7.27 完全一致**（方法签名 diff 为空） |
| 开屏接口 | 仍是 `mtop.taobao.idlecommerce.splash.ads`（2.0，版本改成 `DinamicExpression.currentVersion` 动态表达式）与 `splash.async.ads`（1.0） |
| 新增 `mtop.taobao.idlecommerce.splash.config`（1.0） | **只被 `com.taobao.idlefish.web.plugin.WVPrivacyManagerPlugin` 调用**（WebView 隐私插件，`needLogin=true`），与原生开屏无关 |
| `SplashAdConfig`（click/shake/slide/area） | 两个版本都有 |
| 新增类 | `SplashAdAssetManager`、`MD5CacheFileCheck`、多种 trigger（`AbsBaseTrigger` / `AbsSlideTrigger` / `OriMultiAzimuth|Pitch|Roll`…） |

**结论：开屏链路与包版本无关。** iOS 上抓不到 `splash.ads` 请求，只可能是传输层（ANet 长连接 / QUIC）或本地缓存（MtopCachePrefetch / MMKV 素材），不是"只有 iOS 被喂了新版本"。

AB 侧佐证：`AB_NEW_SPLASH_AD` 的 `[0,999999]` 分组同时给 `android_on=true` 与 `ios_on=true`（两端全量），而 `AB_NEW_SPLASH_AD_V2`、`AB_SPLASH_AD_NEW_PLAYER` **只有 `android_on`** —— 安卓比 iOS 还多两档。

---

## 请求为什么看不见：域名是写死的，IP 是 AMDC 发的（1.0.36）

用户质疑得对——包里不可能全动态。7.28.86 检索结果：

| 类别 | 包里写死的 | 出现次数 |
|---|---|---|
| mtop 网关域名 | `acs.m.taobao.com` / `guide-acs.m.taobao.com` / `acs.wapa.taobao.com` / `g-acs.m.goofish.com` / `g-acs.wapa.goofish.com` / `acs.wapa.goofish.com` / `acs.m.goofish.com` | 45 / 23 / 6 / 1 / 1 / 1 / 1 |
| 调度域名 | `amdc.m.taobao.com` / `amdc.alipay.com` / `amdc.wapa.taobao.com` / `amdc.taobao.net` | 3 / 5 / 1 / 1 |
| 素材/页面 | `gw.alicdn.com` 373、`img.alicdn.com` 63、`ossgw.alicdn.com` 54、`heic.alicdn.com` 19、`cloud.video.taobao.com` 14 … | — |
| 硬编码 IP | `203.107.1.1`（阿里 DNS）、`47.246.64.x`/`47.246.103.x` 一批、`59.82.31.182`、`203.119.244.197` | 少量 |

而日志里真正连的那些 IP —— `59.82.113.219`、`203.119.238.12`、`14.29.63.50`、`59.82.9.32` —— **在包里检索结果为 0**。也就是说：

- **域名层是写死的**（可以拦、可以 MITM）；
- **IP 层是 AMDC 下发的**，而 **AMDC 走明文 HTTP**（`http://59.82.113.219/amdc/mobileDispatch?appkey=12431167&v=6.5&appVersion=7.28.80&cv=1`）。

所以在 1.0.36 里给 AMDC 加了 request/response 抓取（`XYDEBUG` / `XYDUMP`）：它的响应里就有网关 IP、协议（spdy/h2/quic）、权重和降级开关——这才是“为什么请求走了 IP 直连”的源头，也是「能不能把流量赶回可 MITM 的命名主机」的唯一依据。

---

## AMDC 响应为什么读不出来，以及 1.0.37 的对策

1.0.36 抓到 45 条 AMDC 响应，全部是 **base64(zstd)**：解码后 magic `28 b5 2f fd`，FHD 的 `Dictionary_ID_flag=3`（带非零 dictID）。把 dictID 抹掉再解，zstd 直接报 `Dictionary is corrupted` —— 说明**真的用字典压的**，而字典不在包里：

- `dex`（11 个）、`assets`（base APK 153 MB 全解）、`lib/arm64-v8a` 156 个 `.so` 全部检索 `37 a4 30 ec`（zstd 字典 magic）→ **0 命中**；
- 所以字典要么由 `mtop` 动态 bundle 下发，要么在 iOS 侧另有实现。

绕过办法（1.0.37，仅 Debug 构建）：把 AMDC 请求的 `cv` 由 1 改成 0——

```ini
request if ${xianyu_debug} == true && ${url} ~= /^(.+[?&]cv=)1(.*)$/i as amdcCv then url.replace("${amdcCv.1}0${amdcCv.2}")
```

若 `cv=0` 返回明文 JSON，就能直接读到 `dns` / `service` 字段里的网关 IP、协议与权重，不必再碰压缩。

顺带确认：**不带设备签名直接 curl AMDC 只会拿到 `{"code":1001,"dns":[],"service":[]}`**（164 B），说明调度结果与设备签名绑定，必须从真机侧读。

---

## 实验开关：打断 ANet 长连接（1.0.34 上线，1.0.35 默认关闭）

Loon 的 `[Rule]` 段不支持 `if ${switch} == true`，所以这条实验只能做成构建级开关：模板里用 `# @debug-only-begin` / `# @debug-only-end` 包住，`tools/build.mjs` 的 `applyDebugOnlyBlocks()` 负责 Release 整段剥掉、Debug 保留。

**2026-11-09 15:46 实测结果（结论：探针无效，但暴露了更重要的事实）**：

```
15:46:33.984  Reject domain:acs.m.goofish.com in DNS phase   （共 4 次）
```

- 规则确实生效（DNS 阶段拒绝，不是 `match policy:REJECT`）；
- **App 全程正常使用**（用户正常浏览），`h-adashx.ut.taobao.com/upload` 仍有 19 次曝光上报；
- 但可解密的 mtop 只剩 `mtop.common.getTimestamp` 18 次，其余业务请求一条都看不到；
- 同期的「不可见连接」很密：`203.119.238.12:443` ×32、`14.29.63.50:443` ×16、`14.29.63.51` ×13、`59.82.9.32` ×17，全部 `Titan sniff miss`；
- `msgacs.m.taobao.com` 也有 18 次 `Titan sniff miss`。

**真正的结论：闲鱼主业务走 IP 直连 / ANet 长连接，域名拦截拦不住它（会自己绕过），所以拿「拒域名」做探针不成立。** 这也解释了为什么历次日志里从未出现过 `idlehome.home.nextfresh`（首页主数据）——它一直在不可见通道里，只有少量启动期接口（`rule.config` / `user.init` / `idleadv.app.launch.report`）落在命名主机上被解密。

要区分「开屏请求被长连接藏了」还是「本地缓存命中」，正确的对照是**重装闲鱼**（清掉 MMKV / prefetch 缓存）后首次冷启动，而不是断网关。

---

## 包内静态分析：开屏开关在哪（2026-11-09）

样本 `samples/xianyu/xianyu.xapk`（apktool + jadx，见 `../XIANYU-STATIC-ANALYSIS-20261109.md`）。代码级结论：

| 结论 | 依据 |
|---|---|
| 冷启动「曝光在、请求不在」的机制是 **`MtopCachePrefetch.usePrefetch()` 命中**：命中即用缓存直接展示并 return，不发 `splash.ads` | `SplashAdController.requestAndShow()` |
| 预取总闸是 AB `SPLASH_AD_PREFETCH.is_on` | `com/taobao/fleamarket/swtch/SplashAdPrefetchSwitch` + `registerHotStart()` |
| 热启动开屏总闸是 Orange 组 `splash_ad` 的 `disableHotStart`，另有 `splashCoverOn` / `thirdAdPlusOn` / `thirdCsjOn` / `thirdYlhOn` | `com/taobao/fleamarket/swtch/NewSplashAdOrange` |
| Orange 配置走 **ANet**（`com/taobao/orange/sync/NetworkInterceptor` 实现 `anetwork.channel.interceptor.Interceptor`；会话协议在 `ConnType` 里是 spdy/h2/http3/quic），日志里只有 DNS → **MITM 改不到**：不是加密问题，是帧不是 HTTP | `com/taobao/orange/sync/NetworkInterceptor.java`、`anet/channel/entity/ConnType.java`、`anet/channel/Session#sendCustomFrame` |
| 三方开屏有硬编码广告位兜底：`adPlusSpaceId=115982`、`ylhSpaceId=2138110733853185` | `splashad/tool/ConfigCache`（SP `splash_ad_config_cache`） |
| 开屏状态分散在 4 个 SP（`splash_ad_prefetch` / `splash_ad_orange` / `splash_ad_config_cache` / `splash_ad_preview`）→ App 内「清除缓存」清不到 | 同上各类的 `getSharedPreference` |

因此与知乎的差异：知乎的广告总闸在 HTTPS 的 `config/all`（可改写），闲鱼的橙子配置在长连接里（改不到）；唯一走 mtop 的开关是 AB 的预取闸。

顺带把「能不能用接口关掉 ANet 长连接」也查了：开关是 `enableSpdy`，`SwitchConfig.isGlobalSpdySwitchOpen() = LocalConfig.enableSpdy && RemoteConfig.enableSpdy`，而 `RemoteConfig` 的唯一来源是 `MtopConfigOrangeListenerImpl`（Orange 组 `mtopsdk_android_switch`）——**下发通道就是改不到的那条**；本地副本在明文 SP `MtopConfigStore`（`ConfigStoreManager`），所以只有 hook 或越狱改本地才生效。详见 `../XIANYU-STATIC-ANALYSIS-20261109.md` §7.6。1.0.29 起「闲鱼-调试」增抓 `mtop.alibaba.motu.ab.config.get` / `mtop.taobao.idle.ab.config.get` / `idle.mach.advertise.*` / `idle.play.ad.event.*` / `idlehome.home.pop.interest.upload`，先看清 AB 结构再决定要不要改 `is_on`。

---

## 社区方案对照（2026-10-26）

搜到的三个相关仓库，结论直接改写了首版设计：

| 来源 | 内容 | 对我们的影响 |
|---|---|---|
| [Wansensr/loon-goofish-adblock](https://github.com/Wansensr/loon-goofish-adblock) | 可莉（kelee.one）`FleaMarket_remove_ads` 的逐条自托管镜像，24 条复写（7 `reject_dict` + 15 `response.json.jq` + 2 `response.json.delete`） | 拿到信息流/搜索的字段名与判定依据 |
| [panjin9395/loon-splash-adblock](https://github.com/panjin9395/loon-splash-adblock) | 20 款 App 的开屏规则合集，闲鱼部分写明「曾一次有效，后复发，原因待定位」 | **证实只拦请求会复发**，验证了清缓存的必要性 |
| [carlleilzj/xianyu-rules](https://github.com/carlleilzj/xianyu-rules) | 16 条分流规则，无广告拦截 | 仅作域名参考 |
| blackmatrix7/ios_rule_script | `rule/Loon/XianYu/XianYu.list` 只有 16 条 `DOMAIN-SUFFIX` 分流，`rewrite/` 下无闲鱼 | 社区通用规则集确实不覆盖闲鱼广告 |
| AWAvenue-Ads-Rule | 全文检索 `goofish` / `idlefish` 命中 0 条 | 同上 |
| [huijingfei/Shadowrocket-Rules](https://raw.githubusercontent.com/huijingfei/Shadowrocket-Rules/main/sr_app_ad.conf)（2026-11-09 复检） | `acs.m.goofish.com/gw/mtop.taobao.idlecommerce.splash` 与 `mtop.idle.idleadv.(.*)` 两条 `REJECT-DICT`；`cloud.video.taobao.com/vod/*.mp4` 素材规则 | 采纳 `idleadv` 覆盖范围（但改空池）；确认视频素材域是 `/play/` 而非 `/vod/`，社区写法漏了 |
| [blackmatrix7 AllInOne](https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rewrite/Stash/AllInOne/AllInOne.stoverride)（同上） | `acs.m.taobao.com/gw/mtop.taobao.idle.home.welcome/` → reject | 采纳 `idle.home.welcome`（首页欢迎弹窗）做响应净化 |
| [Y123456-hzy/GY AdBlock](https://gist.github.com/lok347/715284a45ac1667ae2ceffba6114e0be)（同上） | 闲鱼 `splash` 走响应脚本清容器；`acs.m.goofish.com` 进 `force-http-engine-hosts` | 印证「响应清洗而非 reject」的方向一致 |
| [TanCan1998/uxian「U 闲」](https://github.com/TanCan1998/uxian)（libxposed，GPL-3.0，实测 7.28.80/525、7.28.91/529） | `AdBlocker.kt` hook `SplashAdController.{loadSplashAd,loadSplashAdHotStart,requestAsyncSplashAd,requestAndShow}` 与 `SplashAdShower.{showSplashAd,showCover}`，另禁摇一摇（只拦 `ShakeNewTrigger`） | **调用链与我们 jadx 结论完全一致**；补两点：广告数据预取进 `files/mmkv/splash_ad_mmkv`（清接口响应没用）、`SplashAdAssetManager` 是开屏与激励视频共用（不能按 download 全拦） |
| [Lotuszn/piggyhand-fish「咸鱼小猪手」](https://github.com/Lotuszn/piggyhand-fish) | 同名五个入口 + 展示层兜底；强调拦断后要主动 `runActionsAfterSplashAd()`，否则外部链接冷启跳详情会卡住 | 印证「缓存命中路径可绕过 Controller 直接调 Shower」；副作用清单比我们全 |
| 威锋帖 / 社区教程（文件层） | iOS `Documents/FishAd/FishSplashAd`、`Documents/xadsdk`；Android `files/ad`、`files/splash_ad_assets`、`cache/beizi` | 「清缓存没用」的落盘位置；iOS 想清干净必须动沙盒 |
| 2026-11-09 15:09 本机日志（装 1.0.30） | 93 秒内零开屏接口；首次抓到 `idleadv.app.launch.report` 响应体（`data` 只有 `attributeSuccess`，纯上报，每 30 秒一次）；`abtest.alibaba.com` 有标准 TLS（alpn http/1.1）但此前不在 MITM，全部 url 为 null | 1.0.30 把 `abtest.alibaba.com` 加进 MITM（AB 实验的另一条通道）；dump 名单补 `idle.rule.config`/`user.init`/`idlehome.home.(config|circle.list)`/`emas.publish.update.*`。详见 `../LOG-REVIEW-20261109-1509-XIANYU.md` |
| 2026-11-09 12:24 本机日志（装 1.0.28 后） | 闲鱼 UA 的 `h-adashx.ut.taobao.com/upload` 2 分钟 **15 次**（曝光在），但 `idlecommerce`/`splash`/`idleadv`/`nextfresh` 仍 **0**，mtop 只有 19 条；`ossgw` 已能解密，抓到的是 `creatives-assets/…?getAvatar=1` 头像；全日志 `match policy:REJECT` **0 条**、`RemoteUDP proxy:DIRECT` 频繁 | 与 11-04 同一指纹：曝光在、拉取不在。新增认知：QUIC/UDP 这一轮**直通**（既没拒也没解密），开屏接口可能就藏在这条无日志链路里，见 `../LOG-REVIEW-20261109-1224-XIANYU.md` |
| 2026-11-09 12:03 本机日志 | 清缓存后仍出广告，但全日志 `idlecommerce` / `idleadv` / `splash` 命中 **0**；启动首秒 `video.goofish.com` 12 条连接、3 秒后 `ossgw.alicdn.com`，另有阿里 IP 直连 `Titan sniff miss` 一批 | 开屏可能走 IP 直连（不可解密）或素材域直下；1.0.28 把 `ossgw.alicdn.com` 加进 MITM 观察，见 `../LOG-REVIEW-20261109-1203-XIANYU.md` |

### 网关主机名被社区规则修正

可莉插件的 MITM 是 `acs.m.goofish.com, g-acs.m.goofish.com`，而不是 `acs.m.taobao.com`。我们静态分析时在 dex 里只捞到 `g-acs.m.goofish.com` 一次，误判成零星出现。实际闲鱼业务网关就是自有域，淘宝网关只承载少量公共接口（`mtop.common.getTimestamp` 之类）。

规则本身按路径匹配，不受影响；MITM 段已同时覆盖两套域名。

### 为什么我们的开屏规则和社区不同

社区做法：`request ... reject_dict(200)` 只打同步接口 `splash.ads`，不碰 `splash.async.ads`。

我们的做法：响应层清空 `adMap` / `cacheAdInfo` / `realTimeAd`，同步与异步都覆盖。

依据是 `SplashAdController` 的代码路径：同步失败 → `requestAsyncSplashAd()` 补一次异步预取 → 异步响应只做一件事，把素材写进 `SplashAdCacheManager` → 下次启动服务端通过 `cacheAdInfo` 直接指定播放缓存素材。所以只拦同步接口，缓存会一直有货，这正是 panjin 仓库记录「一次有效后复发」的机制解释。

清响应则是双向的：本次 `adCount()=0` 不播，且把空池写回缓存，把缓存也清掉。

### 采用与不采用

采用（只保留「广告卡」判定，都有社区实机使用背景）：

| 目标 | 处理 |
|---|---|
| `idlehome.home.nextfresh` | 剔除 `cardType = mamaAD / homeMultiBanner` |
| `idlehome.home.newitem.page` | 剔除 `cardType = mamaAD / banner` |
| `idle.local.home` | 剔除 `template.cardEnum = ads` |
| `idlemtopsearch.search` | 剔除 `dislikeFeedback...bizType = "ad"` |

不采用：

| 社区做法 | 原因 |
|---|---|
| 模板名白名单（`.template.name == "idlefish_home_new_commodity_card"` 之类） | 接口换模板会整屏空白；改为按广告类型剔除，正常卡片全保留 |
| `homeTopList` 只留 `kingkongDo`、`local.home` 要求 `cardType == "common"` | 同上，把内容裁到白名单 |
| 整段推广位 `reject_dict`（猜你喜欢、购买推荐、播放页推荐、策略位、同城角落、搜索底纹） | 整块内容消失，属功能裁剪而非去广告；用户要求先只做去广告 |
| `idlehome.home.circle.list` 圈头白名单、`magic.home.page.list` 删 `topList`、`search` 删 `resultPrefixBar` | 界面精简，与去广告无关 |
| `idle.user.page.my.adapter` 的「我的」页大段重排 | 同上 |
| `idlemtopsearch.search.discover` 的 `MarketHotSpot` | 该接口在 7.27.96.8 包里已不存在 |

### 社区「接口已死」结论与包内证据不符

可莉镜像仓库 README 称 6 条接口在当前版本已不存在（无签名探测网关路由表，返回 `FAIL_SYS_API_NOT_FOUNDED`）。用 7.27.96.8 的 dex 字符串核对，其中 5 条仍在包里：

| 接口 | 包内 | 说明 |
|---|---|---|
| `idlehome.home.nextfresh` | ✅ | `ApiBusiness` 有 `mtop.taobao.idle.home.nextfresh/3.0` → `mtop.taobao.idlehome.home.nextfresh/4.0` 的改名映射 |
| `idle.item.recommend.list` | ✅ | — |
| `idle.local.home` | ✅ | — |
| `idlemtopsearch.search.shade` | ✅ | — |
| `idle.item.search.activate` | ✅ | — |
| `idle.trade.full.info` | ✅ | — |

未在包里找到的只有 `idle.fun.follow.feed.list`、`idlehome.home.community`、`idlehome.home.newitem.page`、`idle.user.page.my.adapter`、`idlemtopsearch.search.discover`。但 `newitem.page` 与 `my.adapter` 在社区规则里仍在使用，说明 dex 字符串提取会漏（部分接口名是运行时拼接）。**结论：以真机命中日志为准，不以网关探测或字符串提取定生死。**

## 抓包观察清单

真机抓包时按这份清单核对，能一次收敛大部分未知：

1. `idlecommerce.splash.ads` 的实际 host（`acs.m.taobao.com` / `g-acs.m.goofish.com`）与请求参数 `dspList`，响应 `adMap` 与 `spaceIdMap` 的真实字段。
2. `idlecommerce.splash.async.ads` 是否在 Wi-Fi 下提前发出，以及它写入的缓存键（决定清缓存能否一次生效）。
3. 开屏出现瞬间是否有 `ssp.iytcdn.com` / `mmstat` 请求（判定阿里妈妈 SS 是否独立出开屏）。
4. `mtop.taobao.idle.home.firstdata` 响应里广告卡的位置与标识：搜 `advId`、`isAliMaMaAD`、`knowledge_ad`、`cardType`，确认卡片是随 feed 下发还是 `zz.ad.get` 单独取。
5. `mtop.alimama.zz.ad.get` 的 `scene` / `pid` 取值，以及它在信息流首屏出现几次。
6. 快手 / 倍孜 / Sigmob 是否有请求（包内无明文域，只能靠抓包补）。

## 待办

- 用 WireGuard 模式或 Debug 合集的「闲鱼-调试」重抓一次，拿到 `splash.ads` / `nextfresh` 的真实请求参数与响应体，核对社区字段名（`cardType`、`cardEnum`、`bizType`）是否与 7.27 版一致。
- 装规则后重点看首页：广告卡是否消失、正常商品卡是否还在。本模块不动任何整段内容，若首页仍见广告，多半是卡片类型码变了，用 `XYFEED` 日志现场核对。
- 抓包补全快手 / 倍孜 / Sigmob 投放域。
- 确认信息流广告卡是随 feed 响应下发还是 `zz.ad.get` 单独取数，再决定是否做响应净化。
- `adx.bid` 做 A/B：拦与不拦各冷启动 5 次，比对开屏与信息流广告出现次数。
- 真机验证通过后接入合集（新增开关、更新构建断言、README 应用列表）。
