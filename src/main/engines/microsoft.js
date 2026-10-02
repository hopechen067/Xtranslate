'use strict';

const { fetchWithTimeout, httpFail } = require('./http');
const { fail } = require('../errors');

// edge.microsoft.com/translate/auth 已在 2026-07-30 下线，任何请求都是 404。
// 现在和 Bing 翻译网页一样：先读 translator 页面里的短期 token，再 POST /ttranslatev3。
// 拿 token 走 cn.bing.com：国内约 0.6 秒（www 约 2.3 秒），海外同样可访问
const PAGE_URL = 'https://cn.bing.com/translator';
const DEFAULT_TRANSLATE_URL = 'https://cn.bing.com/ttranslatev3';
const DEFAULT_TIMEOUT = 8000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

let cached = null;
let pending = null; // 正在获取的 session，并发请求共用一次

function resetTokenCache() {
  cached = null;
  pending = null;
}

function languages(direction) {
  if (direction === 'en2zh') return { from: 'en', to: 'zh-Hans' };
  return { from: 'zh-Hans', to: 'en' };
}

function translateUrlFor(pageUrl) {
  try {
    const url = new URL(pageUrl || '');
    if (url.protocol === 'https:' && (url.host === 'bing.com' || url.host.endsWith('.bing.com'))) {
      return `https://${url.host}/ttranslatev3`;
    }
  } catch {
    // 落回 www
  }
  return DEFAULT_TRANSLATE_URL;
}

function parseBingAuth(html, now = Date.now()) {
  const abuse = String(html).match(/params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/);
  const ig = String(html).match(/IG\s*:\s*"([A-Fa-f0-9]+)"/);
  const iid = String(html).match(/data-iid\s*=\s*"([^"]+)"/);
  if (!abuse || !ig || !iid) throw fail('BAD_RESPONSE', { service: 'microsoft' });
  const ttl = Number(abuse[3]);
  return {
    ig: ig[1],
    iid: iid[1],
    key: abuse[1],
    token: abuse[2],
    exp: now + Math.max(ttl - 60_000, 0),
  };
}

function parseMicrosoft(json) {
  if (json && typeof json.statusCode === 'number' && json.statusCode !== 200) {
    const err = fail('HTTP', { status: json.statusCode === 205 ? 401 : json.statusCode, service: 'microsoft', kind: 'free' });
    err.bingStatus = json.statusCode;
    throw err;
  }
  const text = json && json[0] && json[0].translations && json[0].translations[0] && json[0].translations[0].text;
  if (typeof text !== 'string') throw fail('BAD_RESPONSE', { service: 'microsoft' });
  return text;
}

async function getSession(fetchImpl, signal, timeoutMs, force) {
  const now = Date.now();
  if (!force && cached && cached.exp > now + 15_000) return cached;
  if (!force && pending) return pending;
  const p = fetchSession(fetchImpl, signal, timeoutMs, now);
  pending = p;
  try {
    return await p;
  } finally {
    if (pending === p) pending = null;
  }
}

async function fetchSession(fetchImpl, signal, timeoutMs, now) {
  const res = await fetchWithTimeout(PAGE_URL, {
    method: 'GET',
    signal,
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT },
  }, { timeoutMs, service: 'microsoft', fetchImpl });
  if (!res.ok) throw httpFail(res.status, 'microsoft');
  const html = await res.text();
  const auth = parseBingAuth(html, now);
  cached = { auth, translateUrl: translateUrlFor(res.url), exp: auth.exp };
  return cached;
}

/** 提前拿好 token，让第一次翻译不用等页面下载。失败静默，真正翻译时会再试。 */
async function warmupMicrosoft(fetchImpl) {
  try {
    await getSession(fetchImpl, undefined, DEFAULT_TIMEOUT, false);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{text: string, direction: 'zh2en'|'en2zh', signal?: AbortSignal, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 */
async function translateMicrosoft(opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const { from, to } = languages(opts.direction);

  async function once(force) {
    const session = await getSession(opts.fetchImpl, opts.signal, timeoutMs, force);
    const url = new URL(session.translateUrl);
    url.searchParams.set('isVertical', '1');
    url.searchParams.set('IG', session.auth.ig);
    url.searchParams.set('IID', session.auth.iid);
    const body = new URLSearchParams({
      fromLang: from,
      text: opts.text,
      to,
      token: session.auth.token,
      key: session.auth.key,
    });
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Referer: PAGE_URL,
      },
      body: body.toString(),
    }, { timeoutMs, service: 'microsoft', fetchImpl: opts.fetchImpl });
    if (!res.ok) throw httpFail(res.status, 'microsoft');
    let json;
    try {
      json = await res.json();
    } catch {
      throw fail('BAD_RESPONSE', { service: 'microsoft' });
    }
    return parseMicrosoft(json);
  }

  try {
    return await once(false);
  } catch (err) {
    if (err && (err.bingStatus === 205 || err.status === 401)) return once(true);
    throw err;
  }
}

module.exports = {
  translateMicrosoft,
  warmupMicrosoft,
  parseMicrosoft,
  parseBingAuth,
  translateUrlFor,
  languages,
  resetTokenCache,
  PAGE_URL,
};
