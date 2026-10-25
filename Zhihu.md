# 知乎规则维护

合集版本 **1.0.N**，第三位为构建号。运行环境：Loon 3.5.1（983）+，iOS 知乎 11.11.0。

## 文件与开关

| 文件 | 职责 |
|---|---|
| `build/RedCognitio-Ads.plugin.tpl` | 合集规则模板 |
| `RedCognitio-Ads*.plugin`、`dist/` | 自动生成的 Release / Debug 合集、镜像与脚本 |
| [Zhihu-URL.module](Zhihu-URL.module) | 知乎路径规则、脚本路由、MITM |
| [Zhihu-Domain.module](Zhihu-Domain.module) | 知乎域名规则 |
| [zhihu-clean.js](scripts/zhihu-clean.js) | JSON 广告清理与内容净化 |
| [zhihu-clean.test.js](tests/zhihu-clean.test.js) | 自动测试 |

- **去广告**：广告接口、广告卡、推广字段。
- **净化**：首页视频、当前问题回答流、会员内容、会员入口、界面精简。
- **调试**：Debug 合集与独立路径模块提供，默认关闭；开启后记录过滤计数、解析错误与完整搜索响应。
- **常驻**：域名与 QUIC 规则。完全停用时关闭插件；合集与独立模块择一启用。
- 云配置由去广告或净化启用。MITM：`zhihu.com, *.zhihu.com`。
- 同一响应选择原生响应体 Rewrite 或响应脚本；Loon 优先执行命中的响应体 Rewrite。

## 来源与验证

| 来源 | 记录 |
|---|---|
| 包分析 | Android 11.5.0 的接口、模型、域名及广告模板 |
| 参考实现 | 可莉 / RuCu6 历史规则 |
| 哲也 | [blackmatrix7 AllInOne](https://github.com/blackmatrix7/ios_rule_script/blob/master/rewrite/Surge/AllInOne/AllInOne.sgmodule) 引用的[脚本](https://gist.githubusercontent.com/blackmatrix7/f5f780d0f56b319b6ad9848fd080bb18/raw/zheye.min.js)，提供回答流与视频识别参考 |
| 本机 | 2026-10-23 至 24 日 iOS 抓包、Loon 日志与响应回放；25 日用户真机回测 |

验证状态：**真机确认**＝用户确认页面效果；**真实回放**＝使用抓到的响应核对结果；**自动测试**＝合成样本与配置断言；**静态参考**＝包分析或历史规则核对。

## 接口规则

去广告通过广告接口拦截、响应内容过滤和广告域名拦截生效。

路径与正则以配置为准；`vN` 表示版本号，`ID` 表示内容 ID。相同处理的规则合并列示。

| 目标 | 开关 / 处理 | 来源 | 验证 |
|---|---|---|---|
| `/api/cloud/zhihu/config/all` | 任一；关闭 HTTPDNS、备用 IP、QUIC 配置，保留其他配置 | 包分析、参考实现、本机 | 自动测试、真实字段核对 |
| `/commercial_api/` | 去广告；`200 + {}`，覆盖开屏、底部等广告位 | 包分析、参考实现、本机 | 真机确认、真实回放 |
| `/ad-style-service/`、`/ad-track/`、`/adx/third_sdk_info`、`/adEngine/`、`/fringe/ad`、`/content-distribution-core/bubble/common/show` | 去广告；`200 + {}` | 包分析、参考实现 | 静态参考 |
| `/commercial_api/answer/ID/bottom-v2` | 去广告；响应层删除 `adjson` | 本机 | 真实回放 |
| `zhstatic.zhihu.com/brand-ad/` | 去广告；404 | 本机 | 真实素材地址核对 |
| `next-render`、`simple-next-render`，`type=answer` | 净化；已有 `scenes` 改为 `question` | 用户需求、本机 | 自动测试、请求日志 |
| `/comment_vN/(answers/pins)/ID/root_comment` | 净化；删 `atmosphere_voting_config` | 参考实现 | 静态参考 |
| `/comment_vN/(answers/articles/pins)/ID/list-headers` | 净化；删 `continuous_consumption_module` | 参考实现 | 静态参考 |
| `/people/self` | 净化；删除 `vip_info`、`kvip_info` 的 `entrance*` 字段，保留会员状态 | 参考实现、本机 | 11 份真实回放、自动测试 |
| `/root/tab`、`/root/tab/vN` | 净化；保留关注、推荐、热榜、圈子 | 参考实现 | 开关测试、静态参考 |
| `/search/tabs` | 净化；搜索类别白名单，移除 `zvideo` | 参考实现、用户需求 | 自动测试、命中日志 |
| `/related_recommend/feed/waterfall`、`/search/preset_words`、`/search/related_queries/question/ID` | 净化；`200 + {}` | 参考实现 | 静态参考 |
| `/api/vN/members/homepage_card`、`/people/homepage_entry_vN`、`/kvip/right/my_card` | 净化；`200 + {}` | 参考实现 | 静态参考 |
| `/unlimited/go/my_card/vN`、`/unlimited/go/my_card/all` | 净化；`200 + {}` | 参考实现、本机 | 新版接口真机确认、路径测试 |
| `zhida.zhihu.com/ai_ingress/knowledge/square/categories/feeds`、`/ai_ingress/ai_chat/guidance` | 净化；`200 + {}` | 参考实现 | 静态参考 |
| `/search/recommend_query/vN` | 净化；推荐词只留 `type=normal` | 参考实现、哲也 | 静态参考 |
| `/podcasts/hub/vN` | 净化；删 `banners` | 参考实现 | 静态参考 |

## 内容脚本

路由覆盖首页推荐、两种回答滚动接口、问题列表、搜索及回答 / 文章 / 想法详情。列表处理同时覆盖 `data`、`dataV1`。

| 目标 | 开关 / 判定 | 来源 | 验证 |
|---|---|---|---|
| 广告对象与字段 | 去广告；递归删除已知广告类型及 `ad_info`、`ad_answers`、`ad_answer`、`adjson`、`ad_list` | 包分析、哲也、本机 | 自动测试、真实回放 |
| 回答间广告 | 去广告；移除回答流 `data[]` 的 `type=ad` | 哲也、本机 | 真机确认；25 项样本保留 22 项 |
| 首页推广 | 去广告；检查结构化 `promotion.is_card`、`commercial_promotion_rpc_extra`，移除 `plutus_card_*`、`brand_card_*` 子卡 | 包分析、本机 | 自动测试；13 项样本保留 10 项 |
| 详情广告位 | 去广告；删 `third_business` 和所有 `type=card` 结构段 | 参考实现 | 字段开关测试；结构段为静态参考 |
| 正文图片与大图 | 保留图片结构段、图片地址、原图地址与尺寸 | 本机 | 6 份真实响应的 21 个图片段完整保留；用户回测正常 |
| 首页视频 | 净化；按视频类型及组件识别，保留普通图片和回答详情视频 | 哲也、用户需求 | 自动测试 |
| 会员受限列表项 | 净化；购买状态、`purchase_required`、会员提示及 `KfeCollection-PurchaseBtn`；显式免费、已购优先保留 | 包分析、用户需求 | 自动测试 |
| 课程、盐选小说商品卡 | 净化；外层 `knowledge_ad`，内层 `knowledge_vip` 或 `album_paid_column` / `paid_column_chapter` 商品类型 | 本机 | 真机确认；20 项真实响应移除 4 张商品卡 |
| 界面字段 | 净化；详情删 `float_search_word`、`interaction_bar_plugins`、`ring_info`，首页删 `id=ring` 子项，问题删 `roundtable_info`，搜索删 `pendant` | 参考实现、本地精简 | 详情 / 子项 / 搜索自动测试；圆桌字段为代码核对 |

## 域名与传输

以下规则常驻；广告域使用 `pre-matching`。完整名单以模块和合集 `[Rule]` 为准。

| 目标 | 动作 | 来源 / 验证 |
|---|---|---|
| `zhihu.com` 及子域的 QUIC | `REJECT` | Loon 传输要求；协议条件核对 |
| `pangolin-sdk-toutiao.com`、`pangolin-sdk-toutiao-b.com`、`gdt.qq.com`、`tanx.com` 后缀 | `REJECT-DICT` | 历史联盟规则；静态参考 |
| `pangolin-sdk-toutiao1.com` 后缀 | `REJECT-DICT` | 本地联盟规则补充；静态参考 |
| `adaudit.zhihu.com`、`promotion.zhihu.com`、`deeplink.umeng.com` | `REJECT` | 包分析；静态参考 |
| `ad.reward.net` | `REJECT` | 包内域名字符串；静态参考 |
| `kwaizt.com` 后缀 | `REJECT` | 本地联盟规则补充；静态参考 |
| 合集共享监测域 | 精确 `DOMAIN` 拒绝 | 合集共享监测名单；静态参考 |

`api.zhihu.com`、图片 CDN、`sugar.zhihu.com` 与 `open.kuaishouzt.com` 保留业务访问，广告按路径处理。

## 修改与验证

```sh
npm test
npm run build:check
git diff --check
```

- 自动测试覆盖规则、调试开关、两种构建的过滤结果及构建一致性；真实响应回放核对正文、图片、相邻条目与分页，真机确认页面效果。
- 修改模板与源码后运行 `npm run build`；版本号第三位递增，脚本 URL 使用完整版本号刷新。独立路径模块按对应规则同步维护。
- 开启调试后，`ZHCLEAN` 记录过滤计数，`removed` 合计字段和条目删除；`ZHSEARCH-META` / `ZHSEARCH-BODY` 记录完整搜索响应及请求 URL，按 `id`、`part` 拼接，每段 1200 字符。
- 原始日志、抓包与证书留在本机。独立 `Zhihu-Dump*.module` 的知乎-调试默认关闭，开启后以 `ZHDUMP-*` 记录详情请求与完整响应；启用前检查其中的 Host 映射。
