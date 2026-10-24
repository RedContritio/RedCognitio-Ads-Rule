# RedCognitio 去广告合集

合集 / 知乎 **1.0.0**；淘宝 / 网易云音乐 **0.1.0**。

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

插件详情页会出现四个开关：

| 开关 | 作用 |
|---|---|
| 知乎-去广告 | 广告接口、回答流广告、首页推广与广告预加载 |
| 知乎-净化 | 隐藏首页视频与搜索视频栏、仅看当前问题、过滤会员及付费受限内容、隐藏会员开通入口 |
| 淘宝-去广告 | 淘宝开屏、TopShow、poplayer 弹层、HEIC 开屏兜底 |
| 网易云音乐-去广告 | 网易云广告接口、开屏、素材 CDN |

关闭某个开关后，对应的 Rewrite / Script 行为停止；知乎两个开关共用的响应脚本与网络配置改写会在任一开关开启时运行。**域名与 QUIC 规则仍生效**；完全停用需关闭插件。

知乎规则目标、来源与验证状态见 [维护清单](Zhihu.md)。

## 说明

- 需要开启 MITM 并信任 Loon CA；插件已带 hostname。
- 合集与独立 `.module` 模块择一启用。

## 脚本

- `scripts/zhihu-clean.js`：知乎 JSON 净化；`ZHCLEAN` 为过滤计数，`ZHSEARCH-*` 为完整搜索响应调试日志。
- `scripts/zhihu-ad-preload.js`：知乎裸 IP 80 端口回 `{}`
- `scripts/Taobao-ads-clean.js`：淘宝开屏/poplayer 净化
