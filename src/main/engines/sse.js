'use strict';

/** 从缓冲区切出完整 SSE 事件，返回 data 负载（不含 "data:" 前缀）。 */
function extractSSEEvents(buffer) {
  const text = String(buffer).replace(/\r\n/g, '\n');
  const events = [];
  let rest = text;
  let idx;
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const data = dataFromBlock(block);
    if (data != null) events.push(data);
  }
  return { events, rest };
}

function dataFromBlock(block) {
  const lines = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!lines.length) return null;
  return lines.join('\n');
}

/**
 * 读取 fetch body，逐个交出 SSE data 字符串。
 * @param {ReadableStream} body
 * @param {(data: string) => void} onData
 */
async function readSSE(body, onData) {
  if (!body || typeof body.getReader !== 'function') {
    throw Object.assign(new Error('no stream'), { code: 'BAD_RESPONSE' });
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const extracted = extractSSEEvents(pending);
    pending = extracted.rest;
    for (const ev of extracted.events) onData(ev);
  }
  pending += decoder.decode();
  if (pending.trim()) {
    const flushed = extractSSEEvents(pending + '\n\n');
    for (const ev of flushed.events) onData(ev);
  }
}

/** OpenAI 兼容流：choices[0].delta.content，[DONE] 结束。 */
function takeOpenAIDelta(dataStr) {
  const trimmed = String(dataStr).trim();
  if (trimmed === '[DONE]') return { done: true, delta: '' };
  const json = JSON.parse(trimmed);
  const choice = json && json.choices && json.choices[0];
  const delta = choice && choice.delta && choice.delta.content;
  return { done: false, delta: typeof delta === 'string' ? delta : '' };
}

/** Anthropic 流：content_block_delta 里的 delta.text。 */
function takeAnthropicDelta(dataStr) {
  const json = JSON.parse(String(dataStr).trim());
  if (json && json.type === 'content_block_delta' && json.delta && typeof json.delta.text === 'string') {
    return json.delta.text;
  }
  return '';
}

module.exports = {
  extractSSEEvents,
  readSSE,
  takeOpenAIDelta,
  takeAnthropicDelta,
};
