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
| `heic.alicdn.com` | 开屏全屏图，HEIC 分发省流量，文件名含手机全屏尺寸；另有 `imgextra/i{id}/…-{尺寸}.jpg` 与 `imgextra/…\d{4}-\d{4}.jpg_<尺寸后缀>` 两种命名（1.0.26 补齐，来源见下「社区方案对照」） |
| `cloud.video.taobao.com` | 开屏/信息流视频取流：`/play/u/{uid}/p/2/e/6/t/1/{id}.mp4?sBizCode=alimama_tuijian.mp4`（本机 2026-11-07 13:36 实测，闲鱼 aliplayer 7.28.80）。同域也托管商品详情视频，故规则必须带 `sBizCode=alimama` |
| `video-zb.cloudvideocdn.taobao.com` | 上面那条的落地 CDN，路径带 `biz=tbs_vsucai`（tbs 卖家素材） |
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

### 1.0.26 新补的接口（来自社区名单，镜像里未见对应 mtop 调用）

名单来自 [blackmatrix7 AllInOne](https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rewrite/Stash/AllInOne/AllInOne.stoverride) 的 reject 段与 [GY AdBlock v6.2](https://gist.github.com/lok347/715284a45ac1667ae2ceffba6114e0be) 的 script pattern。本仓库不照抄它们的 `REJECT`（见下文「开屏不可用 REJECT」），只挑出「一次投放 = 一个 data 容器」的接口做响应净化：

| 接口 | 处理 | 来源 |
|---|---|---|
| `mtop.alibaba.advertisementservice.getadv` | 响应 `data = {}` | blackmatrix7 AllInOne / GY AdBlock |
| `mtop.etao.noah.query/…tao_splash` | 响应 `data = {}` | 同上（`tao_splash` 名字里直接是开屏） |
| `mtop.taobao.wireless.home.splash.awesome.get` | 已有：`Taobao-ads-clean.js` 净化；**1.0.26 起网关双写 `(guide-acs\|acs).m.taobao.com`** | GY AdBlock 的 `(?:(?:acs\|guide-acs)\.m\.taobao\.com/…)`；原先只写 guide-acs，acs 那一路完全不进脚本 |

**暂不动，但已接上抓取**：`mtop.alibaba.mos.app.homepage.launch`（与首页启动数据混在一起）、`mtop.o2o.ad.gateway.get`、`mtop.damai.mec.popup.get`、`mtop.film.mtopadvertiseapi.*`、`mtop.fliggy.crm.screen.*`、`mtop.trip.activity.querytmsresources`。结构未知就不该盲写净化点，所以 1.0.27 给它们接了 Debug 抓取路由（`scripts/Taobao-ads-dump.js`，`taobao_debug` 开时输出 `TBADUMP-*`），抓到一轮真实响应后再定 `data` 容器。

网关解密前提已经核对过（2026-11-04→11-09 本机日志）：`acs.m.taobao.com` 命中 `Match MITM host` **29 次**、`acs.m.goofish.com` **18 次**、`poplayer.template.alibaba.com` 4 次、`heic.alicdn.com` 9 次 —— 这些 mtop 都能抓到。例外是 `guide-acs.m.taobao.com`：**0 次解密**（19 次 QUIC 被 `AND,((DOMAIN-SUFFIX,taobao.com),(PROTOCOL,QUIC))` 拒掉、2 次 TCP 是 `Titan sniff miss`），所以开屏主链路只能靠 §社区方案对照 里 GY AdBlock 的 `force-http-engine` 思路在 Loon 侧另找等价物。盒马 `acs-m.freshippo.com`、飞猪自有域不在 `[MITM]` 内，本次日志也没出现过，先不扩。

## 社区方案对照（2026-11-09）

| 来源 | 内容 | 我们采纳了什么 |
|---|---|---|
| [blackmatrix7 · AllInOne.stoverride](https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rewrite/Stash/AllInOne/AllInOne.stoverride) | `acs.m.taobao.com/gw/mtop.…` 11 条 reject（getadv / homepage.launch / eta0_advertise / damai popup / tao_splash / taopp / fliggy / o2o.ad.gateway / idle.home.welcome / trip / wdk）；`(gw\|heic).alicdn.com/imgextra` 三条正则 | 接口名单 + `imgextra/…\d{4}-\d{4}.jpg_<尺寸>` 正则；**不采纳 REJECT 风格** |
| [huijingfei · sr_app_ad.conf](https://raw.githubusercontent.com/huijingfei/Shadowrocket-Rules/main/sr_app_ad.conf) | `ossgw.alicdn.com/creatives-assets/`、`cloud.video.taobao.com/vod/*.mp4`、`(gw\|heic\|img).alicdn.com/imgextra/…尺寸串…`、`img.alicdn.com/imgextra/…-at…` | `imgextra` 尺寸串正则；视频素材只写了 `/vod/`（本机实测是 `/play/`，已自行补） |
| [Y123456-hzy · GY AdBlock v6.2](https://gist.github.com/lok347/715284a45ac1667ae2ceffba6114e0be) | `force-http-engine-hosts` 把 `acs.m.taobao.com`/`guide-acs.m.taobao.com`/`poplayer.template.alibaba.com` 强行拉进 HTTP 引擎，再跑响应脚本；pattern 覆盖 `(acs\|guide-acs)` 双网关 | 网关双写；`force-http-engine` 是 Surge 专有能力，Loon 无对应，只能用「放行 QUIC 让客户端走 TCP」近似 |
| [myouhi · ZhiHu.sgmodule](https://raw.githubusercontent.com/myouhi/Surge/master/module/ZhiHu.sgmodule) | — | 仅作 MITM 主机清单对照 |

另：`cdn.ynuf.aliapp.org` 在 11-04~11-09 日志里每次启动都被请求，经核对是**阿里云验证码（NoCaptcha）资源域**（[官方 FAQ](https://help.aliyun.com/zh/captcha/captcha1-0/support/faq-about-the-web-frontend) 要求白名单放行），不是开屏素材，不拦。

## 模块

合集插件内的淘宝段落（路径级 + 响应净化，需 MITM，Loon 3.5.1+）、`scripts/Taobao-ads-clean.js`、`scripts/Taobao-ads-dump.js`（仅 Debug 构建）

淘宝-调试默认关闭；开启后：

| 前缀 | 来源脚本 | 内容 |
|---|---|---|
| `TBCLEAN` | `Taobao-ads-clean.js` | 开屏 / poplayer 响应净化结果与 JSON 解析错误 |
| `TBADUMP-REQ` | `Taobao-ads-dump.js` | 结构未知广告接口的请求行（host + mtop 名/版本），只打不发 |
| `TBADUMP-BEGIN` / `TBADUMP-<offset>` / `TBADUMP-END` | 同上 | 响应体按 1200 字符切段，含 status / len / content-type |

抓取名单：`alibaba.mos.app.homepage.launch`、`o2o.ad.gateway.get`、`damai.mec.popup.get`、`film.mtopadvertiseapi.*`、`fliggy.crm.screen.*`、`trip.activity.querytmsresources`、`alibaba.advertisementservice.getadv`、`etao.noah.query`、`taobao.idle.home.welcome`、`idle.idleadv.*`。Release 构建不包含这个脚本与对应路由。
