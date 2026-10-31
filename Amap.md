# 高德地图 开屏广告

维护文档。规则并入合集插件 `RedCognitio-Ads{,-debug}.plugin`，不单独拆模块——高德只有两条开屏接口，没有能常驻的广告域，拆成 `.module` 只会多一份要同步的副本。

关联开关：

| 开关 | 默认 | 作用 |
|---|---|---|
| `amap_enable`（高德地图-去广告） | 开 | 把开屏两条接口的响应改写成「今日无广告」，并借客户端成功分支清空本地素材池 |
| `amap_debug`（高德地图-调试） | 关 | 记录开屏接口真实主机名与完整响应（仅 Debug 构建） |

iOS 与 Android 共用同一套服务端接口，规则两端通用。

## 0. 一句话结论

高德的开屏不走任何三方联盟，只从阿里妈妈自建接口取；接口只有两条，都在 `*.amap.com` 上：

| # | 接口 | 触发时机 | 主机 | 素材在哪 |
|---|---|---|---|---|
| 1 | `POST /ws/valueadded/alimama/splash_screen` | 冷启动 / 热切 / Wi-Fi 预取，写入素材池 | `m5.amap.com`（AOS 主网关） | `data.ad[]` |
| 2 | `POST /ws/aos/alimama/splash_screen_rt?ent=2` | 启动瞬间同步拉取，不进池、直接播 | `amap-aos-info-nogw.amap.com`（信息专用域） | `data.custom_list[].creative[]` |

**没有单一开关字段。** 客户端的"要不要放开屏"不是读某个 boolean，而是：请求回来的 `data.*` 里有没有落在有效期内的条目（`yg2.i()` 只看本地池）。能控场的字段分两层——响应字段（§8.2）和云控字段（§8.1），后者理论上能让客户端根本不发请求，但要改 AOCS，代价大于收益，见 §8.4。

现在的做法是**改响应字段**，不是拦请求：返回 `{"code":"7","data":{}}`。客户端认 `code` 为 `1`/`7` 才算成功，进了成功分支第一件事就是删掉本地广告池（`remove("afp_splash_events")` + `dc2.m(null)`），再去解析 `data.ad`；空 `data` 就是"今天没有广告"，池子被清空、素材不下载。这比 `reject_dict` 多拿一个副作用：不用手动清 App 缓存。

**App 内设置里没有关掉开屏的开关。** 隐私设置里那两个勾选（`OAID_check` / `AD_check`）只是把 `is_personalized_oaid` / `is_personalized_ad` 置 0，请求照发、广告照出，只是不再按你的画像挑广告。证据：`com/autonavi/map/permission/PrivacyPermissionPage.java` 只写 SP 键，`SplashScreenRequest` 只把这两个键当请求参数带上。

## 1. 样本与取证

| 项目 | 值 |
|---|---|
| 样本 | `com.autonavi.minimap` 17.02.0.2010 |
| 来源 | 豌豆荚官方分发（`www.wandoujia.com/apps/279993/download`），2026-10-28 |
| 体积 / SHA-256 | 177,749,534 B / `8367a35e1279be691c036307e2acfafe8870d32eefe30986f6e186a569a64dc9` |
| 结构 | 8 个 dex（95 MB）+ `libamapmain.so` 等 native；无三方广告 SDK |
| 反编译 | apktool 3.0.3、jadx 1.5.6 |

iOS 端不可公开取包（App Store 加密 + 需 Apple ID 会话），本分析基于 Android 同版本做静态取证，接口是服务端能力、两端一致。**装好后按 §5 核验一次**，iOS 若走不同 AOS 主机，日志会直接给出真名。

旁证：社区规则 `deezertidal/shadowrocket-rules/gddt.module`（ddgksf2013）里，开屏净化目标写的是 `^https?://.*\.amap\.com/ws/valueadded/alimama/splash_screen`——不限定主机、不限平台。与本机取证出的路径一致，说明 iOS 与 Android 走同一路径、只是 AOS 主机前缀可能不同。

## 2. 开屏链路

### 2.1 链路 1：池化下发（主力）

`com.autonavi.minimap.alimama.param.SplashScreenRequest`

```java
public static final String E = ConfigerHelper.AOS_URL_KEY  // "aos_url"
        + "ws/valueadded/alimama/splash_screen";
```

`ConfigerHelper` 把 `aos_url` 映射到主机键 `aos.m5`，`e02.a("aos.m5", …)` 给出 `https://m5.amap.com/`；`assets/amap_configer.data` 里同族配置项 `loginall_url=https://m5.amap.com` 印证。

触发点（`ah5.attemptRequestData(scene)`）：

| 调用方 | scene |
|---|---|
| `com.autonavi.minimap.g#c`（热切回来） | 102 / 103 |
| `rv5`（Wi-Fi 预取） | 当前启动场景 |
| `mc1#…` | 110 |
| `SplashChildProcessVApp` | 子进程启动 |

请求参数（`AlimamaRequestHolder#sendSplashScreen`）：`rs`（屏幕分辨率串）、`dpr`、`netp`、`mnc`、`ict`（经纬度）、`it`、`bn`/`mn`/`osv`（品牌/机型/系统）、`mcc`、`scene`、`is_personalized_oaid`、`is_personalized_ad`、`last_shown_ad`、`last_shown_ts`，签名参数 `channel` / `diu` / `div`。

响应：

```json
{"code":"1","data":{"session_id":"…","ad":[{
  "cid":"…", "creative_type":"video|image", "start_time":…, "end_time":…,
  "video_url":"…", "static_img_url":"…", "dynamic_img_url":"…",
  "original_click_url":"…", "schema":"…", "realtime":0,
  "display_time":…, "button_text":"跳过广告", …
}]}}
```

`code` 只认 `"1"` 和 `"7"`（`com.autonavi.minimap.net.Callback#b`）。素材 URL 是响应里直接给的字段，域名不固定（阿里妈妈 CDN、客户自有 CDN 都有），所以**素材域名不能作为拦截目标**。

### 2.2 链路 2：实时「秒开」

`com.autonavi.minimap.b#b()` 读 SP 里的 `splash_realtime_url` + `splash_realtime_params`，用 `HttpURLConnection` 直接 POST（5s connectTimeout，UA 与主链路一致）：

```
https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?ent=2
```

这个 URL 不是硬编码常量，而是云控 `splashscreen` 模块里的 `realtime_scene_config` 命中有效期后写入 SP 的（`com.autonavi.minimap.a#g()`）。同一段代码里还有「老方案」`realtime_duration` 窗口控制。域名 `amap-aos-info-nogw` 只承载这类信息接口。

拿到即播、不进池，所以它比链路 1 更快出图——**这也是为什么只封一条时不彻底**。

注意它的素材结构和链路 1 不同：`com.autonavi.minimap.a#f()` 只读 `data.custom_list[0].creative[0]`（`sync_tag`、`image_base64`、`dsp_name`），完全没有 `data.ad`。所以两条链路要用同一个空响应体覆盖，只能给 `data` 留空对象。

### 2.3 时序

```
冷启动
 ├─ SplashActivity 起
 ├─ ah5.attemptRequestData(scene)  ──→ 链路1（异步，失败不阻塞）
 ├─ com.autonavi.minimap.b#b()     ──→ 链路2（异步，秒开）
 ├─ yg2.i(i) 读本地素材池  ← 命中就直接播，不等网络
 └─ 池空 → SplashException(NO_SPLASH) → finishSplash(NO_SPLASH) 直接进首页
```

关键点：**展示决策读的是本地素材池，不是这次请求的响应。** 新素材要等下一次启动才播。

## 3. 本地缓存与频控

- 素材池落盘在 App 私有目录 `files/splash/`（`d12.b`），ad 列表与过期时间存 SP（`afp_splash_events` / `splash_realtime_items`）。`k66.b` / `k66.c` 是 start_time / end_time，`yg2.i()` 只放行当前时间落在区间内的条目。
- 素材文件本身保留 7 天（`dc2.c()`：`lastModified > 604800000` 才删），但广告条目按 `end_time` 失效——开屏类素材一般是当日有效。
- 频控参数全在云控 `splashscreen` 模块里（见 §8.1）：`max_req_count`（默认 10）、`min_req_interval_second`、`front_switching_time_minute`（默认 1440）。日志串是「不发送请求：请求次数已达上限 / 两次间隔太近 / 本地有当日妈妈数据」。

**这条链路解释了为什么改响应比拦请求划算**：`Callback#onSuccess` 判定成功后的第一步就是 `remove("afp_splash_events")` + `dc2.m(null)`，也就是把池子和实时条目一起删掉。拦请求走的是失败分支，池子原封不动，旧广告会一直播到 `end_time`。2026-10-29 真机实测正是这个结果：装完首次启动就干净，没有"残留素材播到过期"的窗口（§5 第 4 步）。

## 4. 规则说明与取舍

合集里的实际写法（`build/RedCognitio-Ads.plugin.tpl`）：

```loon
[Rule]
AND,((DOMAIN,m5.amap.com),(PROTOCOL,QUIC)),REJECT
AND,((DOMAIN,m5-x.amap.com),(PROTOCOL,QUIC)),REJECT
AND,((DOMAIN,amap-aos-info-nogw.amap.com),(PROTOCOL,QUIC)),REJECT

[Rewrite]
response if ${amap_enable} == true && ${url} ~= /^https?:\/\/(?:[a-z0-9-]+\.)*amap\.com\/ws\/valueadded\/alimama\/splash_screen/ then response.json.jq("{\"code\":\"7\",\"data\":{}}")
response if ${amap_enable} == true && ${url} ~= /^https?:\/\/(?:[a-z0-9-]+\.)*amap\.com\/ws\/aos\/alimama\/splash_screen_rt/ then response.json.jq("{\"code\":\"7\",\"data\":{}}")
```

### 4.1 为什么改响应而不是 reject

- `reject_dict(200)` 让客户端走失败分支（`invalid_resp` / `req_fail`），**不碰本地池**，已有素材照播到 `end_time`，必须手动清 App 缓存才干净。
- 改写成 `{"code":"7","data":{}}` 走成功分支，客户端自己清池（见 §3），并且因为 `data.ad` 为空，也不去下载素材。
- 与淘宝的取舍不同：淘宝开屏接口失败会触发内置兜底素材，只能做响应净化；高德没有内置兜底，但**有本地池**，所以净化要连带清池才有意义。

### 4.2 开关与常驻规则的分工

- `amap_enable` 只管两条响应规则。关掉开关，开屏恢复，其余规则不受影响。
- 三条 QUIC 降级常驻、不受开关控制——QUIC 不能 MITM，不常驻则开关一开也不生效。只降级 `m5.amap.com`、`m5-x.amap.com` 与 `amap-aos-info-nogw.amap.com`，不动 `*.amap.com` 全域：`m5` / `m5-x` 同时承载地图瓦片、检索、导航、账号，全域降级等于把整机高德流量从 h3 拉回 h2。

### 4.3 MITM 范围

`[MITM]` 只追加 `m5.amap.com`、`m5-x.amap.com` 与 `amap-aos-info-nogw.amap.com`。`m5-x` 是 1.0.16 补的：iOS 17.01.x 把 AOS 批量请求挪到了这台机（见 §9）。若再换主机（例如 `m5-zb.amap.com`、`aos.amap.com`、`pre-gateway-x.amap.com`），响应规则会因为「没解密」静默不生效——§5 的核验就是查这个。补主机名不用改正则：两条正则都按 `*.amap.com` 后缀写。

### 4.4 为什么不封素材 CDN

`gw.alicdn.com`、`aoscdn.amap.com`、`aos-cdn-image.amap.com` 是通用图床：开屏素材、地图皮肤、POI 图、运营位图共用，封了是大面积白图。开屏素材 URL 还是接口动态下发的，域名级封不到。

### 4.5 为什么不拆模块

高德侧没有"广告域"可常驻：唯一能纯域名封的只有链路 2 那台信息专用域，链路 1 与业务同域，必须 MITM + 路径规则。为一条半规则单开 `.module` 只会多一份要跟合集同步的副本，所以并在合集里；闲鱼、哔咔同样并进合集，仓库不再保留任何独立模块。

## 5. 部署与验证

1. Loon → 配置 → 插件，安装 `RedCognitio-Ads*.plugin`，确认「高德地图-去广告」为开。
2. 确认 MitM 已开启、CA 已信任，`m5.amap.com` / `m5-x.amap.com` / `amap-aos-info-nogw.amap.com` 在 MitM 列表里（插件已带）。
3. 核验真实主机名（2026-10-29 实测已通过，以下保留为版本升级后的排查手段）：
   - **装 Debug 构建**，打开「高德地图-调试」，冷启动一次，Loon 日志里看 `AMDEBUG` 行（`AMDUMP-*` 是响应体）。
   - **Mac 侧代理**（能拿完整请求体与响应）：

     ```sh
     bash /Users/redcontritio/Projects/ios_ad_check/tools/start_mitm.sh amap
     ```

     iPhone 按 `tools/MITM.md` 配好代理与 CA 后冷启动高德，抓包里搜 `alimama/splash_screen`。

   三种结果：
   - 出现 `m5.amap.com/ws/valueadded/alimama/splash_screen` → 与 Android 同链路，规则直接生效；
   - 出现别的主机（如 `aos.amap.com`）→ 补进 `[MITM]`，正则不用动；
   - 一条都抓不到 → 高德对 `m5` 做了证书固定（握手失败会在 `captures/passthrough.log` 记 `TLS` 错误），此时只剩链路 2 能拦。

4. 实测（2026-10-29，Loon + iOS，合集 1.0.8）：装完首次启动即无开屏，**不需要先清缓存、不需要多次冷启动、也不需要事先核对主机名**。这一条同时验证了三个推断：
   - iOS 端开屏确实走 `m5.amap.com/ws/valueadded/alimama/splash_screen`，与 Android 同主机，`[MITM]` 不用补；
   - `code="7"` + 空 `data` 被客户端接受，`Callback#onSuccess` 的成功分支成立（不是被当成解析失败）；
   - 清池动作（`remove("afp_splash_events")` + `dc2.m(null)`）在第一次命中时就执行完，所以不存在"已下发素材还要播到 `end_time`"的窗口——这正是响应净化相对 reject 请求的差别（§4.1）。

   由此 `amap_debug` 的定位收窄为「高德大版本更新后复核链路」：主机名或字段结构变了，用它抓一次就能看出来。

5. 回归：搜索、路线规划、导航、实时路况、打车、离线地图、登录、消息。

## 6. 会失效的功能（预期内）

- 开屏广告（目标）。
- 阿里妈妈相关的开屏点击跳转、开屏曝光上报（本来也只在开屏展示时才有意义）。
- 其余一切不变：首页运营位、搜索热词、banner 位都不在本次范围内。

## 7. 产物

| 位置 | 说明 |
|---|---|
| `build/RedCognitio-Ads.plugin.tpl` | 高德段落：`[Rule]` QUIC 降级、`[Rewrite]` 两条响应净化、`[Script]` 诊断、`[MITM]` 三个主机 |
| `scripts/amap-dump.js` | 诊断脚本，Debug 构建注入（`AMDEBUG` / `AMDUMP-*`） |
| `tests/amap.test.js` | 响应净化 jq 程序、开关、MITM 覆盖与构建产物测试 |
| `samples/amap/amap.apk` | 取证样本 |
| `samples/amap/jadx_full/` | jadx 反编译产物（42616 个 java） |

## 8. 能控场的字段（调研结果）

### 8.1 云控 `splashscreen` 模块（客户端侧真正的"配置"）

下发链路：`POST https://m5.amap.com/ws/shield/frogserver/aocs/updatable/1?`（`update_mode`=1 全量 / 2 指定模块，参数 `module`、`lon`、`lat`、`adcode`，签名 `channel` + `diu` + `div` + `_aosmd5`）→ `CloudConfigDataFetcher`（模块白名单里有 `splashscreen`）→ `ConfigModule`（字段 `a` 名称 / `f` 值）→ 落到 SP 与 `files/splash/bg_silent/cloud_config` → 业务侧用 `getModuleConfig("splashscreen")` 读。

模块里客户端认得的键（全部出自 17.02 反编译）：

| 字段 | 默认 | 读取位置 | 作用 |
|---|---|---|---|
| `max_req_count` | 10 | `ah5.attemptRequestData` | 本次启动的开屏请求次数上限，`已发次数 >= 该值` 直接不发 |
| `min_req_interval_second` | 0 | 同上 | 两次请求最小间隔，太小就跳过 |
| `front_switching_time_minute` | 1440 | 同上 | 热切回来时，后台停留不足该分钟数就不请求 |
| `realtime_duration` | 空 | `a#g()` / `xc5#b()` | 实时开屏的生效时间段数组（老方案） |
| `realtime_scene_config` | 空 | `a#g()` | 实时开屏的 URL + 参数；**为空会先把 SP 里的 url/params 清掉**，链路 2 于是不发请求 |
| `show_splash_in_days` | 2 | `xu6#k()` | 首次启动后 N 天内算"启动引导期"，控制引导型开屏图 |

所以理论上存在"字段级关闭"：把 `max_req_count` 改成 0，或把 `realtime_scene_config` 置空，客户端就会自己不发请求，一条拦截都不用做。

但**没有采用**，原因见 §8.4。

### 8.2 开屏响应里的字段（现在用的就是这一层）

| 字段 | 语义 | 改它会怎样 |
|---|---|---|
| `code` | `"1"` / `"7"` 才算成功，其它记 `aoserror` | 改成 7 → 走成功分支并清池 |
| `data.ad[]` | 池化素材条目（可多条，按 `start_time`/`end_time` 过滤） | 置空 → 无素材可入库、不下载 |
| `data.ad[].setting.display_time` | 倒计时秒数 | 置 0 → 跳过按钮立刻可点（不是取消广告） |
| `data.ad[].creative[0].start_time` / `end_time` | 素材有效期（秒） | 推到远期 → 条目被时间窗过滤掉 |
| `data.ad[].video_url` / `static_img_url` | 素材地址 | 清空 → 下载失败，开屏跳过 |
| `data.custom_list[0].creative[0]` | **实时链路**的素材（不是 `ad`） | 缺失 → 判无素材 |

### 8.3 别人的实现

| 来源 | 做法 | 与我们的差异 |
|---|---|---|
| [ddgksf2013 / 墨鱼 `amap.js`](https://github.com/ddgksf2013/Scripts)（jsjiami v7 混淆，[gddt.module](https://github.com/deezertidal/shadowrocket-rules) 用同一脚本） | 对 `splash_screen`：`item.setting.display_time = 0`，`item.creative[0].start_time = creative[0].end_time = 0x8585fb80`（2243454336，推到 2041 年，时间窗过滤直接失效）。对 AOCS：命中 `gd_notch_logo` / `home_business_position_config` / `his_input_tip` / `operation_layer` / `aiNative` / `ai_` / `_ai` 的模块值整体替换成 `{status:1,version:"",value:""}`。另有首页 `main-page`（`cardList`/`business_position`/`pull3.msgs`/`mapBizList`）、`msgbox/pull`、`promotion-web/resource`、`new_hotword`、`search/nearbyrec_smart` 的净化 | 它保留 ad 条目、仍会下载素材，只让条目"过期"；我们把 `data` 直接换成空对象，素材都不下载，并且借成功分支清池。它对 AOCS 的置空会让 `splashscreen` 回退默认值（`max_req_count=10`），反而是"更爱发请求"的方向 |
| [gddt.module](https://github.com/deezertidal/shadowrocket-rules/blob/main/modules/gddt.module) | 上述脚本的 Surge 版；另用 `reject-200` / `reject-dict` 拒 `ws/boss/order_web/*_information`、`ws/asa/ads_attribution`、`ws/shield/scene/recommend`、`uploadimg/*.gif`、`ws/valueadded/weather`；MITM `*amap.com` 全量 | 全域 MITM 与流量级 reject 面太大；我们只开三个主机、只改两条响应 |
| [李跳跳（LiTiaotiao）高德规则](https://github.com/wtwang1998/LiTiaotiao-Custom-Rules/blob/main/C/com/com.A/com.autonavi.minimap/readme.md) | 无障碍自动点击：`iv_close` 关更新弹窗、`msgbox_popup_clear` 关首页横幅 | 不碰开屏大图，只处理弹窗/横幅，与网络层互补 |
| [静途 quietmap](https://modules.lsposed.org/module/io.github.yigenhuobah.quietmap/) | Xposed 模块，运行期改 UI | 需要 root，不适用于 iOS |

没有找到任何一家是靠"某个 boolean 配置字段一键关掉开屏"的——社区实现全部落在响应字段或 UI 层，本机反编译也印证：客户端判定依据是"池里有没有在有效期内的条目"，而不是某个开关。

### 8.4 为什么不走云控字段

- AOCS 是要签名的 POST（`channel` + `diu` + `div` + `_aosmd5`），响应是模块数组、带模块级 `version`/`status`，改错一个字段整块配置会回退默认值——而默认值（`max_req_count=10`、`realtime_scene_config` 由服务端下发）恰恰是"正常放开屏"。
- 云控是全局的：`splashscreen` 与 `engine_pos`、`taxi`、`ut_config` 同批下发，一旦响应变形，连带影响的不只是广告。
- 收益有限：改云控最多省掉一次请求，改响应同样让客户端不发第二次请求（池空 + 无素材），而实现成本差一个量级。

结论：字段确实存在（§8.1 那六个），但用在响应层（§8.2）是投入产出比最高的位置，也就是现在这套。

## 9. 2026-10-31 复发排查：AOS 批量请求迁到 `m5-x.amap.com`（iOS 17.01.1）

**现象**：用户反馈「高德偶发开屏」。合集 1.0.14 规则未改动，MITM 也没有掉证书（与知乎那次回归不同）。

日志：`2026-10-31 11_34_24.log`（31,794,766 B / 320,013 行，sha256 `9f3a404b…85c4`），
Loon 3.5.3(1014) · iOS 27.0.1 · 高德 `AMapiPhone/17.01.1.2014`，区间 11:34:24 → 14:01:31。

### 9.1 结论

**链路 2 拦住了，链路 1 从没进过解密。** 池化请求 `/ws/valueadded/alimama/splash_screen` 在这份
3 小时的日志里出现 **0 次**，而实时请求 `splash_screen_rt` 出现 1 次且被成功改写；同一时间
`m5-x.amap.com` 有 **170 条连接**、全部 `url:(null)`（未解密）。池子被填满 → 下一次热切直接播缓存
→ 表现为「偶发」。

| 事实 | 日志证据 |
|---|---|
| MITM 正常 | `MITM enable: Current profile certificate loaded.`（11:34:24.135），`Match MITM host` 289 条，`Mitm unavailable` 0 条 |
| 链路 2 被净化 | 12:24:07.992 `url:https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?ent=2` → 12:24:08.189 `match rewrite snapshot:… id:40`（0 基编号 = 第 41 条 = `splash_screen_rt` 规则） |
| 链路 1 从未解密 | 全文件 `valueadded/alimama` 0 次；`m5.amap.com` 解密到的 URL 只有 `bootevent`（13 条）与 `frogserver/aocs/updatable`（12 条） |
| `m5-x.amap.com` 未解密 | 170 条 `Get tcp connection from tun (m5-x.amap.com:443)`，每条都是 `url:(null) sni:m5-x.amap.com protocol:3`；无一条 `Match MITM host` |
| `m5-x` 是启动批量入口 | 连接按分钟聚集在四次前台：12:24（48）、12:38（36）、13:09（34）、13:21（21）；同一时刻 `m5.amap.com` 只有 1–5 条 |
| 池化请求时间窗对得上 | 12:24:08.208 起 `m5-x` 连续建连，与链路 2 响应读毕（12:24:08.241）落在同一秒——两条链路是启动时并行发的 |

### 9.2 为什么不怀疑频控

`max_req_count` / `min_req_interval_second` / 「本地有当日妈妈数据」都会抑制请求（§3、§8.1），
但这次日志里有 **四次前台**（12:24 冷启、12:38 / 13:09 / 13:21 热切），四次都出现了 `m5-x` 批量建连、
四次都没有解密到池化请求——如果只是频控，冷启那次（12:24）必然会有一次明文请求。频控解释不了
「0 次出现在已解密主机上、同时另一台 AOS 主机批量建连」这个组合。

### 9.3 `m5-x` 的身份（静态取证）

Android 17.02.0.2010 样本里，`defpackage/e02.java#c()` 是主机兜底表：

```java
a("aos.m5",   new String[]{"https://m5.amap.com/",   "http://maps.testing.amap.com/",  "https://pre-gateway.amap.com/"});
a("aos.m5zb", new String[]{"https://m5-zb.amap.com/", "http://maps.testing.amap.com/",  "https://pre-gateway.amap.com/"});
a("aos.xurl", new String[]{"https://m5-x.amap.com/",  "http://amaps.testing.amap.com/", "https://pre-gateway-x.amap.com/"});
```

`com/amap/bundle/blutils/app/ConfigerHelper.java` 的 `HOST_KEY_TO_STANDARD` 把配置键 `aosx_url`
映射到 `aos.xurl`。`SplashScreenRequest.E` 拼的是 `AOS_URL_KEY`（→ `aos.m5`），所以 **Android 端池化
仍在 `m5.amap.com`**；iOS 17.01.x 把 AOS 批量请求改走 `aosx_url`（`m5-x`），这是两端唯一的差异点，
也解释了为什么 2026-10-29 那次 iOS 实测（App 更早版本）能抓到 `m5.amap.com/ws/valueadded/…`。

`m5-x.amap.com` 与 `m5-zb.amap.com` 在 Android 包的 URL 兜底表里并列出现（`classes4.dex`），
说明 `m5-x` 不是测试域名，而是正式 AOS 网关之一。

### 9.4 本次改动（1.0.16）

| 位置 | 改动 |
|---|---|
| `[MITM]` | `hostname` 增加 `m5-x.amap.com` |
| `[Rule]` | 增加 `AND,((DOMAIN,m5-x.amap.com),(PROTOCOL,QUIC)),REJECT` |
| `[Rewrite]` | 不动——两条正则本来就是 `*.amap.com` 后缀，解密后自动生效 |
| `tests/amap.test.js` | QUIC / MITM 覆盖断言从 2 个主机扩到 3 个；URL 命中用例补 `https://m5-x.amap.com/ws/valueadded/alimama/splash_screen` |

风险：`m5-x` 解密后承载的是地图批量请求（HTTP/1.1、无 ALPN），若高德对这台机单独做证书固定，
连接会失败并在 `captures/passthrough.log` 留 `TLS` 错误。回滚方式：从 `[MITM]` 删掉该主机即可，
其余规则不受影响。

### 9.5 装好后的复核（一次冷启 + 一次热切）

1. 冷启动高德，日志里应出现 `Match MITM host:m5-x.amap.com`，且至少一条
   `url:https://m5-x.amap.com/ws/valueadded/alimama/splash_screen`。
2. 同一次启动里该 URL 应跟着一条 `match rewrite`（池化规则，0 基编号 40）。
3. 再热切一次（切后台再回前台），池化请求应再次出现且再次被改写；若此时仍出开屏，
   说明展示读的是更早写盘的池子——连清两次冷启仍未干净，就把日志交回来查 `cacheAdInfo` 是否换了字段。

### 9.6 仍然没排除的三条尾巴

- `m5-zb.amap.com`（`aos.m5zb`）：本份日志只有 2 条连接，未解密。暂不开 MITM，观察是否增长。
- `pre-gateway-x.amap.com`：`aos.xurl` 的备选主机，正常流量里不该出现；出现即说明主域被降级。
- `amap-ocpx-online.amap.com` / `magellan.alimama.com`：OCPX 转化与阿里妈妈 SSP，开屏之外的位置在用，
  与开屏展示无关，不动。
