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
