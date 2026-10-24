/*
 * 知乎广告预取拦截 · Loon 模块 Zhihu-URL.module 配套
 *
 * 请求形态（实测）：
 *   HEAD http://<裸IP>/ HTTP/1.1
 *   Host: <裸IP>
 *   User-Agent: osee2unifiedRelease/<版本> (iPhone; ...)
 *   isPreload: true / x-ad-styles / x-ad-cache / X-AD / x-close-recommend: 0
 *
 * 无域名、路径为根，域名与路径规则均无法命中，故以「裸IP + 根路径 + 知乎 App UA」判别。
 *
 * 不用规则拒绝的原因：实测中规则的实际策略会变为 REJECT-DROP（不返回响应），
 * 客户端只能等 TCP 超时；而广告预取位于回答页加载路径上，实测会导致页面卡住。
 * 该切换行为未见官方文档记载。脚本不经规则策略体系，不受影响。
 *
 * 返回 200 + {} 而非 4xx：对广告系统是明确的「无广告」信号，客户端收到响应即继续。
 *
 * SPDX-License-Identifier: Apache-2.0
 */
$done({
    response: {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        },
        body: "{}"
    }
});
