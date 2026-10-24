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

`NetEase-CloudMusic-URL.module`（路径级，需 MITM）、`NetEase-CloudMusic-Domain.module`（域名级，无需 MITM）
