# RedCognitio 去广告合集

合集 / 知乎路径模块 **1.1.0**；淘宝 / 网易云音乐路径模块 **0.2.0**。

Loon 3.5.1（983）及以上版本插件，按应用开关：**知乎 / 淘宝 / 网易云音乐**。

## 安装

在 Loon → 配置 → 插件 → 添加，填入：

```text
https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/main/RedCognitio-Ads.plugin
```

使用 gh-proxy 镜像：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/RedContritio/RedCognitio-Ads-Rule/refs/heads/main/RedCognitio-Ads-ghproxy.plugin
```

也可使用 jsDelivr：

```text
https://cdn.jsdelivr.net/gh/RedContritio/RedCognitio-Ads-Rule@main/RedCognitio-Ads.plugin
```

## 设置页

插件详情页提供七个开关：

| 开关 | 默认 | 作用 |
|---|---|---|
| 知乎-去广告 | 开 | 广告接口、回答流广告、首页推广与广告预加载 |
| 知乎-净化 | 开 | 隐藏首页视频与搜索视频栏、仅看当前问题、过滤会员及付费受限内容、隐藏会员开通入口 |
| 淘宝-去广告 | 开 | 淘宝开屏、TopShow、poplayer 弹层、HEIC 开屏兜底 |
| 网易云音乐-去广告 | 开 | 网易云广告接口、开屏、素材 CDN |
| 知乎-调试 | 关 | `ZHCLEAN` 过滤计数、解析错误，`ZHSEARCH-*` 完整搜索响应 |
| 淘宝-调试 | 关 | `TBCLEAN` 响应净化结果、JSON 解析错误 |
| 网易云音乐-调试 | 关 | `NCMDEBUG` 进入脚本的 API 请求方法与 URL |

去广告与净化开关控制对应的 Rewrite / Script；知乎响应脚本与网络配置改写由去广告或净化启用。**域名与 QUIC 规则常驻**；完全停用需关闭插件。

调试按 App 独立控制脚本日志。知乎、淘宝在对应净化脚本运行时输出；网易云按需启用请求记录脚本。原生规则的拦截记录在 Loon 请求记录中查看。独立路径模块也提供对应调试开关。

知乎规则目标、来源与验证状态见 [维护清单](Zhihu.md)。

## 说明

- 需要开启 MITM 并信任 Loon CA；插件已带 hostname。
- 合集与独立 `.module` 模块择一启用。

## 脚本

- `scripts/zhihu-clean.js`：知乎 JSON 净化，调试输出由知乎-调试控制。
- `scripts/zhihu-ad-preload.js`：知乎裸 IP 80 端口回 `{}`
- `scripts/Taobao-ads-clean.js`：淘宝开屏/poplayer 净化
- `scripts/netease-debug.js`：网易云 API 请求调试
