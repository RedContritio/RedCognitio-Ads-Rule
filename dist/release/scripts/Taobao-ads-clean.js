/*
 * 淘宝广告响应净化 · Loon 模块 Taobao-URL.module 配套
 *
 * 不阻断接口而净化响应：接口失败会触发客户端兜底素材，须返回 200 + 空素材。
 * 覆盖三条链路：开屏图片/视频、开屏视频(cloudvideo)、开屏活动(poplayer 模板)。
 *
 * SPDX-License-Identifier: Apache-2.0
 */
const url = $request.url, response = $response;

function emptyArray(holder, key) {
    return !!(holder && Array.isArray(holder[key]) && holder[key].length > 0) && (holder[key] = [],
    !0);
}

$done(function() {
    if (!response || !response.body) return {};
    const obj = function(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }(response.body);
    if (!obj) return {};
    let changed = !1;
    return /mtop\.taobao\.wireless\.home\.splash\.awesome\.get/.test(url) ? changed = function(data) {
        const sections = data?.containers?.splash_home_base?.base?.sections;
        if (!Array.isArray(sections)) return !1;
        let touched = !1;
        for (const section of sections) {
            const slots = section?.bizData?.["taobao-splash"]?.data;
            if (Array.isArray(slots)) for (const slot of slots) slot.imgUrl && (slot.imgUrl = ""),
            slot.videoUrl && (slot.videoUrl = ""), slot.startTime = "0", slot.endTime = "0",
            slot.gmtStartMs = "0", slot.gmtEndMs = "0", slot.coldStart = "false", slot.hotStart = "false",
            slot.waitTime = "0", slot.times = "0", slot.enable4G = "false", slot.haveVoice = "false",
            touched = !0;
        }
        return touched;
    }(obj.data) : /mtop\.taobao\.cloudvideo\.video\.query/.test(url) ? changed = function(data) {
        if (!data || "object" != typeof data) return !1;
        let touched = !1;
        return data.duration && (data.duration = "0", touched = !0), emptyArray(data, "resources") && (touched = !0),
        emptyArray(data, "caches") && (touched = !0), touched;
    }(obj.data) : /^https:\/\/poplayer\.template\.alibaba\.com\//.test(url) && (changed = function(obj) {
        if (!obj || "object" != typeof obj) return !1;
        let touched = !1;
        return emptyArray(obj.res, "images") && (touched = !0), emptyArray(obj.res, "videos") && (touched = !0),
        emptyArray(obj.mainRes, "images") && (touched = !0), obj.enable && (obj.enable = !1,
        touched = !0), touched;
    }(obj)), changed ? {
        body: JSON.stringify(obj)
    } : {};
}());
