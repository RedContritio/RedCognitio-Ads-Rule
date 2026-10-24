const url = $request.url;
const body = $response.body || "";
const ct = ($response.headers && ($response.headers["Content-Type"] || $response.headers["content-type"])) || "";
console.log("ZHDUMP-BEGIN " + url + " status=" + $response.status + " len=" + body.length + " ct=" + ct);
const size = 1200;
for (let i = 0; i < body.length; i += size) {
  console.log("ZHDUMP-" + i + " " + body.slice(i, i + size));
}
console.log("ZHDUMP-END " + url);
$done({});
