'use strict';

const { detectDirection } = require('../prompt');
const { userMessage } = require('../errors');
const { translateMicrosoft } = require('./microsoft');
const { translateGoogle } = require('./google');
const { translateLLM } = require('./llm');

function resolveDirection(text, direction) {
  if (direction === 'zh2en' || direction === 'en2zh') return direction;
  return detectDirection(text);
}

function asUserError(err, ctx) {
  if (err && err.code === 'CANCEL') {
    const cancel = new Error('已取消');
    cancel.code = 'CANCEL';
    throw cancel;
  }
  const wrapped = new Error(userMessage(err, ctx));
  wrapped.code = err && err.code;
  throw wrapped;
}

/**
 * @param {{text: string, direction?: 'auto'|'zh2en'|'en2zh', engine?: 'free'|'llm', signal?: AbortSignal, onPartial?: (text: string) => void, config?: object, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 * @returns {Promise<{text: string, direction: 'zh2en'|'en2zh'}>}
 */
async function translate(opts) {
  const raw = String(opts.text ?? '');
  const engine = opts.engine || (opts.config && opts.config.engine) || 'free';
  if (raw.trim() === '') {
    return { text: '', direction: resolveDirection(raw, opts.direction) };
  }
  const direction = resolveDirection(raw, opts.direction);
  const config = opts.config || {};

  try {
    if (engine === 'llm') {
      const text = await translateLLM({
        text: raw,
        direction,
        llm: config.llm || {},
        signal: opts.signal,
        onPartial: opts.onPartial,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });
      return { text, direction };
    }

    const provider = (config.free && config.free.provider) || 'microsoft';
    const run = provider === 'google' ? translateGoogle : translateMicrosoft;
    const service = provider === 'google' ? 'google' : 'microsoft';
    let text;
    try {
      text = await run({
        text: raw,
        direction,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });
    } catch (err) {
      if (err && !err.kind) err.kind = 'free';
      if (err && !err.service) err.service = service;
      throw err;
    }
    if (opts.onPartial) opts.onPartial(text);
    return { text, direction };
  } catch (err) {
    const provider = (config.free && config.free.provider) || 'microsoft';
    const ctx = engine === 'llm'
      ? { kind: 'llm', service: err && err.service }
      : { kind: 'free', service: provider === 'google' ? 'google' : 'microsoft' };
    asUserError(err, ctx);
  }
}

module.exports = { translate, resolveDirection };
