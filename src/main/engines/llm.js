'use strict';

const { getProvider } = require('../providers');
const { buildPrompt, cleanOutput } = require('../prompt');
const { fetchWithTimeout, httpFail } = require('./http');
const { fail } = require('../errors');
const { readSSE, takeOpenAIDelta, takeAnthropicDelta } = require('./sse');

const DEFAULT_TIMEOUT = 30000;

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return b + p;
}

function maxTokensFor(text) {
  return Math.min(4096, String(text).length * 4 + 64);
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host || '大模型接口';
  } catch {
    return '大模型接口';
  }
}

/**
 * @param {{text: string, direction: 'zh2en'|'en2zh', llm: object, signal?: AbortSignal, onPartial?: (text: string) => void, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 * @returns {Promise<string>} cleanOutput 之后的译文
 */
async function translateLLM(opts) {
  const llm = opts.llm || {};
  const provider = getProvider(llm.provider);
  const kind = provider.kind === 'anthropic' ? 'anthropic' : 'openai';
  const baseUrl = llm.baseUrl || provider.baseUrl;
  const model = llm.model || provider.model;
  const apiKey = llm.apiKey || '';

  if (!apiKey && !provider.keyOptional) throw fail('NO_KEY', { service: hostOf(baseUrl), kind: 'llm' });
  if (!baseUrl) throw fail('NO_BASE_URL', { kind: 'llm' });
  if (!model) throw fail('NO_MODEL', { kind: 'llm' });

  const prompt = buildPrompt(opts.text, opts.direction);
  const maxTokens = maxTokensFor(opts.text);
  const service = hostOf(baseUrl);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;

  let url;
  let headers;
  let body;
  if (kind === 'anthropic') {
    url = joinUrl(baseUrl, '/v1/messages');
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    body = {
      model,
      max_tokens: maxTokens,
      temperature: prompt.temperature,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      stream: true,
    };
  } else {
    url = joinUrl(baseUrl, '/chat/completions');
    headers = { 'content-type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model,
      temperature: prompt.temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: true,
    };
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  }, { timeoutMs, service, fetchImpl: opts.fetchImpl });

  if (!res.ok) throw httpFail(res.status, service);

  let accumulated = '';
  try {
    await readSSE(res.body, (data) => {
      if (!String(data).trim()) return;
      if (kind === 'anthropic') {
        accumulated += takeAnthropicDelta(data);
      } else {
        const piece = takeOpenAIDelta(data);
        if (piece.done) return;
        accumulated += piece.delta;
      }
      if (opts.onPartial) opts.onPartial(accumulated);
    });
  } catch (err) {
    if (err && (err.code === 'CANCEL' || err.code === 'TIMEOUT' || err.code === 'NETWORK')) throw err;
    if (err instanceof SyntaxError) throw fail('BAD_RESPONSE', { service, kind: 'llm' });
    throw err;
  }
  return cleanOutput(accumulated);
}

module.exports = { translateLLM, joinUrl, maxTokensFor, hostOf };
