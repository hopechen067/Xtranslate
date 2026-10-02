'use strict';
// 仅在浏览器里直接打开页面预览时生效；Electron 里 preload 已提供 window.xt。
if (!window.xt) {
  const listeners = { partial: [], show: [], config: [] };
  let cfg = {
    hotkey: 'Alt+Q', engine: 'free', free: { provider: 'microsoft' },
    llm: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash-250414', apiKeySet: false },
    livePreview: true, previewDelayMs: 500, restoreClipboard: true, launchAtLogin: false,
  };
  const canned = { '我先撤了哈，明天见': "I'm heading out, see you tomorrow!", 'No worries, take your time!': '没事没事，你慢慢来！' };
  const timers = {};
  const merge = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge({ ...(a[k] || {}) }, b[k]) : b[k]; return a; };
  // 和 contextBridge 一样定义成不可重声明的全局，页面里再写 const xt 会像在 Electron 里一样报错
  Object.defineProperty(window, 'xt', { configurable: false, enumerable: true, writable: false, value: {
    translate({ id, text, engine }) {
      const full = canned[text.trim()] || (/[一-鿿]/.test(text) ? `(mock EN) ${text}` : `（模拟中文）${text}`);
      if ((engine || cfg.engine) === 'llm' && !cfg.llm.apiKeySet) return Promise.reject(new Error('还没填大模型的 API Key，去设置里填一下'));
      return new Promise((resolve) => {
        let i = 0;
        timers[id] = setInterval(() => {
          i += 3;
          listeners.partial.forEach((cb) => cb({ id, text: full.slice(0, i) }));
          if (i >= full.length) { clearInterval(timers[id]); resolve({ id, text: full, engine: engine || cfg.engine, direction: 'auto', ms: 300 }); }
        }, 40);
      });
    },
    onPartial: (cb) => listeners.partial.push(cb),
    cancel: (id) => clearInterval(timers[id]),
    commit: async (text) => console.log('[mock] commit:', text),
    hide: () => console.log('[mock] hide'),
    resize: () => {},
    onShow: (cb) => listeners.show.push(cb),
    getConfig: async () => structuredClone(cfg),
    setConfig: async (p) => {
      if (p.hotkey === 'Ctrl+C') throw new Error('这个组合键被占用了');
      const { apiKey, ...llm } = p.llm || {};
      cfg = merge(cfg, { ...p, ...(p.llm ? { llm } : {}) });
      if (apiKey) cfg.llm.apiKeySet = true;
      listeners.config.forEach((cb) => cb(structuredClone(cfg)));
      return structuredClone(cfg);
    },
    getProviders: async () => [
      { id: 'zhipu', name: '智谱 GLM · 免费', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash-250414', note: '国内直连，长期免费', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', models: [{ id: 'glm-4-flash-250414', free: 'free', note: '推荐 · 最快' }, { id: 'glm-4.7-flash', free: 'free', note: '新一代' }] },
      { id: 'openrouter', name: 'OpenRouter · 有免费模型', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', keyUrl: 'https://openrouter.ai/keys', models: [{ id: 'google/gemma-4-31b-it:free', free: 'free', note: '推荐' }, { id: 'deepseek/deepseek-chat' }] },
      { id: 'ollama', name: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', models: [], keyOptional: true },
      { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '', models: [] },
    ],
    listModels: async (id) => id === 'openrouter'
      ? [{ id: 'google/gemma-4-31b-it:free', free: 'free', note: '推荐' }, { id: 'deepseek/deepseek-chat' }, { id: 'qwen/qwen3.8-27b:free', free: 'free', live: true }]
      : [],
    testEngine: async ({ engine }) => engine === 'llm' && !cfg.llm.apiKeySet
      ? { ok: false, error: '还没填大模型的 API Key，去设置里填一下' }
      : { ok: true, sample: "I'm heading out, see you tomorrow!", ms: 420 },
    openSettings: () => console.log('[mock] openSettings'),
    onConfigChanged: (cb) => listeners.config.push(cb),
  } });
  document.documentElement.style.background = '#8a93a3';
}
