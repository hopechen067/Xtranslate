'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  hotkey: 'Alt+Q',
  engine: 'free',
  free: { provider: 'microsoft' },
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',   // 当前服务商的 Key（仅内存，由 apiKeys 推出）
    apiKeys: {},  // 每个服务商各存一份，切换服务商时不会把 A 的 Key 发给 B
  },
  livePreview: true,
  previewDelayMs: 500,
  restoreClipboard: true,
  launchAtLogin: false,
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深合并。数组和标量直接覆盖。
 * llm.apiKey 为空字符串、null 或缺省时保留原来的 Key。
 */
function deepMerge(base, patch) {
  if (patch === undefined) return clone(base);
  if (!isPlainObject(patch)) return clone(patch);
  const out = isPlainObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'apiKey' && (value === '' || value == null)) continue;
    if (isPlainObject(value)) out[key] = deepMerge(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function applyDefaults(config) {
  const out = deepMerge(DEFAULT_CONFIG, config || {});
  out.llm.apiKey = (out.llm.apiKeys && out.llm.apiKeys[out.llm.provider]) || '';
  return out;
}

/** 合并配置；llm.apiKey 非空时写进"合并后服务商"那一格。 */
function mergeConfig(base, partial) {
  const p = clone(partial || {});
  const newKey = p.llm && p.llm.apiKey;
  if (p.llm) delete p.llm.apiKey;
  const next = deepMerge(base, p);
  if (typeof newKey === 'string' && newKey) {
    next.llm.apiKeys = { ...(next.llm.apiKeys || {}), [next.llm.provider]: newKey };
  }
  return applyDefaults(next);
}

/** 给渲染进程的配置：没有明文 Key，只有 apiKeySet。 */
function toPublicConfig(config) {
  const pub = applyDefaults(config);
  const key = pub.llm && pub.llm.apiKey;
  pub.llm.apiKeySet = typeof key === 'string' && key.length > 0;
  delete pub.llm.apiKey;
  delete pub.llm.apiKeys;
  return pub;
}

function encryptionAvailable(safeStorage) {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function sealApiKey(plain, safeStorage, warn, state) {
  if (!plain) return '';
  if (encryptionAvailable(safeStorage)) {
    try {
      const buf = safeStorage.encryptString(plain);
      return `enc:${Buffer.from(buf).toString('base64')}`;
    } catch {
      // 落到明文分支
    }
  }
  if (warn && state && !state.warnedPlain) {
    state.warnedPlain = true;
    warn('safeStorage 不可用，API Key 将以明文保存');
  }
  return `plain:${plain}`;
}

function openApiKey(stored, safeStorage, warn) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      if (warn) warn('API Key 解密失败，需要在设置里重新填写');
      return '';
    }
  }
  if (stored.startsWith('plain:')) return stored.slice(6);
  return stored;
}

function createConfigStore({ filePath, safeStorage, warn }) {
  const state = { warnedPlain: false };
  let current = applyDefaults(null);

  function persist(config) {
    const disk = clone(config);
    delete disk.llm.apiKey;
    disk.llm.apiKeys = {};
    for (const [id, key] of Object.entries(config.llm.apiKeys || {})) {
      if (key) disk.llm.apiKeys[id] = sealApiKey(key, safeStorage, warn, state);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(disk, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function load() {
    let disk = null;
    try {
      disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      if (err && err.code !== 'ENOENT' && warn) warn('配置文件读不了，已改用默认配置');
      disk = null;
    }
    const stored = { ...((disk && disk.llm && disk.llm.apiKeys) || {}) };
    // 旧格式：单个 llm.apiKey 归到当时的服务商
    const legacy = disk && disk.llm && disk.llm.apiKey;
    if (legacy && !stored[disk.llm.provider || DEFAULT_CONFIG.llm.provider]) {
      stored[disk.llm.provider || DEFAULT_CONFIG.llm.provider] = legacy;
    }
    const keys = {};
    let needsReseal = !!legacy;
    for (const [id, sealed] of Object.entries(stored)) {
      const plain = openApiKey(sealed, safeStorage, warn);
      if (plain) keys[id] = plain;
      if (String(sealed).startsWith('plain:') && !encryptionAvailable(safeStorage) && warn && !state.warnedPlain) {
        state.warnedPlain = true;
        warn('safeStorage 不可用，API Key 将以明文保存');
      }
      if (!String(sealed).startsWith('enc:') && plain && encryptionAvailable(safeStorage)) needsReseal = true;
    }
    if (disk && disk.llm) { delete disk.llm.apiKey; delete disk.llm.apiKeys; }
    current = mergeConfig(applyDefaults(disk), { llm: { apiKeys: keys } });
    if (needsReseal && Object.keys(keys).length) persist(current);
  }

  function get() {
    return clone(current);
  }

  function getPublic() {
    return toPublicConfig(current);
  }

  function set(partial) {
    const next = mergeConfig(current, partial);
    persist(next);
    current = next;
    return getPublic();
  }

  load();
  return { get, getPublic, set, load };
}

module.exports = {
  DEFAULT_CONFIG,
  deepMerge,
  mergeConfig,
  applyDefaults,
  toPublicConfig,
  sealApiKey,
  openApiKey,
  createConfigStore,
};
