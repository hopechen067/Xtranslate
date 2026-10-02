'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSSEEvents, takeOpenAIDelta, takeAnthropicDelta } = require('../src/main/engines/sse');
const { translateLLM, joinUrl, maxTokensFor } = require('../src/main/engines/llm');

function streamFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

function sseResponse(chunks, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: streamFrom(chunks),
    text: async () => '',
  };
}

test('SSE 事件可以跨分片，OpenAI 与 Anthropic 各取各的增量', () => {
  const split = extractSSEEvents('data: {"choices":[{"delta":{"content":"He"');
  assert.equal(split.events.length, 0);
  const rest = extractSSEEvents(split.rest + '}}]}\n\ndata: [DONE]\n\n');
  assert.deepEqual(rest.events, ['{"choices":[{"delta":{"content":"He"}}]}', '[DONE]']);
  assert.deepEqual(takeOpenAIDelta(rest.events[0]), { done: false, delta: 'He', reasoning: '' });
  assert.deepEqual(takeOpenAIDelta(rest.events[1]), { done: true, delta: '', reasoning: '' });

  const anthropic = extractSSEEvents(
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  );
  assert.deepEqual(takeAnthropicDelta(anthropic.events[0]), { delta: '你', reasoning: '' });
  assert.deepEqual(takeAnthropicDelta(anthropic.events[1]), { delta: '', reasoning: '' });
});

test('OpenAI 兼容流：累计 partial，结束时清理前缀，baseUrl 末尾斜杠可有可无', async () => {
  const partials = [];
  let seen;
  const text = await translateLLM({
    text: '你好',
    direction: 'zh2en',
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://example.com/v1/',
      model: 'demo',
      apiKey: 'sk-test',
    },
    onPartial: (value) => partials.push(value),
    fetchImpl: async (url, options) => {
      seen = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"译文："}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    },
  });
  assert.equal(seen.url, 'https://example.com/v1/chat/completions');
  assert.equal(seen.headers.Authorization, 'Bearer sk-test');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.max_tokens, maxTokensFor('你好'));
  assert.equal(seen.body.temperature, 0.3);
  assert.equal(seen.body.messages[0].role, 'system');
  assert.equal(seen.body.messages[1].content, '<text>\n你好\n</text>');
  assert.deepEqual(partials, ['译文：', '译文：Hello']);
  assert.equal(text, 'Hello');
  assert.equal(joinUrl('https://example.com/v1/', '/chat/completions'), 'https://example.com/v1/chat/completions');
});

test('Anthropic 流解析 content_block_delta，并带上要求的头', async () => {
  const partials = [];
  let seen;
  const text = await translateLLM({
    text: 'hello',
    direction: 'en2zh',
    llm: {
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:9',
      model: 'claude-test',
      apiKey: 'sk-ant',
    },
    onPartial: (value) => partials.push(value),
    fetchImpl: async (url, options) => {
      seen = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
      return sseResponse([
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","delta":{"text":"你"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"好"}}\n\n',
      ]);
    },
  });
  assert.equal(seen.url, 'http://127.0.0.1:9/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'sk-ant');
  assert.equal(seen.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.system.includes('发微信'), true);
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: '<text>\nhello\n</text>' }]);
  assert.deepEqual(partials, ['你', '你好']);
  assert.equal(text, '你好');
  assert.equal(maxTokensFor('a'.repeat(2000)), 8192);
  assert.equal(maxTokensFor('你好'), 2048);
});

test('没填 Key 时不发请求', async () => {
  let called = 0;
  await assert.rejects(
    () => translateLLM({
      text: '你好',
      direction: 'zh2en',
      llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' },
      fetchImpl: () => {
        called += 1;
        throw new Error('no');
      },
    }),
    (err) => {
      assert.equal(err.code, 'NO_KEY');
      return true;
    },
  );
  assert.equal(called, 0);
});

test('AbortSignal 会取消流式请求', async () => {
  const ac = new AbortController();
  await assert.rejects(
    () => translateLLM({
      text: '你好',
      direction: 'zh2en',
      signal: ac.signal,
      llm: { provider: 'openai', baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'sk' },
      fetchImpl: async (_url, options) => {
        ac.abort();
        if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        return sseResponse(['data: [DONE]\n\n']);
      },
    }),
    (err) => err.code === 'CANCEL' || err.message === 'cancel',
  );
});

function sseResponse(chunks) {
  const enc = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }),
  };
}

test('推理模型：reasoning_content 不进译文，只思考没给译文时报明确的错', async () => {
  const think = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: null, reasoning_content: t } }] })}\n\n`;
  const say = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
  const llm = { provider: 'deepseek', baseUrl: 'https://x', model: 'm', apiKey: 'k' };
  const partials = [];
  const out = await translateLLM({
    text: '你好', direction: 'zh2en', llm, onPartial: (p) => partials.push(p),
    fetchImpl: async () => sseResponse([think('The user'), think(' wants'), say('Hey'), say('!'), 'data: [DONE]\n\n']),
  });
  assert.equal(out, 'Hey!');
  assert.deepEqual(partials, ['Hey', 'Hey!']);

  await assert.rejects(
    translateLLM({ text: '你好', direction: 'zh2en', llm, fetchImpl: async () => sseResponse([think('thinking...'), 'data: [DONE]\n\n']) }),
    (err) => err.code === 'REASONING_ONLY',
  );
  await assert.rejects(
    translateLLM({ text: '你好', direction: 'zh2en', llm, fetchImpl: async () => sseResponse(['data: [DONE]\n\n']) }),
    (err) => err.code === 'EMPTY',
  );
});
