/**
 * 百度网盘超级会员成长值 · Surge
 *
 * 模块：百度网盘签到.sgmodule，脚本和配置放在同一目录。
 * 用 Surge 打开一次 https://pan.baidu.com 并登录，脚本只留下签到需要的 Cookie。
 * 每天 9:17 签到并提交当日答题，21:17 没成功再补一次。面板或「立即签到」可手动跑。
 *
 * 接口与青龙 / 签到模板一致：
 *   签到  /rest/2.0/membership/level?method=signin
 *   题目  /act/v2/membergrowv2/getdailyquestion
 *   交卷  /act/v2/membergrowv2/answerquestion
 *   等级  /rest/2.0/membership/user?method=query
 * 题目接口会把正确选项一并返回，脚本交的就是这个选项。
 * 2026 年有反馈：网页签到后成长值有时要在 App 里再点一次领取，答题仍会计分。
 */
"use strict";

const SESSION_KEY = "baidupan_session";
const STATE_KEY = "baidupan_state";
const SIGN_URL = "https://pan.baidu.com/rest/2.0/membership/level?app_id=250528&web=5&method=signin";
const QUESTION_URL = "https://pan.baidu.com/act/v2/membergrowv2/getdailyquestion?app_id=250528&web=5";
const ANSWER_URL = "https://pan.baidu.com/act/v2/membergrowv2/answerquestion?app_id=250528&web=5";
const USER_URL = "https://pan.baidu.com/rest/2.0/membership/user?app_id=250528&web=5&method=query";
const KEEP_COOKIE = {
  BDUSS: 1,
  BDUSS_BFESS: 1,
  STOKEN: 1,
  BAIDUID: 1,
  BAIDUID_BFESS: 1,
  PTOKEN: 1,
  PANPSC: 1,
  ndut_fmt: 1,
  csrfToken: 1,
  BDCLND: 1,
  SCRC: 1,
};

function pad2(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  return (n < 10 ? "0" : "") + n;
}

function today() {
  const dt = new Date();
  return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
}

function readArg() {
  let raw = "";
  try {
    if (typeof $argument !== "undefined" && $argument != null) raw = String($argument);
  } catch (e) {
    raw = "";
  }
  const out = {};
  raw.split("&").forEach(function (part) {
    if (!part) return;
    const index = part.indexOf("=");
    if (index <= 0) {
      out[part] = "";
      return;
    }
    out[part.slice(0, index)] = part.slice(index + 1);
  });
  return out;
}

function storeRead(key) {
  try {
    if (typeof $persistentStore !== "undefined") return $persistentStore.read(key) || "";
  } catch (e) {}
  return "";
}

function storeWrite(key, value) {
  try {
    if (typeof $persistentStore !== "undefined") $persistentStore.write(String(value == null ? "" : value), key);
  } catch (e) {}
}

function readJson(key) {
  const raw = storeRead(key);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    return {};
  }
}

function writeJson(key, data) {
  storeWrite(key, JSON.stringify(data || {}));
}

function headerText(value) {
  if (Array.isArray(value)) return value.length ? String(value[0]) : "";
  return value == null ? "" : String(value);
}

function eachHeader(headers, visit) {
  if (!headers) return;
  if (Array.isArray(headers)) {
    headers.forEach(function (item) {
      if (!item) return;
      visit(String(item.field || item.name || ""), item.value);
    });
    return;
  }
  Object.keys(headers).forEach(function (key) {
    const value = headers[key];
    if (Array.isArray(value)) value.forEach(function (item) { visit(key, item); });
    else visit(key, value);
  });
}

function headerGetAll(headers, name) {
  const wanted = String(name || "").toLowerCase();
  const found = [];
  eachHeader(headers, function (field, value) {
    if (String(field).toLowerCase() !== wanted) return;
    const text = headerText(value).trim();
    if (text) found.push(text);
  });
  return found;
}

function headerGet(headers, name) {
  const all = headerGetAll(headers, name);
  return all.length ? all[all.length - 1] : "";
}

function parsePairs(cookieHeader) {
  const map = {};
  String(cookieHeader || "").split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name || value === "") return;
    map[name] = value;
  });
  return map;
}

function cookieValue(cookie, name) {
  return parsePairs(cookie)[name] || "";
}

function slimCookie(raw) {
  const map = parsePairs(raw);
  const parts = [];
  Object.keys(KEEP_COOKIE).forEach(function (name) {
    if (map[name]) parts.push(name + "=" + map[name]);
  });
  return parts.join("; ");
}

function cookiesFromHeaders(headers) {
  let merged = "";
  headerGetAll(headers, "cookie").forEach(function (chunk) {
    const extra = parsePairs(chunk);
    const map = parsePairs(merged);
    Object.keys(extra).forEach(function (name) { map[name] = extra[name]; });
    merged = Object.keys(map).map(function (name) { return name + "=" + map[name]; }).join("; ");
  });
  return slimCookie(merged);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function pick(node, names, depth) {
  if (node == null || depth > 5 || typeof node !== "object") return undefined;
  for (let i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(node, names[i]) && node[names[i]] != null && node[names[i]] !== "") {
      return node[names[i]];
    }
  }
  const keys = Object.keys(node);
  for (let j = 0; j < keys.length; j++) {
    const found = pick(node[keys[j]], names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function regexField(text, name) {
  const matched = new RegExp('"' + name + '"\\s*:\\s*"?([^",}\\s]+)"?').exec(String(text || ""));
  return matched ? matched[1] : "";
}

function codeOf(data, raw) {
  const code = pick(data, ["errno", "error_code", "error_no"], 0);
  if (code != null && code !== "") return String(code);
  return regexField(raw, "errno") || regexField(raw, "error_code");
}

function msgOf(data, raw) {
  const msg = pick(data, ["error_msg", "show_msg", "errmsg", "msg"], 0);
  if (msg != null && String(msg)) return String(msg);
  const matched = /"(?:error_msg|show_msg)"\s*:\s*"([^"]*)"/.exec(String(raw || ""));
  return matched ? matched[1] : "";
}

function loggedOut(code, msg) {
  return code === "-6" || /未登录|登录超时|过期|bduss/i.test(msg || "");
}

function already(msg) {
  return /已签|已经签|重复签|已答|已经答|已完成|repeat signin|exceeded limit|already/i.test(msg || "");
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function describeSign(res) {
  if (res.error) return { line: "签到请求失败：" + res.error, ok: false, auth: false };
  const data = parseJson(res.body);
  if (!data) return { line: "签到返回无法解析（HTTP " + (res.status || "?") + "）", ok: false, auth: false };
  const code = codeOf(data, res.body);
  const msg = msgOf(data, res.body);
  const points = pick(data, ["points", "sign_point", "reward_point", "add_points"], 0);
  if (loggedOut(code, msg)) return { line: "登录状态失效，请再打开一次网盘网页", ok: false, auth: true };
  if (code === "0") {
    return {
      line: points != null ? "签到成功，本次 " + points + " 成长值" : "签到成功" + (msg ? "（" + msg + "）" : ""),
      ok: true,
      auth: false,
    };
  }
  if (already(msg)) return { line: "今天已经签过" + (msg ? "（" + msg + "）" : ""), ok: true, auth: false };
  return { line: "签到：" + (msg || ("错误码 " + (code || res.status || "?"))), ok: false, auth: false };
}

function parseQuestion(res) {
  if (res.error) return { line: "题目请求失败：" + res.error, ok: false };
  const data = parseJson(res.body);
  if (!data) return { line: "题目返回无法解析", ok: false };
  const code = codeOf(data, res.body);
  const msg = msgOf(data, res.body);
  if (loggedOut(code, msg)) return { line: "登录状态失效，请再打开一次网盘网页", ok: false, auth: true };
  let askId = pick(data, ["ask_id", "askId", "question_id"], 0);
  let answer = pick(data, ["answer", "right_answer", "rightAnswer"], 0);
  if (askId == null) askId = regexField(res.body, "ask_id");
  if (answer == null || answer === "") answer = regexField(res.body, "answer");
  const title = pick(data, ["question", "ask_title", "title"], 0);
  if (askId == null || askId === "" || answer == null || answer === "") {
    if (already(msg)) return { line: "今天题目已经答过" + (msg ? "（" + msg + "）" : ""), ok: true };
    return { line: "今天没有拿到题目" + (msg ? "（" + msg + "）" : ""), ok: false };
  }
  return {
    askId: String(askId),
    answer: String(answer),
    title: title ? clip(title, 36) : "",
    ok: true,
  };
}

function describeAnswer(res, quiz) {
  const prefix = quiz.title ? "答题「" + quiz.title + "」" : "答题";
  if (res.error) return { line: prefix + "请求失败：" + res.error, ok: false };
  const data = parseJson(res.body);
  if (!data) return { line: prefix + "返回无法解析", ok: false };
  const code = codeOf(data, res.body);
  const msg = msgOf(data, res.body);
  const score = pick(data, ["score", "points", "add_score"], 0);
  if (loggedOut(code, msg)) return { line: "登录状态失效，请再打开一次网盘网页", ok: false, auth: true };
  if (code === "0" || score != null) {
    return {
      line: prefix + "成功" + (score != null ? "，+" + score : "") + (msg ? "（" + msg + "）" : ""),
      ok: true,
    };
  }
  if (already(msg)) return { line: "今天题目已经答过" + (msg ? "（" + msg + "）" : ""), ok: true };
  return { line: prefix + "：" + (msg || ("错误码 " + (code || res.status || "?"))), ok: false };
}

function describeUser(res) {
  if (res.error || !res.body) return { line: "", level: "", value: "" };
  const data = parseJson(res.body) || {};
  let level = pick(data, ["current_level"], 0);
  let value = pick(data, ["current_value"], 0);
  if (level == null || level === "") level = regexField(res.body, "current_level");
  if (value == null || value === "") value = regexField(res.body, "current_value");
  if (level === "" && value === "") return { line: "", level: "", value: "" };
  return {
    line: "SVIP" + (level || "?") + "，成长值 " + (value || "?"),
    level: String(level || ""),
    value: String(value || ""),
  };
}

function apiHeaders(session) {
  return {
    Accept: "application/json, text/plain, */*",
    "User-Agent": session.ua || "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    Referer: "https://pan.baidu.com/wap/svip/growth/task",
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Cookie: session.cookie,
  };
}

function httpRequest(method, url, headers) {
  return new Promise(function (resolve) {
    const client = method === "POST" ? $httpClient.post : $httpClient.get;
    client.call($httpClient, { url: url, headers: headers, timeout: 12 }, function (error, response, data) {
      let status = 0;
      if (response) status = response.status || response.statusCode || 0;
      resolve({
        error: error ? String(error) : "",
        status: status,
        body: data == null ? "" : String(data),
      });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function notify(title, text) {
  const lines = String(text || "").split("\n").filter(function (line) { return line; });
  console.log(title + "\n" + lines.join("\n"));
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, lines[0] || "", lines.slice(1).join("\n"));
  }
}

function capture() {
  try {
    const headers = $request && $request.headers;
    const slim = cookiesFromHeaders(headers);
    const session = readJson(SESSION_KEY);
    const previous = cookieValue(session.cookie, "BDUSS");
    let changed = false;
    if (slim && cookieValue(slim, "BDUSS")) {
      if (session.cookie !== slim) {
        session.cookie = slim;
        session.capturedAt = Date.now();
        changed = true;
      }
      const ua = headerGet(headers, "user-agent");
      if (ua && session.ua !== ua) {
        session.ua = ua;
        changed = true;
      }
    }
    if (session.device || session.mobileSignUrl || session.mobileBody || session.mobileMethod) {
      delete session.device;
      delete session.mobileSignUrl;
      delete session.mobileBody;
      delete session.mobileMethod;
      changed = true;
    }
    if (changed && session.cookie) {
      writeJson(SESSION_KEY, {
        cookie: session.cookie,
        capturedAt: session.capturedAt || Date.now(),
        ua: session.ua || "",
      });
      if (cookieValue(session.cookie, "BDUSS") !== previous) {
        notify("百度网盘", "已记下登录状态，今天 9:17 自动签到答题");
      }
    }
  } catch (e) {
    console.log("baidupan capture " + e);
  }
  $done({});
}

async function run(reason) {
  const session = readJson(SESSION_KEY);
  const state = readJson(STATE_KEY);
  if (!cookieValue(session.cookie, "BDUSS")) {
    const text = "还没有登录状态。用 Surge 打开一次 https://pan.baidu.com 并登录。";
    writeJson(STATE_KEY, { date: today(), ok: false, summary: text, at: Date.now() });
    notify("百度网盘", text);
    return;
  }
  if (reason !== "now" && state.date === today() && state.ok) {
    console.log("百度网盘今天已经完成\n" + (state.summary || ""));
    return;
  }

  const headers = apiHeaders(session);
  const parts = [];
  let auth = false;
  let signOk = false;
  let quizOk = false;

  const sign = describeSign(await httpRequest("GET", SIGN_URL, headers));
  parts.push(sign.line);
  signOk = !!sign.ok;
  auth = !!sign.auth;

  await sleep(1200);
  const quiz = parseQuestion(await httpRequest("GET", QUESTION_URL, headers));
  if (quiz.auth) auth = true;
  if (quiz.askId && quiz.answer != null) {
    await sleep(800);
    const answered = describeAnswer(
      await httpRequest("GET", ANSWER_URL + "&ask_id=" + encodeURIComponent(quiz.askId) + "&answer=" + encodeURIComponent(quiz.answer), headers),
      quiz
    );
    parts.push(answered.line);
    quizOk = !!answered.ok;
    if (answered.auth) auth = true;
  } else {
    parts.push(quiz.line);
    quizOk = !!quiz.ok;
  }

  await sleep(600);
  const user = describeUser(await httpRequest("GET", USER_URL, headers));
  if (user.line) parts.push(user.line);

  const summary = parts.filter(function (line) { return line; }).join("\n");
  const ok = !auth && signOk && quizOk;
  writeJson(STATE_KEY, {
    date: today(),
    ok: ok,
    summary: summary,
    level: user.level || state.level || "",
    value: user.value || state.value || "",
    at: Date.now(),
  });
  notify("百度网盘", summary);
}

function panel() {
  const state = readJson(STATE_KEY);
  const session = readJson(SESSION_KEY);
  const lines = [];
  if (state.level || state.value) lines.push("SVIP" + (state.level || "?") + " · 成长值 " + (state.value || "?"));
  else if (!cookieValue(session.cookie, "BDUSS")) lines.push("未登录，打开一次网盘网页");
  else lines.push("已登录，等待今天的签到");
  if (state.summary) lines.push(state.date === today() ? state.summary : state.date + "\n" + state.summary);
  $done({
    title: "百度网盘",
    content: lines.join("\n"),
    icon: "checkmark.seal.fill",
    "icon-color": "#06A7FF",
  });
}

function selfTest() {
  const cookie = slimCookie("FOO=1; BDUSS=abc; STOKEN=st; BAIDUID=bid; theme=dark");
  if (cookie !== "BDUSS=abc; STOKEN=st; BAIDUID=bid") throw new Error("cookie " + cookie);
  if (cookieValue(cookie, "BDUSS") !== "abc") throw new Error("bduss");
  const sign = describeSign({ status: 200, body: '{"errno":0,"points":5,"error_msg":""}' });
  if (sign.line.indexOf("5") < 0 || !sign.ok) throw new Error("sign " + sign.line);
  const again = describeSign({ status: 200, body: '{"errno":37301,"error_msg":"今日已签到"}' });
  if (!again.ok) throw new Error("again " + again.line);
  const quiz = parseQuestion({ status: 200, body: '{"errno":0,"data":{"ask_id":9,"answer":2,"question":"网盘里的文件存在哪里"}}' });
  if (quiz.askId !== "9" || quiz.answer !== "2") throw new Error("quiz " + JSON.stringify(quiz));
  const zero = parseQuestion({ status: 200, body: '{"ask_id":3,"answer":0}' });
  if (zero.answer !== "0") throw new Error("zero");
  const user = describeUser({ status: 200, body: '{"current_level":8,"current_value":12345}' });
  if (user.level !== "8" || user.value !== "12345") throw new Error("user " + user.line);
  const lost = describeSign({ status: 200, body: '{"errno":-6,"error_msg":"用户未登录"}' });
  if (!lost.auth) throw new Error("auth");
  const repeat = describeSign({ status: 200, body: '{"errno":37301,"error_msg":"repeat signin"}' });
  if (!repeat.ok || repeat.line.indexOf("已经签过") < 0) throw new Error("repeat " + repeat.line);
  const limited = describeAnswer(
    { status: 200, body: '{"errno":1,"show_msg":"ask answer num exceeded limit"}' },
    { title: "" }
  );
  if (!limited.ok) throw new Error("limit " + limited.line);
}

function main() {
  const mode = readArg().mode || "cron";
  if (mode === "capture") {
    capture();
    return;
  }
  if (mode === "panel") {
    panel();
    return;
  }
  const reason = mode === "now" ? "now" : "cron";
  run(reason).then(function () { $done(); }).catch(function (error) {
    console.log("baidupan " + error);
    notify("百度网盘", "签到脚本出错：" + error);
    $done();
  });
}

if (typeof $httpClient === "undefined") {
  selfTest();
} else {
  main();
}
