/* SPDX-License-Identifier: Apache-2.0 */

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
if (arg?.netease_debug === true || arg?.netease_debug === "true") {
  console.log("NCMDEBUG " + JSON.stringify({
    method: $request.method,
    url: $request.url,
  }));
}
$done({});
