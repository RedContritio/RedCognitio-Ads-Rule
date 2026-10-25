/* SPDX-License-Identifier: Apache-2.0 */

let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
if (arg?.xianyu_debug === true || arg?.xianyu_debug === "true") {
  console.log("XYDEBUG " + JSON.stringify({
    method: $request.method,
    url: $request.url,
  }));
}
$done({});
