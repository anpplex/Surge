// Quantumult X 的「立即签到」入口。下载主脚本后以 mode=now 执行。
// Surge、Loon、小火箭使用各自模块里的 argument=mode=now，不必引用这个文件。
const AVATR_SCRIPT = "https://raw.githubusercontent.com/anpplex/Surge/main/Script/avatr_surge.js";

function runNow(code) {
  const runner = new Function("AVATR_FORCE_MODE", code);
  runner("now");
}

function fail(message) {
  console.log("阿维塔签到 立即签到没启动 " + message);
  try {
    if (typeof $notify === "function") $notify("阿维塔签到", "立即签到没启动", message);
    else if (typeof $notification !== "undefined" && $notification.post) $notification.post("阿维塔签到", "立即签到没启动", message);
  } catch (e) {}
  if (typeof $done === "function") $done();
}

if (typeof $task !== "undefined" && $task.fetch) {
  $task.fetch({ url: AVATR_SCRIPT, method: "GET" }).then(function (res) {
    try {
      runNow((res && res.body) || "");
    } catch (e) {
      fail(String(e && e.message ? e.message : e));
    }
  }, function (err) {
    fail(typeof err === "string" ? err : "主脚本下载失败");
  });
} else if (typeof $httpClient !== "undefined" && $httpClient.get) {
  $httpClient.get(AVATR_SCRIPT, function (err, resp, data) {
    if (err) fail(typeof err === "string" ? err : "主脚本下载失败");
    else {
      try {
        runNow(data || "");
      } catch (e) {
        fail(String(e && e.message ? e.message : e));
      }
    }
  });
} else {
  fail("没有 HTTP 客户端");
}
