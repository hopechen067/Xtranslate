'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PROVIDERS, getProvider, modelExtra } = require('../src/main/providers');
const { translateLLM } = require('../src/main/engines/llm');
const { pickFreeModels } = require('../src/main/models');

test('每个预设的默认模型都在自己的模型列表里，免费标记只用 free / quota', () => {
  for (const p of PROVIDERS) {
    if (!p.models.length) continue;
    assert.ok(p.models.some((m) => m.id === p.model), p.id);
    for (const m of p.models) assert.ok(m.free === undefined || m.free === 'free' || m.free === 'quota', m.id);
  }
  assert.equal(getProvider('nope').id, 'custom');
});

test('预设模型的额外参数会进请求体，自定义模型名不带', async () => {
  assert.deepEqual(modelExtra('zhipu', 'glm-4.7-flash'), { thinking: { type: 'disabled' } });
  assert.deepEqual(modelExtra('zhipu', 'my-own-model'), {});
  let body;
  await translateLLM({
    text: '你好',
    direction: 'zh2en',
    llm: { provider: 'deepseek', baseUrl: 'https://example.com', model: 'deepseek-flash', apiKey: 'k' },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({ start(c) { c.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }),
      };
    },
  });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.stream, true);
});

test('OpenRouter 免费模型：只留 :free、去掉已推荐的和不适合翻译的，按上下文排序截断', () => {
  const data = [
    { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', context_length: 262144 },
    { id: 'foo/bar:free', name: 'Bar (free)', context_length: 8000 },
    { id: 'foo/big:free', name: 'Big (free)', context_length: 128000 },
    { id: 'nvidia/nemotron-3.5-content-safety:free', name: 'Safety', context_length: 128000 },
    { id: 'cohere/north-mini-code:free', name: 'Code', context_length: 256000 },
    { id: 'paid/model', name: 'Paid', context_length: 999999 },
  ];
  const out = pickFreeModels(data, ['google/gemma-4-31b-it:free'], 10);
  assert.deepEqual(out.map((m) => m.id), ['foo/big:free', 'foo/bar:free']);
  assert.equal(out[0].free, 'free');
  assert.equal(out[0].extra.reasoning.enabled, false);
  assert.equal(pickFreeModels(data, [], 1).length, 1);
});

function okStream(text) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(Buffer.from(`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\ndata: [DONE]\n\n`)); c.close(); } }),
  };
}
const busy = () => ({ ok: false, status: 429, text: async () => '' });
const orLLM = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', apiKey: 'k' };

test('OpenRouter 免费模型带上最多 3 个备用模型并关闭思考；付费模型不带', () => {
  const extra = modelExtra('openrouter', 'google/gemma-4-31b-it:free');
  assert.equal(extra.models.length, 3);
  assert.equal(extra.models[0], 'google/gemma-4-31b-it:free');
  assert.equal(new Set(extra.models).size, 3);
  assert.deepEqual(extra.reasoning, { enabled: false });
  assert.equal(modelExtra('openrouter', 'some/new-model:free').models[0], 'some/new-model:free');
  assert.deepEqual(modelExtra('openrouter', 'deepseek/deepseek-chat'), {});
});

test('免费模型 429 时自动重试一次，成功就返回', async () => {
  let calls = 0;
  const text = await translateLLM({
    text: '你好', direction: 'zh2en', llm: orLLM, retryDelayMs: 1,
    fetchImpl: async () => (++calls === 1 ? busy() : okStream('Hi')),
  });
  assert.equal(text, 'Hi');
  assert.equal(calls, 2);
});

test('免费模型重试后仍 429，报"免费模型太忙"', async () => {
  let calls = 0;
  await assert.rejects(
    translateLLM({ text: '你好', direction: 'zh2en', llm: orLLM, retryDelayMs: 1, fetchImpl: async () => { calls++; return busy(); } }),
    (err) => err.code === 'FREE_BUSY',
  );
  assert.equal(calls, 2);
  const { userMessage } = require('../src/main/errors');
  assert.match(userMessage({ code: 'FREE_BUSY' }), /免费模型这会儿太忙/);
});
