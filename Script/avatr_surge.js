/**
 * 阿维塔签到 · Surge / Loon / Shadowrocket / Quantumult X
 *
 * Surge 模块：阿维塔签到.sgmodule。其他工具的配置在同一仓库的 sgmodule 目录。
 *
 * 第一次打开阿维塔 App 后，抓取 loginToken、refreshToken 和 deviceId。
 * loginToken 约 24 小时。剩余不足 6 小时，或已经过期但 refreshToken 仍有效时，
 * 调用 getNewToken 续期，再签到。refreshToken 约 30 天，过期后需要再打开一次 App。
 * 抓包只保存凭证，马上放行 App 请求。还没签到时，下一次定时检查会签。
 * 当天已经签过仍会在 loginToken 不足 6 小时时续期，但不会再签一次。
 * 没打开 App 的日子，在 8:05–21:40 之间抽一个时间自动签。22:17 若仍未签成，再补一次。
 *
 * 可选：填 YYB-Go 后，没有 refreshToken 时才用它换凭证。
 */
"use strict";

const CONFIG = {
  yybServer: "",
  openid: "",
  appid: "wx897fdd60b4bfbade",
  earliest: "8:05",
  latest: "21:40",
};

const SESSION_KEY = "avatr_session";
const STATE_KEY = "avatr_state";
const SIGN_URL = "https://m.avatr.com/api/v6/signIn/signInRiskVerify";
const INFO_URL = "https://m.avatr.com/api/v6/signIn/info";
const LOGIN_URL = "https://appserver-view.avatr.com/api/auth/thirdLogin";
const RENEW_URL = "https://appserver-view.avatr.com/v6/base-view/auth/getNewToken";
const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/104 Mobile";

const RSA_N = BigInt(
  "0x99add9fccc3acddb09347b2ddf3b2f40ae2b2be516ea4fa6c075adebc2d7fc77" +
    "3d577631a90a9e815ed248860291d578fbff4810c01fe7ca4711e43c9c9f90bf" +
    "6a05e0c49a2205b6256a2605ef41fbe3c9cf3333c03edf6f282e32ee5077a108" +
    "2cb7f30e9b3761cd64a61f97a553cf6fcdd95e50bc93bec4001da4bcbc6eca2d"
);
const RSA_E = 65537n;
const RSA_K = 128;
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function pad2(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  return (n < 10 ? "0" : "") + n;
}

function localDate(input) {
  const dt = input == null || input === "" ? new Date() : new Date(input);
  return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
}

function minutesNow() {
  const dt = new Date();
  return dt.getHours() * 60 + dt.getMinutes();
}

function formatMinute(minute) {
  const value = Number(minute) || 0;
  return pad2(Math.floor(value / 60)) + ":" + pad2(value % 60);
}

function formatClock(ts) {
  const dt = new Date(ts);
  const hm = pad2(dt.getHours()) + ":" + pad2(dt.getMinutes());
  if (localDate(dt) === localDate()) return hm;
  return pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate()) + " " + hm;
}

function parseClock(text, fallback) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  if (!matched) return fallback;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function dueToSign(nowMin, slotMin, remainSec, earliestMin) {
  if (nowMin < earliestMin) return false;
  if (nowMin >= slotMin) return true;
  if (remainSec == null || !isFinite(remainSec)) return false;
  return remainSec < (slotMin - nowMin) * 60 + 600;
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
    let key = part.slice(0, index);
    let value = part.slice(index + 1);
    try { key = decodeURIComponent(key); } catch (e) {}
    try { value = decodeURIComponent(value); } catch (e) {}
    out[key] = value;
  });
  return out;
}

function pick() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value == null) continue;
    const text = String(value).trim();
    if (!text || text.indexOf("替换") >= 0 || text.indexOf("请把") >= 0) continue;
    return text;
  }
  return "";
}

function resolvedConfig() {
  const args = readArg();
  return {
    yybServer: pick(args.yyb, args.yybServer, CONFIG.yybServer),
    openid: pick(args.openid, CONFIG.openid),
    appid: pick(args.appid, CONFIG.appid) || "wx897fdd60b4bfbade",
    earliest: pick(args.earliest, CONFIG.earliest) || "8:05",
    latest: pick(args.latest, CONFIG.latest) || "21:40",
  };
}

function yybReady(cfg) {
  cfg = cfg || resolvedConfig();
  return !!(cfg.yybServer && cfg.openid && /^https?:\/\//i.test(cfg.yybServer));
}

function storageRead(key) {
  try {
    if (typeof $prefs !== "undefined" && $prefs.valueForKey) return $prefs.valueForKey(key) || "";
  } catch (e) {}
  try {
    if (typeof $persistentStore !== "undefined" && $persistentStore.read) return $persistentStore.read(key) || "";
  } catch (e) {}
  return "";
}

function storageWrite(key, value) {
  try {
    if (typeof $prefs !== "undefined" && $prefs.setValueForKey) return $prefs.setValueForKey(value, key);
  } catch (e) {}
  try {
    if (typeof $persistentStore !== "undefined" && $persistentStore.write) return $persistentStore.write(value, key);
  } catch (e) {}
  return false;
}

function readJSON(key) {
  try {
    const raw = storageRead(key);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function writeJSON(key, obj) {
  try {
    return storageWrite(key, JSON.stringify(obj || {}));
  } catch (e) {
    return false;
  }
}

function readSession() { return readJSON(SESSION_KEY); }
function writeSession(session) { writeJSON(SESSION_KEY, session || {}); }
function readState() { return readJSON(STATE_KEY); }
function writeState(state) { writeJSON(STATE_KEY, state || {}); }

function notify(subtitle, body, sound) {
  const title = "阿维塔签到";
  console.log([title, subtitle, body].filter(Boolean).join(" "));
  try {
    if (typeof $surge !== "undefined" && $surge.logbook) $surge.logbook([subtitle, body].filter(Boolean).join(" "));
  } catch (e) {}
  try {
    if (typeof $notify === "function") {
      $notify(title, subtitle || "", body || "");
      return;
    }
  } catch (e) {}
  try {
    if (typeof $notification !== "undefined" && $notification.post) {
      try {
        $notification.post(title, subtitle || "", body || "", { sound: !!sound });
      } catch (e2) {
        $notification.post(title, subtitle || "", body || "");
      }
    }
  } catch (e) {}
}

function notifyFail(subtitle, body) {
  const state = readState();
  const key = subtitle + "\n" + body;
  const now = Date.now();
  if (state.failKey === key && now - (state.failAt || 0) < 10 * 60 * 1000) return;
  state.failKey = key;
  state.failAt = now;
  writeState(state);
  notify(subtitle, body, true);
}

function notifyOnce(subtitle, body) {
  const state = readState();
  const today = localDate();
  const key = subtitle + "\n" + body;
  if (state.remindDate === today && state.remindKey === key) return;
  state.remindDate = today;
  state.remindKey = key;
  writeState(state);
  notify(subtitle, body, true);
}

function announceCapture() {
  const state = readState();
  const now = Date.now();
  if (state.captureAnnounceAt && now - state.captureAnnounceAt < 30 * 60 * 1000) return false;
  state.captureAnnounceAt = now;
  writeState(state);
  return true;
}

function lockSign() {
  const state = readState();
  const now = Date.now();
  if (state.signLockAt && now - state.signLockAt < 45000) return false;
  state.signLockAt = now;
  writeState(state);
  return true;
}

function unlockSign() {
  const state = readState();
  state.signLockAt = 0;
  writeState(state);
}

function ensureSlot(state) {
  const cfg = resolvedConfig();
  const today = localDate();
  const earliest = parseClock(cfg.earliest, 8 * 60 + 5);
  let latest = parseClock(cfg.latest, 21 * 60 + 40);
  if (latest < earliest) latest = earliest;
  if (state.slotDate !== today || typeof state.slotMinute !== "number") {
    state.slotDate = today;
    state.slotMinute = earliest + Math.floor(Math.random() * (latest - earliest + 1));
    writeState(state);
  }
  return state;
}

function cleanToken(value) {
  let text = String(value || "").trim();
  if (text.length >= 2) {
    const head = text.charAt(0);
    const tail = text.charAt(text.length - 1);
    if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) text = text.slice(1, -1).trim();
  }
  return text.replace(/^bearer\s+/i, "").trim();
}

function looksLikeJwt(token) {
  if (!token || token.length < 40 || token.indexOf("eyJ") !== 0) return false;
  const parts = token.split(".");
  return parts.length === 3 && !!parts[0] && !!parts[1] && !!parts[2];
}

function headerValue(value) {
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

function headerGet(headers, name) {
  const all = headerGetAll(headers, name);
  return all.length ? all[all.length - 1] : "";
}

function headerGetAll(headers, name) {
  const wanted = String(name || "").toLowerCase();
  const found = [];
  eachHeader(headers, function (field, value) {
    if (String(field).toLowerCase() !== wanted) return;
    const text = headerValue(value).trim();
    if (text) found.push(text);
  });
  return found;
}

function cookiesFromHeaders(headers) {
  let merged = "";
  headerGetAll(headers, "cookie").forEach(function (chunk) {
    merged = mergeCookieHeader(merged, parsePairs(chunk));
  });
  return merged;
}

function credentialGapText(session) {
  if (session && looksLikeJwt(session.refreshToken) && !session.deviceId) {
    return "续期凭证还在，但没有 deviceId。打开一次阿维塔 App。";
  }
  if (session && canRenew(session)) return "登录凭证已过期，续期没有成功。";
  return "续期凭证已过期。打开一次阿维塔 App 重新登录，成功后会再自动签到。";
}

function utf8(str) {
  const out = [];
  const text = String(str);
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

function bytesToUtf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else if ((b & 0xe0) === 0xc0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b & 0xf0) === 0xe0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    }
  }
  return out;
}

function asText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "object" && typeof data.length === "number") {
    try { return bytesToUtf8(data); } catch (e) { return ""; }
  }
  return String(data);
}

function bytesToBase64(bytes) {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63] + table[(n >> 6) & 63] + table[n & 63];
  }
  if (i < bytes.length) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const n = (b0 << 16) | (b1 << 8);
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63];
    out += i + 1 < bytes.length ? table[(n >> 6) & 63] + "=" : "==";
  }
  return out;
}

function base64ToBytes(input) {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(input).replace(/=+$/, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = table.indexOf(clean.charAt(i));
    const c1 = table.indexOf(clean.charAt(i + 1));
    const c2 = i + 2 < clean.length ? table.indexOf(clean.charAt(i + 2)) : -1;
    const c3 = i + 3 < clean.length ? table.indexOf(clean.charAt(i + 3)) : -1;
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out.push((n >> 16) & 255);
    if (c2 >= 0) out.push((n >> 8) & 255);
    if (c3 >= 0) out.push(n & 255);
  }
  return out;
}

function b64urlJson(part) {
  let text = String(part).replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return JSON.parse(bytesToUtf8(base64ToBytes(text)));
}

function jwtRemain(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const obj = b64urlJson(part);
    if (obj == null || obj.exp == null) return null;
    return Number(obj.exp) - Math.floor(Date.now() / 1000);
  } catch (e) {
    return null;
  }
}

function remainText(sec) {
  if (sec == null) return "已保存";
  if (sec <= 0) return "已经过期";
  if (sec < 7200) return "约剩余 " + Math.max(1, Math.floor(sec / 60)) + " 分钟";
  return "约剩余 " + Math.floor(sec / 3600) + " 小时";
}

function isNewerToken(next, prev) {
  if (!looksLikeJwt(next)) return false;
  if (!prev) return true;
  if (next === prev) return false;
  const nextRemain = jwtRemain(next);
  const prevRemain = jwtRemain(prev);
  if (nextRemain == null && prevRemain == null) return true;
  if (nextRemain == null) return false;
  if (prevRemain == null) return true;
  return nextRemain > prevRemain + 30;
}

function parsePairs(cookieHeader) {
  const map = {};
  String(cookieHeader || "").split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) return;
    map[name] = value;
  });
  return map;
}

function mergeCookieHeader(base, extraPairs) {
  const map = parsePairs(base);
  Object.keys(extraPairs || {}).forEach(function (name) {
    if (extraPairs[name] == null || extraPairs[name] === "") return;
    map[name] = extraPairs[name];
  });
  let lines = Object.keys(map).map(function (name) { return name + "=" + map[name]; });
  let out = lines.join("; ");
  if (out.length > 3500) {
    lines = lines.filter(function (line) { return /token|login|session|uid|user|auth/i.test(line); });
    out = lines.join("; ").slice(0, 3500);
  }
  return out;
}

function pairsFromSetCookie(headers) {
  const pairs = {};
  eachHeader(headers, function (field, value) {
    if (String(field).toLowerCase() !== "set-cookie") return;
    const first = String(value == null ? "" : value).split(";")[0];
    const index = first.indexOf("=");
    if (index <= 0) return;
    const name = first.slice(0, index).trim();
    const cookieValue = first.slice(index + 1).trim();
    if (!name || /^(path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name)) return;
    pairs[name] = cookieValue;
  });
  return pairs;
}

function findJwt(obj, depth) {
  if (depth == null) depth = 0;
  if (obj == null || depth > 4) return "";
  if (typeof obj === "string") {
    const token = cleanToken(obj);
    return looksLikeJwt(token) ? token : "";
  }
  if (typeof obj !== "object") return "";
  const preferred = ["loginToken", "login_token", "accessToken", "access_token", "token"];
  for (let i = 0; i < preferred.length; i++) {
    if (typeof obj[preferred[i]] === "string") {
      const token = cleanToken(obj[preferred[i]]);
      if (looksLikeJwt(token)) return token;
    }
  }
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const found = findJwt(obj[keys[i]], depth + 1);
    if (found) return found;
  }
  return "";
}

function findRefresh(obj, depth) {
  if (depth == null) depth = 0;
  if (!obj || typeof obj !== "object" || depth > 3) return "";
  const names = ["refreshToken", "refresh_token"];
  for (let i = 0; i < names.length; i++) {
    const value = obj[names[i]];
    if (typeof value === "string" && value.length > 8 && value.length < 2000) return value.trim();
  }
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    if (obj[keys[i]] && typeof obj[keys[i]] === "object") {
      const found = findRefresh(obj[keys[i]], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function isLoginUrl(url) {
  return /\/api\/auth\/.*(login|token)|\/auth\/getNewToken/i.test(String(url || ""));
}

function canRenew(session) {
  if (!session || !session.deviceId || !looksLikeJwt(session.refreshToken)) return false;
  const left = jwtRemain(session.refreshToken);
  return left == null || left > 60;
}

function shouldRenew(session) {
  if (!canRenew(session)) return false;
  if (!looksLikeJwt(session.token)) return true;
  const left = jwtRemain(session.token);
  if (left == null) return true;
  return left < 6 * 3600;
}

function loginFailureText(data, bodyText) {
  if (data && findJwt(data)) return "";
  if (!bodyText) return "登录响应是空的";
  if (!data || typeof data !== "object") return "登录响应不是 JSON";
  if (data.code == null) return "";
  if (Number(data.code) === 0) return "登录返回成功，但没有 login-token";
  const message = data.message || data.msg || "";
  return ("登录失败 code=" + data.code + " " + message).trim().slice(0, 160);
}

function saveExtract(extracted, source) {
  const session = readSession();
  let sessionDirty = false;
  let unblock = false;
  if (extracted.cookies) {
    const cookies = mergeCookieHeader(session.cookies, parsePairs(extracted.cookies));
    if (cookies !== (session.cookies || "")) {
      session.cookies = cookies;
      sessionDirty = true;
    }
  }
  if (extracted.setCookies && Object.keys(extracted.setCookies).length) {
    const cookies = mergeCookieHeader(session.cookies, extracted.setCookies);
    if (cookies !== (session.cookies || "")) {
      session.cookies = cookies;
      sessionDirty = true;
    }
  }
  if (extracted.refreshToken && isNewerToken(extracted.refreshToken, session.refreshToken)) {
    session.refreshToken = extracted.refreshToken;
    sessionDirty = true;
    unblock = true;
  }
  ["appVersion", "os", "application", "ua", "deviceId", "deviceNumber", "phoneModel", "systemVersion", "channel"].forEach(function (key) {
    if (!extracted[key]) return;
    const value = String(extracted[key]).slice(0, key === "ua" ? 400 : 80);
    if (value === session[key]) return;
    if (key === "deviceId") unblock = true;
    session[key] = value;
    sessionDirty = true;
  });
  let changed = false;
  if (extracted.token && isNewerToken(extracted.token, session.token)) {
    session.token = extracted.token;
    session.capturedAt = Date.now();
    session.source = source || "";
    sessionDirty = true;
    changed = true;
    unblock = true;
  }
  if (sessionDirty) writeSession(session);
  if (unblock) {
    const state = readState();
    state.blockedDate = "";
    if (changed) state.failCount = 0;
    writeState(state);
  }
  return { changed: changed, session: session, state: readState() };
}

function markPendingSign() {
  const state = readState();
  if (state.signedDate === localDate()) return;
  state.pendingSign = 1;
  writeState(state);
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256hex(str) {
  const msg = utf8(str);
  const bitLen = msg.length * 8;
  const padLen = ((msg.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(padLen);
  for (let i = 0; i < msg.length; i++) buf[i] = msg[i];
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA_K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (x) { return x.toString(16).padStart(8, "0"); }).join("");
}

function randomByte() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 256);
}

function randomHex(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += randomByte().toString(16).padStart(2, "0");
  return out;
}

function modPow(base, exp, mod) {
  let result = 1n;
  let value = base % mod;
  let exponent = exp;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * value) % mod;
    exponent >>= 1n;
    value = (value * value) % mod;
  }
  return result;
}

function rsaEncryptText(text, psByte) {
  if (typeof BigInt !== "function") throw new Error("当前 Surge 脚本引擎没有 BigInt，签到签名算不出来");
  const msg = utf8(text);
  if (msg.length > RSA_K - 11) throw new Error("签名盐过长");
  const psLen = RSA_K - msg.length - 3;
  const em = new Uint8Array(RSA_K);
  em[0] = 0x00;
  em[1] = 0x02;
  if (psByte != null) em.fill(psByte, 2, 2 + psLen);
  else {
    for (let i = 0; i < psLen; i++) {
      let b = 0;
      while (b === 0) b = randomByte();
      em[2 + i] = b;
    }
  }
  em[2 + psLen] = 0x00;
  for (let i = 0; i < msg.length; i++) em[3 + psLen + i] = msg[i];
  let m = 0n;
  for (let i = 0; i < em.length; i++) m = (m << 8n) + BigInt(em[i]);
  let c = modPow(m, RSA_E, RSA_N);
  const out = new Uint8Array(RSA_K);
  for (let i = RSA_K - 1; i >= 0; i--) {
    out[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return bytesToBase64(out);
}

function stableBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (Object.keys(body).length === 0) return "{}";
  if (body.thirdType != null && body.sourceType != null && body.authVerifyField != null) {
    return '{"thirdType":' + Number(body.thirdType) +
      ',"sourceType":' + JSON.stringify(String(body.sourceType)) +
      ',"authVerifyField":' + JSON.stringify(String(body.authVerifyField)) + "}";
  }
  if (body.deviceId != null && body.nonce != null && body.refreshToken != null) {
    return '{"deviceId":' + JSON.stringify(String(body.deviceId)) +
      ',"isForce":' + (body.isForce ? "true" : "false") +
      ',"nonce":' + JSON.stringify(String(body.nonce)) +
      ',"refreshToken":' + JSON.stringify(String(body.refreshToken)) + "}";
  }
  if (body.startDate != null && body.endDate != null) {
    return '{"startDate":' + JSON.stringify(String(body.startDate)) +
      ',"endDate":' + JSON.stringify(String(body.endDate)) + "}";
  }
  throw new Error("不支持的请求体");
}

function randomNonce(n) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet.charAt(randomByte() % alphabet.length);
  return out;
}

function signMaterial(expire, salt, bodyStr, method) {
  const ctype = String(method || "POST").toLowerCase() === "get" ? "" : "application/json";
  return '{"expire":' + Number(expire) +
    ',"params":[],"request":{"body":' + JSON.stringify(bodyStr) +
    ',"content-type":' + JSON.stringify(ctype) +
    '},"salt":' + JSON.stringify(salt) + "}";
}

function genSign(method, bodyObj) {
  const expire = Math.floor(Date.now() / 1000);
  const salt = randomHex(16);
  const bodyStr = stableBody(bodyObj);
  return {
    headers: {
      "x-avatr-sign": sha256hex(signMaterial(expire, salt, bodyStr, method)),
      "x-avatr-secret": rsaEncryptText(salt),
      "x-avatr-expire": String(expire),
    },
    bodyStr: bodyStr,
  };
}

function renewHeaders(token, session) {
  const headers = {
    APPLICATION: "AVATR_APP",
    OS: session && session.os ? session.os : "IOS",
    "APP-VERSION": session && session.appVersion ? session.appVersion : "4.8.10",
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": session && session.ua ? session.ua : "AvatrApp",
    "login-token": token || "",
    channel: session && session.channel ? session.channel : "0",
  };
  if (session && session.phoneModel) headers["phone-model"] = session.phoneModel;
  if (session && session.systemVersion) headers.system_version = session.systemVersion;
  if (session && session.deviceNumber) headers["device-number"] = session.deviceNumber;
  if (session && session.cookies) headers.Cookie = session.cookies;
  return headers;
}

function signHeaders(token, session) {
  const application = String(session && session.application || "");
  const os = String(session && session.os || "");
  const fromApp = /APP/i.test(application) && !/MINI/i.test(os);
  const headers = {
    APPLICATION: "AVATR_APP",
    OS: "ANDROID",
    "APP-VERSION": fromApp && session.appVersion ? session.appVersion : "4.8.9",
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": fromApp && session.ua ? session.ua : DEFAULT_UA,
    "X-Requested-With": "com.avatar.buyer.client",
    "login-token": token,
  };
  if (session && session.cookies) headers.Cookie = session.cookies;
  return headers;
}

function httpPost(url, headers, body) {
  return new Promise(function (resolve, reject) {
    if (typeof $task !== "undefined" && $task.fetch) {
      $task.fetch({ url: url, method: "POST", headers: headers, body: body }).then(function (res) {
        resolve({ status: res && (res.statusCode || res.status), body: asText(res && res.body) });
      }, function (err) {
        reject(new Error(typeof err === "string" ? err : (err && (err.error || err.message)) || "网络请求失败"));
      });
      return;
    }
    if (typeof $httpClient === "undefined" || !$httpClient.post) {
      reject(new Error("没有 HTTP 客户端"));
      return;
    }
    $httpClient.post({
      url: url,
      headers: headers,
      body: body,
      timeout: 12,
      "auto-cookie": false,
    }, function (err, resp, data) {
      if (err) reject(new Error(typeof err === "string" ? err : "网络请求失败"));
      else resolve({ status: resp && (resp.status || resp.statusCode), body: asText(data) });
    });
  });
}

function classifySign(res) {
  const raw = res && res.body != null ? String(res.body) : "";
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, dead: false, text: "响应不是 JSON（HTTP " + (res && res.status) + "）" + raw.slice(0, 80) };
  }
  const code = Number(data.code);
  const result = data.result || {};
  if (code === 0) {
    if (result.todayPointValue == null && result.continueSignInDays == null) {
      const brief = JSON.stringify(result).slice(0, 120);
      return { ok: true, dead: false, text: brief && brief !== "{}" ? "接口成功 " + brief : "接口返回成功", result: result };
    }
    return { ok: true, dead: false, text: "今日+" + result.todayPointValue + " 连签" + result.continueSignInDays + "天", result: result };
  }
  if (code === 10402) return { ok: true, dead: false, text: "今天已经签过", result: result };
  if (code === 9999) return { ok: false, dead: true, text: "登录凭证无效或已过期，请打开阿维塔小程序重新登录", result: result };
  const message = data.message || data.msg || "";
  const text = ("失败 code=" + data.code + " " + message).trim().slice(0, 140);
  const risky = /风控|验证|滑块|风险/.test(text);
  return {
    ok: false,
    dead: risky,
    text: risky ? text + "。请打开小程序手动签一次" : text,
    result: result,
  };
}

function recordResult(classified) {
  const state = readState();
  const today = localDate();
  state.lastText = classified.text || "";
  state.lastOk = classified.ok ? 1 : 0;
  state.lastAt = Date.now();
  state.lastAttemptAt = Date.now();
  const result = classified.result || {};
  if (result.continueSignInDays != null) state.streak = result.continueSignInDays;
  if (result.todayPointValue != null) state.todayPoint = result.todayPointValue;
  if (classified.ok) {
    state.signedDate = today;
    state.pendingSign = 0;
    state.blockedDate = "";
    state.failCount = 0;
  } else {
    state.failCount = (state.failDate === today ? Number(state.failCount) || 0 : 0) + 1;
    state.failDate = today;
    if (classified.dead || state.failCount >= 3) state.blockedDate = today;
  }
  writeState(state);
}

async function getWxCode(cfg) {
  const root = String(cfg.yybServer).replace(/\/+$/, "");
  const res = await httpPost(root + "/wxapp/getCode", { "Content-Type": "application/json" }, JSON.stringify({
    ref: cfg.openid,
    app_id: cfg.appid,
  }));
  let data;
  try { data = JSON.parse(res.body || ""); } catch (e) { throw new Error("YYB-Go 没有返回 JSON"); }
  if (!data || Number(data.code) !== 0) throw new Error("YYB-Go 返回错误");
  const code = data.data && data.data.result && data.data.result.code;
  if (!code) throw new Error("没拿到微信 code，确认这台微信已在 YYB-Go 登录");
  return code;
}

async function thirdLogin(code, appid) {
  const signed = genSign("POST", { thirdType: 5, sourceType: "MINI_PROGRAM", authVerifyField: code });
  const headers = {
    APPLICATION: "MINI",
    OS: "MINI_PROGRAM",
    "APP-VERSION": "4.5.14",
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "login-token": "",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat",
    Referer: "https://servicewechat.com/" + appid + "/99/page-frame.html",
  };
  Object.keys(signed.headers).forEach(function (key) { headers[key] = signed.headers[key]; });
  const res = await httpPost(LOGIN_URL, headers, signed.bodyStr);
  let data;
  try { data = JSON.parse(res.body || ""); } catch (e) { throw new Error("换凭证响应不是 JSON"); }
  if (!data || Number(data.code) !== 0) {
    throw new Error(("换凭证失败 code=" + (data && data.code) + " " + ((data && (data.message || data.msg)) || "")).trim());
  }
  const token = findJwt(data);
  if (!looksLikeJwt(token)) throw new Error("没拿到有效登录凭证");
  return token;
}

async function renewWithRefresh(session) {
  const nonce = String(Date.now()) + randomNonce(6);
  const signed = genSign("POST", {
    deviceId: session.deviceId,
    isForce: false,
    nonce: nonce,
    refreshToken: session.refreshToken,
  });
  const headers = renewHeaders(session.token || "", session);
  Object.keys(signed.headers).forEach(function (key) { headers[key] = signed.headers[key]; });
  const res = await httpPost(RENEW_URL, headers, signed.bodyStr);
  let data;
  try { data = JSON.parse(res.body || ""); } catch (e) { throw new Error("续期响应不是 JSON"); }
  if (!data || Number(data.code) !== 0) {
    const message = (data && (data.message || data.msg)) || "";
    const error = new Error(("续期失败 code=" + (data && data.code) + " " + message).trim());
    if (/过期|无效|登录|失效/.test(message)) error.dead = true;
    throw error;
  }
  const token = findJwt(data);
  const refreshToken = findRefresh(data);
  if (!looksLikeJwt(token)) throw new Error("续期没有返回新的 loginToken");
  return saveExtract({ token: token, refreshToken: refreshToken, source: "refresh" }, "refresh").session;
}

async function performSign() {
  let session = readSession();
  const cfg = resolvedConfig();
  let remain = session.token ? jwtRemain(session.token) : null;
  if (shouldRenew(session)) {
    try {
      session = await renewWithRefresh(session);
      remain = jwtRemain(session.token);
      notify("已自动续期", "登录凭证" + remainText(remain) + "，续期凭证" + remainText(jwtRemain(session.refreshToken)), true);
    } catch (e) {
      const loginDead = !looksLikeJwt(session.token) || (remain != null && remain <= 0);
      if (loginDead && yybReady(cfg)) {
        console.log("refresh failed, try yyb " + (e && e.message ? e.message : e));
      } else if (loginDead) {
        throw e;
      } else {
        console.log("refresh failed, use current token " + (e && e.message ? e.message : e));
      }
    }
  }
  session = readSession();
  remain = session.token ? jwtRemain(session.token) : null;
  if (yybReady(cfg) && (!looksLikeJwt(session.token) || remain == null || remain < 6 * 3600)) {
    try {
      const code = await getWxCode(cfg);
      const token = await thirdLogin(code, cfg.appid);
      session = saveExtract({ token: token }, "yyb").session;
      remain = jwtRemain(session.token);
      notify("已自动登录", remainText(remain), true);
    } catch (e) {
      if (!looksLikeJwt(session.token) || (remain != null && remain <= 0)) throw e;
      console.log("yyb refresh failed " + (e && e.message ? e.message : e));
    }
  }
  session = readSession();
  if (!looksLikeJwt(session.token)) {
    const error = new Error("没有登录凭证。打开一次阿维塔 App，让脚本抓到 loginToken 和 refreshToken");
    error.dead = true;
    throw error;
  }
  const left = jwtRemain(session.token);
  if (left != null && left <= -120) {
    const error = new Error(credentialGapText(readSession()));
    error.dead = true;
    throw error;
  }
  const signed = genSign("POST", {});
  const headers = signHeaders(session.token, session);
  Object.keys(signed.headers).forEach(function (key) { headers[key] = signed.headers[key]; });
  const classified = classifySign(await httpPost(SIGN_URL, headers, signed.bodyStr));
  if (classified.ok) return classified;
  try {
    const info = await querySignInfo(session);
    if (info && info.ok) return info;
  } catch (e) {
    console.log("sign info " + (e && e.message ? e.message : e));
  }
  return classified;
}

function dateStamp(date) {
  return date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
}

function signInfoRange() {
  const start = new Date();
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 6);
  return { startDate: dateStamp(start), endDate: dateStamp(end) };
}

async function querySignInfo(session) {
  const signed = genSign("POST", signInfoRange());
  const headers = signHeaders(session.token, session);
  Object.keys(signed.headers).forEach(function (key) { headers[key] = signed.headers[key]; });
  const res = await httpPost(INFO_URL, headers, signed.bodyStr);
  let data;
  try { data = JSON.parse(res.body || ""); } catch (e) { return null; }
  if (!data || Number(data.code) !== 0) return null;
  const result = data.result || {};
  if (!(Number(result.todayPointValue) > 0)) return null;
  return {
    ok: true,
    dead: false,
    text: "今天已经签过 今日+" + result.todayPointValue + " 连签" + result.continueSignInDays + "天",
    result: result,
  };
}

function runSign(finish, isCancelled) {
  if (!lockSign()) {
    finish();
    return;
  }
  function settle(classified) {
    recordResult(classified);
    unlockSign();
    if (isCancelled && isCancelled()) return;
    notify(classified.ok ? "签到成功" : "签到没完成", classified.text, true);
    finish();
  }
  performSign().then(settle).catch(function (e) {
    settle({ ok: false, dead: !!(e && e.dead), text: String(e && e.message ? e.message : e) });
  });
}

function makeFinish(isHttp) {
  let done = false;
  return function (extra) {
    if (done) return;
    done = true;
    if (typeof $done !== "function") return;
    if (isHttp) $done({});
    else if (extra && typeof extra === "object") $done(extra);
    else $done();
  };
}

function noteCapture(saved) {
  if (!saved.changed) return;
  const remain = remainText(jwtRemain(saved.session.token));
  if (readState().signedDate === localDate()) {
    if (announceCapture()) notify("登录凭证已更新", "今天已经签过。" + remain, false);
    return;
  }
  markPendingSign();
  if (announceCapture()) notify("已抓到登录凭证", remain + "。下一次检查时签到", true);
}

function onCapture() {
  const finish = makeFinish(true);
  try {
    const extracted = extractRequest(typeof $request !== "undefined" ? $request : {});
    if (!extracted.token && !extracted.cookies && !extracted.refreshToken && !extracted.deviceId) return;
    noteCapture(saveExtract(extracted, "request"));
  } catch (e) {
    notify("抓取失败", String(e && e.message ? e.message : e), true);
  } finally {
    finish();
  }
}

function extractBodyFields(bodyText) {
  if (!bodyText) return {};
  let data;
  try { data = JSON.parse(bodyText); } catch (e) { return {}; }
  if (!data || typeof data !== "object") return {};
  const out = {};
  if (typeof data.deviceId === "string" && /^[A-Fa-f0-9]{16,64}$/.test(data.deviceId)) out.deviceId = data.deviceId;
  if (typeof data.refreshToken === "string") {
    const refreshToken = cleanToken(data.refreshToken);
    if (looksLikeJwt(refreshToken)) out.refreshToken = refreshToken;
  }
  return out;
}

function extractRequest(req) {
  const headers = (req && req.headers) || {};
  const token = cleanToken(headerGet(headers, "login-token"));
  const bodyFields = extractBodyFields(asText(req && req.body));
  return {
    token: looksLikeJwt(token) ? token : "",
    cookies: cookiesFromHeaders(headers),
    appVersion: headerGet(headers, "app-version"),
    os: headerGet(headers, "os"),
    application: headerGet(headers, "application"),
    ua: headerGet(headers, "user-agent"),
    deviceNumber: headerGet(headers, "device-number"),
    phoneModel: headerGet(headers, "phone-model"),
    systemVersion: headerGet(headers, "system_version") || headerGet(headers, "system-version"),
    channel: headerGet(headers, "channel"),
    deviceId: bodyFields.deviceId || "",
    refreshToken: bodyFields.refreshToken || "",
  };
}

function onResponse() {
  const finish = makeFinish(true);
  try {
    const url = ($request && $request.url) || "";
    const bodyText = asText($response && $response.body);
    let data = null;
    if (bodyText) {
      try { data = JSON.parse(bodyText); } catch (e) { data = null; }
    }
    const saved = saveExtract({
      token: data ? findJwt(data) : "",
      setCookies: pairsFromSetCookie($response && $response.headers),
      refreshToken: data ? findRefresh(data) : "",
    }, "response");
    if (saved.changed) noteCapture(saved);
    else if (isLoginUrl(url)) {
      const failure = loginFailureText(data, bodyText);
      if (failure) notifyFail("登录信息没抓到", failure);
    }
  } catch (e) {
    notify("抓取失败", String(e && e.message ? e.message : e), true);
  } finally {
    finish();
  }
}

function renewOnly(finish) {
  renewWithRefresh(readSession()).then(function (next) {
    notify("已自动续期", "登录凭证" + remainText(jwtRemain(next.token)) + "，续期凭证" + remainText(jwtRemain(next.refreshToken)), true);
    finish();
  }).catch(function (e) {
    const text = String(e && e.message ? e.message : e);
    if (e && e.dead) {
      const state = readState();
      state.blockedDate = localDate();
      state.lastText = text;
      state.lastOk = 0;
      writeState(state);
    }
    notify("续期没完成", text, true);
    finish();
  });
}

function onCron(catchup) {
  const finish = makeFinish(false);
  try {
    const state = ensureSlot(readState());
    const today = localDate();
    if (state.signedDate === today) {
      if (state.pendingSign) {
        state.pendingSign = 0;
        writeState(state);
      }
      if (state.blockedDate !== today && shouldRenew(readSession())) {
        renewOnly(finish);
        return;
      }
      finish();
      return;
    }
    if (state.blockedDate === today) {
      finish();
      return;
    }
    const session = readSession();
    const remain = session.token ? jwtRemain(session.token) : null;
    const cfg = resolvedConfig();
    const earliest = parseClock(cfg.earliest, 8 * 60 + 5);
    const due = catchup || state.pendingSign || dueToSign(minutesNow(), state.slotMinute, remain, earliest);
    if (!due) {
      console.log("阿维塔未到点 " + formatMinute(state.slotMinute));
      finish();
      return;
    }
    if (!state.pendingSign && state.lastOk === 0 && state.lastAttemptAt && Date.now() - state.lastAttemptAt < 30 * 60 * 1000) {
      finish();
      return;
    }
    if (!looksLikeJwt(session.token) && !canRenew(session) && !yybReady(cfg)) {
      if (catchup || state.pendingSign) notifyOnce("今天还没签到", "没有登录凭证。打开一次阿维塔 App，脚本会抓取 loginToken 和 30 天的 refreshToken。");
      finish();
      return;
    }
    if (remain != null && remain <= -120 && !canRenew(session) && !yybReady(cfg)) {
      notifyOnce("今天还没签到", credentialGapText(session));
      const blocked = readState();
      blocked.blockedDate = today;
      writeState(blocked);
      finish();
      return;
    }
    runSign(finish);
  } catch (e) {
    notify("签到没完成", String(e && e.message ? e.message : e), true);
    finish();
  }
}

function onNow() {
  const finish = makeFinish(false);
  const state = readState();
  state.blockedDate = "";
  state.failCount = 0;
  writeState(state);
  runSign(finish);
}

function renderPanel() {
  let payload;
  try {
    const state = ensureSlot(readState());
    const session = readSession();
    const today = localDate();
    const remain = session.token ? jwtRemain(session.token) : null;
    const refreshRemain = session.refreshToken ? jwtRemain(session.refreshToken) : null;
    const slot = formatMinute(state.slotMinute);
    let style = "info";
    const lines = [];
    if (state.signedDate === today) {
      style = "good";
      lines.push("今天已签");
      if (state.lastText) lines.push(state.lastText);
    } else if (looksLikeJwt(session.refreshToken) && !session.deviceId) {
      style = "alert";
      lines.push("今天 " + slot + " 自动签到");
      lines.push("续期凭证" + remainText(refreshRemain));
      lines.push("还缺 deviceId，打开一次阿维塔 App");
    } else if (!session.token && !canRenew(session)) {
      style = "alert";
      lines.push("今天 " + slot + " 自动签到");
      lines.push("还没抓到登录凭证");
      lines.push("打开一次阿维塔 App");
    } else if (state.blockedDate === today) {
      style = "error";
      lines.push(state.lastText || "今天没签成");
      lines.push("打开一次阿维塔 App 后会再签");
    } else {
      lines.push("今天 " + slot + " 自动签到");
      lines.push("登录凭证" + remainText(remain));
    }
    if (session.refreshToken) lines.push("续期凭证" + remainText(refreshRemain));
    if (session.token && session.capturedAt) lines.push("抓取于 " + formatClock(session.capturedAt));
    payload = { title: "阿维塔签到", content: lines.join("\n"), style: style };
  } catch (e) {
    payload = { title: "阿维塔签到", content: "面板读取失败", style: "error" };
  }
  if (typeof $done === "function") $done(payload);
}

function inferMode() {
  if (typeof $response !== "undefined") return "response";
  if (typeof $request !== "undefined") return "capture";
  try {
    if (typeof $input !== "undefined" && $input && $input.purpose === "panel") return "panel";
  } catch (e) {}
  try {
    if (typeof $trigger !== "undefined" && ($trigger === "editor" || $trigger === "intent")) return "now";
  } catch (e) {}
  return "cron";
}

function forcedMode() {
  try {
    if (typeof AVATR_FORCE_MODE === "string" && AVATR_FORCE_MODE) return AVATR_FORCE_MODE;
  } catch (e) {}
  return "";
}

function main() {
  const mode = readArg().mode || forcedMode() || inferMode();
  if (mode === "panel") return renderPanel();
  if (mode === "capture") return onCapture();
  if (mode === "response") return onResponse();
  if (mode === "now") return onNow();
  if (mode === "catchup") return onCron(true);
  return onCron(false);
}

function selftest() {
  const nodeCrypto = require("crypto");
  function checkSha(text) {
    const got = sha256hex(text);
    const expect = nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
    if (got !== expect) throw new Error("sha256 mismatch");
  }
  checkSha("");
  checkSha("abc");
  checkSha("a".repeat(63));
  checkSha("中文签到");
  const material = signMaterial(1750000000, "0123456789abcdef0123456789abcdef", "{}", "POST");
  if (material !== '{"expire":1750000000,"params":[],"request":{"body":"{}","content-type":"application/json"},"salt":"0123456789abcdef0123456789abcdef"}') {
    throw new Error("material " + material);
  }
  if (sha256hex(material) !== "db44953540c0cbafa32ba81a50ae3a6f759326fd88f19ca8ddf272c41ee0dc66") throw new Error("vector");
  const rsa = rsaEncryptText("0123456789abcdef0123456789abcdef", 0x11);
  if (rsa !== "H50fzKRSFg94Ba5Eg9rlgDsy3rzxX/7n0VF17880dcKBP/o/7Uws3oT4uUVJgQa9YSGKvsxzfbahhfpd3cLxku4m6rvsOUNqdLTtCsW6SqevwWy4LJ4GBFntSFzNjmoS87Xik2VrzU51RiFJGJVl2KuBVAqmx+YUO20lUJNjSSs=") {
    throw new Error("rsa");
  }
  if (dueToSign(8 * 60 + 7, 18 * 60, 30 * 60, 8 * 60 + 5) !== true) throw new Error("due early");
  if (dueToSign(8 * 60 + 7, 9 * 60, 20 * 3600, 8 * 60 + 5) !== false) throw new Error("due wait");
  if (dueToSign(10 * 60, 9 * 60, 100, 8 * 60 + 5) !== true) throw new Error("due past");
  if (dueToSign(7 * 60, 9 * 60, 10, 8 * 60 + 5) !== false) throw new Error("due before window");
  const future = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signaturepadding";
  const past = "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signaturepaddingextra";
  if (!looksLikeJwt(future) || !isNewerToken(future, past) || isNewerToken(past, future) || isNewerToken(future, future)) {
    throw new Error("token compare");
  }
  const ok = classifySign({ status: 200, body: '{"code":0,"result":{"todayPointValue":1,"continueSignInDays":639}}' });
  if (!ok.ok || ok.text !== "今日+1 连签639天") throw new Error("classify " + ok.text);
  if (loginFailureText({ code: 1222, message: "鉴权失败" }, "{}") !== "登录失败 code=1222 鉴权失败") throw new Error("login fail");
  if (loginFailureText({ code: 0, result: { loginToken: future } }, "{}") !== "") throw new Error("login ok");
  if (mergeCookieHeader("a=1", { b: "2" }) !== "a=1; b=2") throw new Error("cookie " + mergeCookieHeader("a=1", { b: "2" }));
  if (!isLoginUrl("https://appserver-view.avatr.com/api/auth/thirdLogin")) throw new Error("login url");
  if (!isLoginUrl("https://appserver-view.avatr.com/v6/base-view/auth/getNewToken")) throw new Error("renew url");
  const renewBody = stableBody({ deviceId: "abc123abc123abcd", isForce: false, nonce: "1790596468888lyy7kd", refreshToken: future });
  if (renewBody !== '{"deviceId":"abc123abc123abcd","isForce":false,"nonce":"1790596468888lyy7kd","refreshToken":"' + future + '"}') {
    throw new Error("renew body " + renewBody);
  }
  if (shouldRenew({ deviceId: "abc123abc123abcd", refreshToken: future, token: past }) !== true) throw new Error("should renew");
  if (shouldRenew({ deviceId: "abc123abc123abcd", refreshToken: past, token: past }) !== false) throw new Error("refresh dead");
  if (canRenew({ deviceId: "abc123abc123abcd", refreshToken: future }) !== true) throw new Error("can renew");
  const infoBody = stableBody({ startDate: "20260928", endDate: "20261004" });
  if (infoBody !== '{"startDate":"20260928","endDate":"20261004"}') throw new Error("info body " + infoBody);
  if (credentialGapText({ refreshToken: future, deviceId: "" }).indexOf("deviceId") < 0) throw new Error("gap device");
  console.log("selftest ok");
}

const IN_APP = typeof $httpClient !== "undefined" || typeof $task !== "undefined" || typeof $request !== "undefined" || typeof $response !== "undefined" || typeof $persistentStore !== "undefined" || typeof $prefs !== "undefined" || typeof $notification !== "undefined" || typeof $notify !== "undefined";
if (IN_APP) {
  try {
    main();
  } catch (e) {
    try { notify("脚本出错", String(e && e.message ? e.message : e), true); } catch (e2) {}
    try { if (typeof $done === "function") $done({}); } catch (e3) {}
  }
} else if (typeof process !== "undefined" && process.argv && process.argv.indexOf("--selftest") !== -1) {
  try {
    selftest();
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
}
