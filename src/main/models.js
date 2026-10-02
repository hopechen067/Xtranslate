'use strict';

// 设置页"模型"下拉框的选项：预设里精选的在前；OpenRouter 免费模型更新很快，再联网补上最新的。
const { getProvider, NO_THINK_OPENROUTER } = require('./providers');
const { fetchWithTimeout } = require('./engines/http');

const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const CACHE_MS = 60 * 60 * 1000;
const MAX_EXTRA = 8;
// 审核、写代码、多模态这类专用模型不适合拿来翻译；4B 以下的小模型译文质量不行
const UNSUITABLE = /safety|guard|code|coder|embed|vision|-vl\b|omni|ocr|audio|image|poolside|lfm-|[-_][0-3](\.\d+)?b\b/i;

let cache = null; // { at, models }

function pickFreeModels(data, exclude, limit = MAX_EXTRA) {
  const skip = new Set(exclude);
  return (Array.isArray(data) ? data : [])
    .filter((m) => m && typeof m.id === 'string' && m.id.endsWith(':free'))
    .filter((m) => !skip.has(m.id) && !UNSUITABLE.test(m.id))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .slice(0, limit)
    .map((m) => ({ id: m.id, free: 'free', extra: NO_THINK_OPENROUTER, live: true }));
}

async function fetchOpenRouterFree(exclude, fetchImpl) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  const res = await fetchWithTimeout(OPENROUTER_MODELS, {}, { timeoutMs: 6000, service: 'openrouter.ai', fetchImpl });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const models = pickFreeModels(json && json.data, exclude);
  cache = { at: Date.now(), models };
  return models;
}

/** @returns {Promise<Array<{id: string, free?: string, note?: string, live?: boolean}>>} */
async function listModels(providerId, { fetchImpl, warn } = {}) {
  const provider = getProvider(providerId);
  const curated = (provider.models || []).map(({ extra, ...rest }) => rest);
  if (provider.id !== 'openrouter') return curated;
  try {
    const live = await fetchOpenRouterFree(curated.map((m) => m.id), fetchImpl);
    return [...curated, ...live.map(({ extra, ...rest }) => rest)];
  } catch (err) {
    if (warn) warn(`获取 OpenRouter 免费模型失败：${err && err.message}`);
    return curated;
  }
}

module.exports = { listModels, pickFreeModels };
