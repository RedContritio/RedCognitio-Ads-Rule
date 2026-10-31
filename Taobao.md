# 淘宝 广告拦截

样本 `com.taobao.taobao` 10.68.0

## 接口协议：mtop

淘宝全部业务与广告接口走 mtop，请求形如：

```
https://<网关>/gw/mtop.<api名>/<版本>/?…
```

| 特征 | 内容 |
|---|---|
| 定位方式 | API 名位于**路径**中，故可路径级拦截 |
| 网关 | `acs.m.taobao.com`、`guide-acs.m.taobao.com`、`trade-acs.m.taobao.com`、`h5api.m.taobao.com`、`acs.wapa.taobao.com`，多主机轮换 |
| 加密 | 参数与响应体可加密（`secType` / `SecBody`），**路径恒为明文** |
| 规模 | 包内共 657 个 mtop API 名 |

## 拦截目标

### 开屏（四条独立链路）

| 链路 | 接口 | 素材字段 |
|---|---|---|
| 图片 | `mtop.taobao.wireless.home.splash.awesome.get` | `data.containers.splash_home_base.base.sections[].bizData["taobao-splash"].data[].imgUrl` |
| 视频 | `mtop.taobao.cloudvideo.video.query` | `data.duration` / `resources` / `caches` |
| 活动 | `poplayer.template.alibaba.com/*.json` | `res.images` / `res.videos` / `mainRes.images` / `enable` |
| TopShow | `mtop.alimama.topshow.query`、`.interact` | 阿里妈妈顶展，实现于 `com/taobao/mmad/TopShowBootImage` |

TopShow 的开屏职能可由日志确认：`TopShowInsert#shouldColdStartShow`、`TopShowInsert#disableInsert topViewSplashSection null`、`TopShowInsert#getSeekTime splashVideoCurrentPosition`。

### 跳脸彩蛋

poplayer 子系统，由框架层与应用层构成：

```
com.alibaba.poplayer        ConfigFetcher / ConfigManager / PageTriggerService / OnePopModule
com.taobao.tbpoplayer       MtopPopCheckHelper / PopLayerWebView / PopLayerWeexView2
                            nativerender/dsl / watermask（广告角标）/ nativepop
```

配置下发接口：`mtop.taobao.poplayer.xdsl`，下发弹层的结构、触发条件、样式与频控策略。

### 域名

| 域名 | 说明 |
|---|---|
| `heic.alicdn.com` | 开屏全屏图，HEIC 分发省流量，文件名含手机全屏尺寸 |
| `poplayer.template.alibaba.com` | poplayer 远程模板 |
| `adashx.m.taobao.com`、`adashbc.ut.taobao.com`、`h-adashx.ut.taobao.com` | 淘系广告分析（通用规则集已覆盖） |
| `ef-dongfeng.tanx.com`、`ifs.tanx.com` | 广告交易（通用规则集已覆盖） |
| `alimama.com`、`adash.m.taobao.com` | 阿里妈妈与广告分析（未覆盖） |

## 关键结论

**开屏不可用 REJECT。** 接口失败会触发客户端兜底素材——包内 `AdFallbackMaterial` 与 `FromType` 的 `FROM_CACHE` / `FROM_APK` / `FROM_LAUNCHER` 分支即为此设。须返回 200 + 结构完整但素材字段为空，即响应净化。

**开屏是多链路产品，不是单接口。** 已确认四条独立链路。凡季节性运营插入（双11 / 618 / 年货节）都应假设存在独立投放链路，逐一枚举必然遗漏。

**容器 ID 在响应体，不在 URL。** `splash_home_base` 是 `splash.awesome.get` 响应内的容器键。故不能按容器平台接口（`mtop.cogman.container.*`）拦截——同一接口下混有首页容器，拦截会废掉整个应用。

**启动图可读自缓存**（`FromType` 含 `FROM_CACHE`，日志 `ColdStart start loadAdCache`）。装规则前已下好的素材不会立刻消失，须清缓存后验证。

## 明确不拦截

| 对象 | 原因 |
|---|---|
| `mtop.taobao.wireless.home.awesome.get` | 首页主数据 |
| `mtop.taobao.wireless.home.awesome.recommend` | 首页推荐流 |
| `mtop.taobao.wireless.home.newface.awesome.get` | 新版首页。同类规则集对其做 reject_dict，但属首页主数据入口，风险高于收益 |
| `mtop.taobao.detail.data.get` | 商品详情 |
| `mtop.alibaba.ovs.trade.carts.single.get` | 购物车 |
| `mtop.taobao.order.query.*` | 订单 |
| `mtop.taobao.search.*` | 搜索 |
| `acs` / `guide-acs` / `h5api.m.taobao.com` | mtop 网关 |
| `market.m.taobao.com`、`h5.m.taobao.com` | 会场与 H5 页面 |
| `gw.alicdn.com` | 商品图 CDN |
| `dinamicx.alibabausercontent.com` | 弹窗模板 CDN，含下单 / 支付弹窗 |

## 已知拦不到

| 对象 | 原因 |
|---|---|
| 联动开屏 | 包内 `LinkedSplashData` / `FeedsData` 与日志 `parseFeedsData: splashSnapshot` 表明开屏数据可搭信息流响应下发 |
| 首页弹窗 | `homePagePopDatas` 搭首页容器配置响应下发（`mtop.taobao.homepage.container.config.get`），拦截即破坏首页 |
| 开屏创意图 | 托管于公共图片 CDN，URL 为不透明随机 ID |

## 待测候选（未纳入规则）

### 弹窗类

| 候选 | 疑点 |
|---|---|
| `mtop.taobao.wireless.home.pop.fatigue.record` | 频控上报。**拦截可能适得其反**——缺记录会致弹窗重复展示 |
| `mtop.taobao.pentaprism.scene.query` / `.trigger` | 场景触发，疑为新一代弹层 |
| `mtop.taobao.social.pop.get` | 社交弹窗，可能含正常消息提示 |
| `dinamicx.alibabausercontent.com` | 弹窗模板 CDN，含下单 / 支付弹窗，风险高 |

### 联盟与三方

| 候选 | 说明 |
|---|---|
| `mtop.alimama.union.trace` / `.trace2` | 淘宝联盟追踪 |
| `mtop.alimama.cps.trace.ad` / `.adsdk.send` / `.ali` | CPS 追踪 |
| `mtop.alimama.topshow.query` 之外的 `zz.ad.get` | 广告获取 |
| `mtop.ali.ad.settle.*`（5 个） | 广告结算，仅上报 |
| `alimama.com`、`alimama.cloudvideocdn.taobao.com` | 阿里妈妈 |

### 其他广告位

| 候选 | 说明 |
|---|---|
| `mtop.life.ad.click.get`、`mtop.o2o.ad.action.get`、`mtop.o2o.ad.exposure.get` | 本地生活 |
| `mtop.taobao.livex.business.taolive.ad.monitor` | 直播广告监测 |
| `mtop.taobao.volvo.secondfloor.getconfig` | 二楼 |
| `adash.m.taobao.com` | 广告分析 |

### 未见于本包的 iOS 侧接口

`mtop.etao.noah.query`（含 `tao_splash`）、`mtop.alibaba.advertisementservice.getadv`、`mtop.o2o.ad.gateway.get`、`mtop.fliggy.crm.screen.*`、`mtop.taobao.idle.home.welcome`、`mtop.trip.activity.querytmsresources`

## 模块

合集插件内的淘宝段落（路径级 + 响应净化，需 MITM，Loon 3.5.1+）、`scripts/Taobao-ads-clean.js`

。淘宝-调试默认关闭；开启后输出 `TBCLEAN` 净化结果与 JSON 解析错误，随开屏及 poplayer 响应净化执行。
