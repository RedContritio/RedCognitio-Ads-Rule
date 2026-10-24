let arg = $argument;
if (typeof arg === "string") {
  try {
    arg = JSON.parse(arg);
  } catch (e) {
    arg = null;
  }
}
if (arg?.zhihu_debug === true || arg?.zhihu_debug === "true") {
  console.log("ZHDUMP-REQ " + $request.url);
}
$done({});
