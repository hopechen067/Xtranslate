'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deepMerge, toPublicConfig, createConfigStore, DEFAULT_CONFIG } = require('../src/main/config');

const SECRET = 'sk-config-secret-value';

function xorStorage(available) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(String(plain).split('').map((ch) => String.fromCharCode(ch.charCodeAt(0) ^ 0x5a)).join(''), 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').split('').map((ch) => String.fromCharCode(ch.charCodeAt(0) ^ 0x5a)).join(''),
  };
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-cfg-'));
  return path.join(dir, 'config.json');
}

test('深合并保留未出现的字段，空 apiKey 不覆盖', () => {
  const base = deepMerge(DEFAULT_CONFIG, {
    llm: { apiKey: SECRET, model: 'old' },
    previewDelayMs: 800,
  });
  const merged = deepMerge(base, { llm: { model: 'new', apiKey: '' }, engine: 'llm' });
  assert.equal(merged.llm.apiKey, SECRET);
  assert.equal(merged.llm.model, 'new');
  assert.equal(merged.llm.baseUrl, DEFAULT_CONFIG.llm.baseUrl);
  assert.equal(merged.previewDelayMs, 800);
  assert.equal(merged.engine, 'llm');
  assert.equal(merged.free.provider, 'microsoft');

  const omitted = deepMerge(base, { llm: { provider: 'openai' } });
  assert.equal(omitted.llm.apiKey, SECRET);
  assert.equal(omitted.llm.provider, 'openai');
});

test('公开配置只有 apiKeySet，序列化结果里没有明文 Key', () => {
  const pub = toPublicConfig({ llm: { apiKey: SECRET, model: 'm' } });
  assert.equal(pub.llm.apiKeySet, true);
  assert.equal('apiKey' in pub.llm, false);
  assert.equal(JSON.stringify(pub).includes(SECRET), false);

  const empty = toPublicConfig({ llm: { apiKey: '' } });
  assert.equal(empty.llm.apiKeySet, false);
});

test('加密可用时落盘不含明文，读回后内存里有 Key，公开接口没有', () => {
  const file = tmpFile();
  const warnings = [];
  const store = createConfigStore({
    filePath: file,
    safeStorage: xorStorage(true),
    warn: (message) => warnings.push(message),
  });
  const pub = store.set({ llm: { apiKey: SECRET } });
  const disk = fs.readFileSync(file, 'utf8');
  assert.equal(disk.includes(SECRET), false);
  assert.match(disk, /"apiKey": "enc:/);
  assert.equal(pub.llm.apiKeySet, true);
  assert.equal(JSON.stringify(pub).includes(SECRET), false);
  assert.equal(store.get().llm.apiKey, SECRET);
  assert.equal(warnings.length, 0);

  const reloaded = createConfigStore({
    filePath: file,
    safeStorage: xorStorage(true),
    warn: (message) => warnings.push(message),
  });
  assert.equal(reloaded.get().llm.apiKey, SECRET);
  assert.equal(reloaded.getPublic().llm.apiKeySet, true);
  assert.equal(JSON.stringify(reloaded.getPublic()).includes(SECRET), false);
});

test('加密不可用时降级明文并警告一次', () => {
  const file = tmpFile();
  const warnings = [];
  const store = createConfigStore({
    filePath: file,
    safeStorage: xorStorage(false),
    warn: (message) => warnings.push(message),
  });
  store.set({ llm: { apiKey: SECRET } });
  const disk = fs.readFileSync(file, 'utf8');
  assert.match(disk, new RegExp(`plain:${SECRET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /明文/);

  store.set({ previewDelayMs: 900 });
  assert.equal(warnings.length, 1);
  assert.equal(store.getPublic().llm.apiKeySet, true);
  assert.equal(JSON.stringify(store.getPublic()).includes(SECRET), false);
});
