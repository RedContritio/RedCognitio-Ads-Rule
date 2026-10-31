# 多邻国去广告（v1 · 已实施）

> 目标：iOS + Loon 环境下，`每完成一小节后`的插屏广告彻底不出现——**含 Duolingo 自家 Super 推广**，不只是三方广告。
>
> 实施状态（2026-10-30）：`scripts/duolingo-clean.js`、`scripts/duolingo-dump.js`（Debug）、`tests/duolingo.test.js`（13 组）、合集开关与 `[Script]`/`[MITM]`、构建号 1.0.12 均已就位。仅剩真机复核。

---

## 0. 一句话结论

插屏放不放，客户端读的是**账号档位**，不是广告接口。所以本方案不改广告请求，只改首方用户数据响应里的三处字段。

推论两条，都很重要：

- **域名规则对它无效**。广告与主内容同域下发（NextDNS 官方也这么回），封 `duolingo.com` 会连登录和进度一起死。
- **腾讯系/AdGuard 那类「只掉三方广告」的方案不算达标**。它们的效果是「广告换成自家 Super 推广」，而推广同样是广告。

---

## 1. 改写点

拦截面：`ios-api-*.duolingo.c(n|om)` / `api\d+.duolingo.com` 的

- `2023-05-23/batch` —— 批量包裹，用户数据在 `responses[0]`
- `2023-05-23/users/{id}` —— 裸 userdata

三处字段（同一次响应里一起给）：

| # | 路径 | 免费态 → 改成 |
|---|---|---|
| 1 | `userdata.shopItems[]` | 补一条 `id: "gold_subscription"`：`purchaseDate = now-172800`、`purchasePrice: 0`、`subscriptionInfo{ expectedExpiration = now+31536000, productId: "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168", renewer: "APPLE", renewing: true, tier: "twelve_month", type: "gold" }` |
| 2 | `userdata.subscriberLevel` | `"GOLD"` |
| 3 | `userdata.trackingProperties.has_item_{immersive,premium,live,gold,max}_subscription` | 全部 `true` |

三条实现要点：

1. **幂等**：已有 `gold_subscription` 只续期、不重复 push。batch 一次响应可能被连改多次，早期脚本会堆出十几条订阅。
2. **etag 一律放行**：`responses[i].headers` 里有 `etag`（不分大小写）就整条跳过。App 用 ETag 走条件请求，304 时 body 为空，硬改会解析失败或污染缓存——表现为「会员状态时有时无」。
3. **三种 body 形态**：`responses[i].body` 可能是 JSON 字符串、已解析对象，或整个响应就是裸 userdata。三种都要接住。

**有意不改**：`xp_boost_stackable`、`pathSectioned` 关卡状态、`liveOpsChallenges` 时长、题池清空。它们与去广告没有因果关系，只会把「伪造订阅」升级成「伪造进度与收益」。

---

## 2. 开关与默认值

| 开关 | 默认 | 说明 |
|---|---|---|
| 多邻国-去广告 | **关** | 改的是账号状态，性质与其它「删内容」开关不同；开启前建议先用小号跑几天 |
| 多邻国-调试 | 关 | `DUOLINGO-CLEAN` 命中详情；另控制 `duolingo-dump.js`（仅 Debug 构建） |

启用后需要 `[MITM]` 覆盖对应主机（已内置）：

```
ios-api.duolingo.com, ios-api-1.duolingo.com, ios-api-2.duolingo.com,
ios-api-cf.duolingo.com, api.duolingo.com, api2.duolingo.com, ios-api-2.duolingo.cn
```

---

## 3. 验证

1. 开「多邻国-去广告」，冷启动 App。
2. Loon → 日志，过滤 `duolingo`，应看到 `tag="多邻国去广告"` 命中 `2023-05-23/batch` 或 `users/{id}`。
3. 冷启动 3 次 + 连做 6 节：**任何一条插屏出现都算未达标**（含 `PlusPromoVideo` 式推广、「升级解锁」全屏页）。
4. 回归：登录态、streak、进度同步、能量/红心领取、排行榜正常。

第 1 步日志零命中时，先查这两处，别急着改脚本：

- 实际主机名不在 `[MITM]` 里（日志里看真实 host，补一条即可；临时可用 `*.duolingo.com` 兜底定位）；
- 响应体过大被 Loon 丢弃（在该行追加 `max-size=31457280`）。

---

## 4. 仍出插屏时（判据失效）

说明判据不在资格层，按三层查：

| 层 | 候选 | 说明 |
|---|---|---|
| ① 资格层 | `subscriberLevel` / `shopItems` / `trackingProperties` | 本方案已覆盖 |
| ② 广告配置层 | 与订阅并列下发的 `adsConfig` / `adConfig` / `promo*` / `placements` / `sessionEndAd` | 只改资格不动它，推广照发 |
| ③ 实验层 | `experiments` / `abTests` | 广告开关大量挂在 A/B 分组上，最可能是「改了订阅仍出推广」的真因 |

取证不需要抓包：Debug 构建开「多邻国-调试」，`duolingo-dump.js` 会把同一次响应里的候选**键名**打到日志（`DUODUMP` 行，不含任何值），一次冷启动就能定候选。拿到键名后再决定是改写还是删除（例如 `adsConfig.enabled` 置 false，或把实验分组改成付费组）。

只有日志里连键名都取不到（字段在加密体、或根本没走这个接口）时，才需要上 `tools/start_mitm.sh` 抓 `.mitm` 全文。

---

## 5. 已知局限

- 服务端仍视你为免费用户。若哪天服务端对订阅做二次校验（或由服务端下发广告配置并校验 entitlement），会出现「UI 显示会员但广告照播」，本方案即失效。
- `2023-05-23` 不是常量，Duolingo 调 API 版本时正则要跟着改。
- 国内版（`.cn`）的字段集可能与国际版不同（可能根本不下发 Max 档）。

---

## 6. 2026-10-31 复核：插屏仍在的两层原因

日志：`2026-10-31 11_34_24.log`（54,035,837 B / 663,951 行，sha256 `7f2a685f…6c1e`），
区间 11:34:24 → 16:55:33，Loon 3.5.3(1014) · iOS 27.0.1 · 多邻国 7.146.1。

### 6.1 第一层：这份日志里开关根本没开

| 判据 | 日志里的值 | 含义 |
|---|---|---|
| `Load 1056 rules. 10 scripts. 41 rewrites.` | 41 rewrite + 10 script | 装的是 **1.0.14**；Debug 的规模行应为 **46 rewrites / 14 scripts** |
| `DUOLINGO-CLEAN` | **0** | `duolingo-clean.js` 一次都没执行 |
| `duolingo_debug` 的 `DUODUMP` | **0** | 诊断脚本也没跑 |
| rewrite 命中 id | `4,5,7,8,9,10,11,16,17,19,20,21,22,23,25,28,36,40`——全是知乎/淘宝/网易云/哔哩哔哩/高德，**没有多邻国那条** | `duolingo_enable == true` 这个前置条件没成立 |
| `Match MITM host:ios-api*` | 22 次 | MITM 是通的，不是解密问题 |
| JS Console | 只有 `ZHCLEAN*` 与 `Receive total …` | 其它脚本正常跑，排除「脚本下载失败」 |

结论：`多邻国-去广告` 默认是**关**的（`Duolingo.md` §2），开关没开 → 规则短路，`2023-05-23/batch` 与
`users/{id}` 一共 39 次请求原样放行。这一步跟闲鱼那次不同：闲鱼是规则不存在，这里是规则存在但开关关着。

### 6.2 第二层：即使开了，广告决策面也没被覆盖

同一份日志里，多邻国真正在跑的促销/广告决策接口是另一套，本文件一条规则都没碰：

| 接口 | 次数 | 作用 | 现规则 |
|---|---|---|---|
| `plus-promotions/ml-predictions/centralized-decision` | 60（.cn）+ 38（.com） | 集中式决策：放不放推广 | 未覆盖 |
| `2021-05-05/plus-promotions/decisions/{user}/` | 42 + 32 | 旧版决策接口，响应约 657 B | 未覆盖 |
| `plus-promotions/compute-decision/{user}/` | 2 + 2 | 决策计算 | 未覆盖 |
| `plus-promotions/ml-predictions/package-preference-model` | 2 + 2 | 报价偏好模型 | 未覆盖 |
| `2025-08-01/plus-promotions/recent-ad-show/verify/{user}/` | 2 | 最近一次广告展示校验 | 未覆盖 |
| `midas-bandits-prod.duolingo.cn` | 73 条连接 | bandit 报价，**之前不在 MITM 里** | 未覆盖 |

`centralized-decision` 响应只有 **274 B**、`decisions` 约 **657 B**，都很小，抓一次就能看清结构。
这正是 §5 写的那条局限：服务端仍把你当免费用户，放不放广告由决策接口说了算，改 `subscriberLevel` 只是改了「资格层」。

### 6.3 本次改动（1.0.19）

只加诊断，不动放行逻辑——键名没拿到之前改决策响应是盲改：

| 位置 | 改动 |
|---|---|
| `[MITM]` | 补 `midas-bandits-prod.duolingo.cn` |
| `[Script]` | 新增 Debug-only「多邻国决策诊断」：`plus-promotions` / `subscription-catalog` / `available-features` / `midas-bandits` 命中时跑 `duolingo-dump.js`，打 `DUODUMP` 键名清单 |

### 6.4 下一步（一次课就够）

1. 装 **1.0.19 Debug**，确认日志 `Load` 行变成 `46 rewrites / 14 scripts`（这一行就是版本指纹）。
2. 打开「多邻国-去广告」+「多邻国-调试」。
3. 做一课到出插屏为止，把日志发回来。
4. 日志里应有 `DUODUMP https://…/plus-promotions/ml-predictions/centralized-decision ["…"]`，拿到键名后再决定：
   - 键里有 `show` / `eligible` / `should_show` 这类布尔 → 改决策响应；
   - 只有实验分组 → 改 `experiments` 命中组；
   - 一条都抓不到 → 决策走未解密的通道，再考虑 `plus-promotions` 请求级 `reject_dict(200)` 的副作用测试。
