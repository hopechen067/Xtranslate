'use strict';

const { fetchWithTimeout, httpFail } = require('./http');
const { fail } = require('../errors');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const DEFAULT_TIMEOUT = 8000;

function languages(direction) {
  if (direction === 'en2zh') return { sl: 'en', tl: 'zh-CN' };
  return { sl: 'zh-CN', tl: 'en' };
}

function parseGoogle(json) {
  const segments = json && json[0];
  if (!Array.isArray(segments) || segments.length === 0) {
    throw fail('BAD_RESPONSE', { service: 'google' });
  }
  let out = '';
  for (const seg of segments) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }
  if (!out) throw fail('BAD_RESPONSE', { service: 'google' });
  return out;
}

/**
 * @param {{text: string, direction: 'zh2en'|'en2zh', signal?: AbortSignal, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 */
async function translateGoogle(opts) {
  const { sl, tl } = languages(opts.direction);
  const url = new URL(ENDPOINT);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', sl);
  url.searchParams.set('tl', tl);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', opts.text);

  const res = await fetchWithTimeout(url, { method: 'GET', signal: opts.signal }, {
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT,
    service: 'google',
    fetchImpl: opts.fetchImpl,
  });
  if (!res.ok) throw httpFail(res.status, 'google');
  let json;
  try {
    json = await res.json();
  } catch {
    throw fail('BAD_RESPONSE', { service: 'google' });
  }
  return parseGoogle(json);
}

module.exports = { translateGoogle, parseGoogle, languages, ENDPOINT };
