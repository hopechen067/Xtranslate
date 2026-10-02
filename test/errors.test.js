'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { userMessage } = require('../src/main/errors');
const { translate } = require('../src/main/engines');

test('HTTP 状态映射成中文短句', () => {
  assert.equal(userMessage({ status: 401 }, { kind: 'llm' }), 'API Key 无效或没有权限');
  assert.equal(userMessage({ status: 403 }, { kind: 'llm' }), 'API Key 无效或没有权限');
  assert.equal(userMessage({ status: 404 }, { kind: 'llm' }), '模型名或接口地址不对');
  assert.equal(
    userMessage({ status: 404 }, { kind: 'free', service: 'microsoft' }),
    '微软翻译的免费接口不可用，换一个引擎或改用大模型试试',
  );
  assert.equal(userMessage({ status: 429 }, { kind: 'llm' }), '请求太频繁或额度用完了');
  assert.equal(userMessage({ code: 'NO_KEY' }), '还没填大模型的 API Key，去设置里填一下');
});

test('免费引擎的网络错误点名服务，并建议换引擎', () => {
  assert.equal(
    userMessage({ code: 'NETWORK', service: 'google' }, { kind: 'free', service: 'google' }),
    '网络连不上 Google，换微软或大模型试试',
  );
  assert.equal(
    userMessage({ code: 'TIMEOUT', service: 'microsoft' }, { kind: 'free', service: 'microsoft' }),
    '连接微软翻译超时，换 Google 或大模型试试',
  );
  assert.equal(
    userMessage({ status: 401 }, { kind: 'free', service: 'microsoft' }),
    '微软翻译拒绝了这次请求，换一个引擎或改用大模型试试',
  );
});

test('抛出的错误里不包含 API Key', async () => {
  const secret = 'sk-super-secret-key';
  await assert.rejects(
    () => translate({
      text: '你好',
      direction: 'zh2en',
      engine: 'llm',
      config: {
        llm: {
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-chat',
          apiKey: secret,
        },
      },
      fetchImpl: async () => {
        const err = new Error(`connect ${secret} failed`);
        throw err;
      },
    }),
    (err) => {
      assert.equal(err.message.includes(secret), false);
      assert.match(err.message, /网络连不上/);
      return true;
    },
  );
});
