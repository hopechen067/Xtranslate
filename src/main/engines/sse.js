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

/**
 * OpenAI 兼容流：choices[0].delta.content，[DONE] 结束。
 * 推理模型（DeepSeek/Qwen 等）会先流出 reasoning_content（OpenRouter 叫 reasoning），只计数不显示。
 */
function takeOpenAIDelta(dataStr) {
  const trimmed = String(dataStr).trim();
  if (trimmed === '[DONE]') return { done: true, delta: '', reasoning: '' };
  const json = JSON.parse(trimmed);
  const d = (json && json.choices && json.choices[0] && json.choices[0].delta) || {};
  const reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content
    : typeof d.reasoning === 'string' ? d.reasoning : '';
  return { done: false, delta: typeof d.content === 'string' ? d.content : '', reasoning };
}

/** Anthropic 流：content_block_delta 里的 delta.text（thinking_delta 只计数）。 */
function takeAnthropicDelta(dataStr) {
  const json = JSON.parse(String(dataStr).trim());
  if (json && json.type === 'content_block_delta' && json.delta) {
    if (typeof json.delta.text === 'string') return { delta: json.delta.text, reasoning: '' };
    if (typeof json.delta.thinking === 'string') return { delta: '', reasoning: json.delta.thinking };
  }
  return { delta: '', reasoning: '' };
}

module.exports = {
  extractSSEEvents,
  readSSE,
  takeOpenAIDelta,
  takeAnthropicDelta,
};
