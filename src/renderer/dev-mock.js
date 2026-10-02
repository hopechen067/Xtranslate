'use strict';
// 仅在浏览器里直接打开页面预览时生效；Electron 里 preload 已提供 window.xt。
if (!window.xt) {
  const listeners = { partial: [], show: [], config: [] };
  let cfg = {
    hotkey: 'Alt+Q', engine: 'free', free: { provider: 'microsoft' },
    llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKeySet: false },
    livePreview: true, previewDelayMs: 500, restoreClipboard: true, launchAtLogin: false,
  };
  const canned = { '我先撤了哈，明天见': "I'm heading out, see you tomorrow!", 'No worries, take your time!': '没事没事，你慢慢来！' };
  const timers = {};
  const merge = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge({ ...(a[k] || {}) }, b[k]) : b[k]; return a; };
  window.xt = {
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
      { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', models: ['deepseek-chat'], keyUrl: 'https://platform.deepseek.com/api_keys' },
      { id: 'anthropic', name: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5', models: ['claude-haiku-4-5', 'claude-sonnet-5-5'], keyUrl: 'https://console.anthropic.com/settings/keys' },
      { id: 'ollama', name: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', models: [], keyOptional: true },
      { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '', models: [] },
    ],
    testEngine: async ({ engine }) => engine === 'llm' && !cfg.llm.apiKeySet
      ? { ok: false, error: '还没填大模型的 API Key，去设置里填一下' }
      : { ok: true, sample: "I'm heading out, see you tomorrow!", ms: 420 },
    openSettings: () => console.log('[mock] openSettings'),
    onConfigChanged: (cb) => listeners.config.push(cb),
  };
  document.documentElement.style.background = '#8a93a3';
}
