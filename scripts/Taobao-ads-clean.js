/*
 * 淘宝广告响应净化 · Loon 模块 Taobao-URL.module 配套
 *
 * 不阻断接口而净化响应：接口失败会触发客户端兜底素材，须返回 200 + 空素材。
 * 覆盖三条链路：开屏图片/视频、开屏视频(cloudvideo)、开屏活动(poplayer 模板)。
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const url = $request.url;
const response = $response;

let arg = (typeof __DEBUG__ === "undefined" || __DEBUG__) ? $argument : null;
if ((typeof __DEBUG__ === "undefined" || __DEBUG__) && typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
const debug = (typeof __DEBUG__ === "undefined" || __DEBUG__) &&
  (arg?.taobao_debug === true || arg?.taobao_debug === "true");

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    if (debug) console.log(`[Taobao-ads-clean] JSON 解析失败: ${e}`);
    return null;
  }
}

function emptyArray(holder, key) {
  if (holder && Array.isArray(holder[key]) && holder[key].length > 0) {
    holder[key] = [];
    return true;
  }
  return false;
}

// 开屏图片与视频：data.containers.splash_home_base.base.sections[].bizData["taobao-splash"].data[]
function cleanSplash(data) {
  const sections = data?.containers?.splash_home_base?.base?.sections;
  if (!Array.isArray(sections)) return false;

  let touched = false;
  for (const section of sections) {
    const slots = section?.bizData?.["taobao-splash"]?.data;
    if (!Array.isArray(slots)) continue;

    for (const slot of slots) {
      if (slot.imgUrl) slot.imgUrl = "";
      if (slot.videoUrl) slot.videoUrl = "";

      // 排期字段置为已过期，使客户端判定无素材可展示
      slot.startTime = "0";
      slot.endTime = "0";
      slot.gmtStartMs = "0";
      slot.gmtEndMs = "0";
      slot.coldStart = "false";
      slot.hotStart = "false";
      slot.waitTime = "0";
      slot.times = "0";
      slot.enable4G = "false";
      slot.haveVoice = "false";
      touched = true;
    }
  }
  return touched;
}

// 开屏视频：data.duration / resources / caches
function cleanCloudVideo(data) {
  if (!data || typeof data !== "object") return false;

  let touched = false;
  if (data.duration) {
    data.duration = "0";
    touched = true;
  }
  if (emptyArray(data, "resources")) touched = true;
  if (emptyArray(data, "caches")) touched = true;
  return touched;
}

// 开屏活动：res.images / res.videos / mainRes.images / enable
function cleanPoplayerTemplate(obj) {
  if (!obj || typeof obj !== "object") return false;

  let touched = false;
  if (emptyArray(obj.res, "images")) touched = true;
  if (emptyArray(obj.res, "videos")) touched = true;
  if (emptyArray(obj.mainRes, "images")) touched = true;
  if (obj.enable) {
    obj.enable = false;
    touched = true;
  }
  return touched;
}

function handle() {
  if (!response || !response.body) return {};
  const obj = parseJSON(response.body);
  if (!obj) return {};
  let changed = false;
  if (/mtop\.taobao\.wireless\.home\.splash\.awesome\.get/.test(url)) {
    changed = cleanSplash(obj.data);
  } else if (/mtop\.taobao\.cloudvideo\.video\.query/.test(url)) {
    changed = cleanCloudVideo(obj.data);
  } else if (/^https:\/\/poplayer\.template\.alibaba\.com\//.test(url)) {
    changed = cleanPoplayerTemplate(obj);
  }
  if (debug) console.log("TBCLEAN " + JSON.stringify({ url: url.split("?")[0], changed }));
  return changed ? { body: JSON.stringify(obj) } : {};
}

$done(handle());
