# 网易云音乐 广告拦截

样本 `com.netease.cloudmusic` 9.5.05

## 广告链路

广告由应用自建模块 `music_biz_ad`（`com.netease.cloudmusic.module.ad`）承载。包内**无任何三方广告 SDK**。

| 子模块 | 职能 |
|---|---|
| `boot/` | 开屏 |
| `monitor/` | 曝光监测 |
| `feedback/` | 负反馈 |
| `secondfloor/` | 二楼 |
| `textchain/` | 文字链 |
| `playerjar/` | 播放器内 |
| `link/fullegg/`、`brandegg/` | 彩蛋 |
| `rotategallery/` | 轮播 |
| `AdDeviceId` | 广告设备标识 |

资源层印证（`res/values/strings.xml`）：`hyc`=WIFI下预载、`ia`=摇一摇开屏、`gx`=跳过广告、`h0`/`h1`=负反馈、`he`=音频广告、`ip`/`j0`/`j1`=激励视频、`ihl`=广告欺诈、`hh`/`hj`=个性化广告开关。

## 拦截目标

### 接口

| 接口 | 职能 |
|---|---|
| `…/ad/loading/judge` | 开屏判定 |
| `…/ad/loading/bidget` | 竞价取物料 |
| `…/ad/loading/current`、`…/ad/loading/get` | 物料 |
| `…/ad/prefetch/select` | 预取选单 |
| `…/ad/flow/get`、`…/ad/get` | 信息流、素材 |
| `…/ad/config`、`…/ad/commonconfig`、`…/ad/materialconfig` | 配置 |
| `…/ad/monitor/…`、`…/ad/sniffing`、`…/ad/start/…`、`…/ad/device/…` | 上报 |
| `…/social/event/bff/ad/…`、`…/ichat/home/ad/list` | 社交、动态页 |
| `…/delivery/(batch-)?deliver` | 推广位 |

前缀有 `/api/` `/eapi/` `/xeapi/` `/neapi/` 多种。同一职能存在多个变体——开屏判定同时有 `/eapi/ad/loading/judge` 与 `/xeapi/ad/loading/judge`。

### 域名

| 域名 | 说明 |
|---|---|
| `iadmusicmat.music.126.net` | 素材 CDN |
| `iadmusicmatvideo.music.126.net` | 视频素材 |
| `admusicpic.music.126.net` | 素材图 |
| `iadmat.nosdn.127.net`、`iadmatapk.nosdn.127.net` | 素材 |
| `iad.service.163.org` | 曝光监测 |
| `ipv4` / `ipv6.music.163.com` | eapi 直连 IP，绕过本地 DNS 时 MITM 失效 |
| `admaster.com.cn`、`attri.mobi`、`mmstat.com`、`rtbasia.com`、`hegek7.com`、`adbug.cn`、`gridsum.com` | 三方监测厂商 |
| `miaozhen.com`、`doubleclick.net` | 通用规则集只封了子域，未封主域 |

`assets/sdkconfig.xml` 为一份 MMA（中国广告协会移动互联网广告标准）可见性监测配置，声明五家厂商，各家均采集 `MAC` / `IDA` / `IMEI` / `ANDROIDID`。可见性阈值为可视面积 >50%、图片 1s、视频 2s、窗口 120s，与代码内日志「视图可见大于50%，开始播放」一致。

## 关键结论

**开屏素材在 WIFI 下预下载并落盘**（`boot/preload/AdCookieStore`），实测缓存约 4 天。已缓存的广告不会因拦截立刻消失。

**`/ad/` 下兼有非广告功能**，故按其子路径白名单枚举，不可整段匹配：

| 子路径 | 职能 |
|---|---|
| `ad/listening/*` | 云贝中心 |
| `ad/power/*` | 打榜助力 |
| `ad/new/yunbei/*` | 云贝新版入口 |

## 配置面（有没有类似高德的「字段级关闭」）

有配置族，但没有「广告总开关」。App 判断的不是某个 boolean，而是 `/ad/loading/judge` 的判定结果 + 本地 `AdCookieStore` 里有没有在有效期内的素材。

| 接口 | 已知作用 | 字段状态 |
|---|---|---|
| `…/ad/config`、`…/ad/commonconfig`、`…/ad/materialconfig` | 广告配置下发（频控、预取、素材开关） | 字段名在包内已混淆，**需真实响应确认** |
| `…/ad/loading/judge` | 开屏判定 | 同上 |
| `…/ad/prefetch/select` | 预取选单 | 同上 |

诊断：Debug 构建里的「网易云音乐-调试」会注入 `scripts/netease-ad-probe.js`，对上述响应打 `NCMPROBE`（键名 + 三层结构，字符串截断 80 字符）或 `NCMPROBE-RAW`（加密体：长度 + 前 60 字符）。**抓配置要先把「网易云音乐-去广告」关掉**，否则这些 URL 会被 404，探针看不到响应。

拿到结构后，再决定是否像高德那样把开屏判定从「拦请求」改成「改响应」——`reject(404)` 走失败分支，`AdCookieStore` 原样保留，旧素材会照播到过期；若客户端在成功分支清池，改响应就能省掉手动清缓存。

## 明确不拦截

| 对象 | 原因 |
|---|---|
| `music.163.com` 整域 | 承载全部业务 |
| `/account/adSettings` | 个性化广告推荐设置页 |
| `…/ichat/home/adolescent/…` | 青少年模式，含 ad 但非广告 |
| `p1~p6`、`d1~d6.music.126.net` | 封面图 CDN，与广告图共用 |

## 已知拦不到

| 对象 | 原因 |
|---|---|
| `/eapi/batch` | 多接口打包在单一加密请求体内，无法按路径区分；整体拦会连带用户信息与设置 |
| `/eapi/link/position/show/resource` | 以请求体内 `positionCode` 区分推广位，但同一接口亦承载底部 tab |
| 三方开屏素材 | 已改由 `ossgw.alicdn.com`、`a1.alibabausercontent.com`、`p*.music.126.net` 等公共 CDN 下发，不可整域拦 |

## 模块

合集插件内的网易云音乐段落：路径级规则（需 MITM）+ 域名级规则（无需 MITM），Loon 3.5.1（983）+。网易云音乐-调试默认关闭；开启后以 `NCMDEBUG` 记录进入脚本的 API 请求方法与 URL。原生规则拦截记录在 Loon 请求记录中查看。
