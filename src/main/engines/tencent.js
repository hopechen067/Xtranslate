'use strict';

const { fetchWithTimeout, httpFail } = require('./http');
const { fail } = require('../errors');

// 腾讯交互翻译（TranSmart）网页用的接口：国内约 0.2 秒，比 Bing 快很多，但口语句子质量一般。
const ENDPOINT = 'https://transmart.qq.com/api/imt';
const DEFAULT_TIMEOUT = 8000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CLIENT_KEY = `browser-chrome-130.0.0-Windows_10-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

function languages(direction) {
  if (direction === 'en2zh') return { from: 'en', to: 'zh' };
  return { from: 'zh', to: 'en' };
}

function parseTencent(json) {
  const list = json && json.auto_translation;
  if (!Array.isArray(list) || typeof list[0] !== 'string') {
    throw fail('BAD_RESPONSE', { service: 'tencent' });
  }
  return list.join('\n');
}

/**
 * @param {{text: string, direction: 'zh2en'|'en2zh', signal?: AbortSignal, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 */
async function translateTencent(opts) {
  const { from, to } = languages(opts.direction);
  const res = await fetchWithTimeout(ENDPOINT, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Referer: 'https://transmart.qq.com/',
    },
    body: JSON.stringify({
      header: { fn: 'auto_translation', client_key: CLIENT_KEY },
      type: 'plain',
      model_category: 'normal',
      source: { lang: from, text_list: String(opts.text).split('\n') },
      target: { lang: to },
    }),
  }, { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT, service: 'tencent', fetchImpl: opts.fetchImpl });
  if (!res.ok) throw httpFail(res.status, 'tencent');
  let json;
  try {
    json = await res.json();
  } catch {
    throw fail('BAD_RESPONSE', { service: 'tencent' });
  }
  return parseTencent(json);
}

module.exports = { translateTencent, parseTencent, languages, ENDPOINT };
