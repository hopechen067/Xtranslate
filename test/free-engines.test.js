'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translate } = require('../src/main/engines');
const {
  translateMicrosoft,
  parseMicrosoft,
  parseBingAuth,
  translateUrlFor,
  resetTokenCache,
} = require('../src/main/engines/microsoft');
const { parseGoogle } = require('../src/main/engines/google');

const PAGE_HTML = [
  'var params_AbusePreventionHelper = [123456,"tok-abc",3600000];',
  'IG:"AABBCCDD"',
  'data-iid="translator.5026"',
].join('\n');

function jsonResponse(status, body, extra = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: extra.url || '',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function pageResponse() {
  return jsonResponse(200, PAGE_HTML, { url: 'https://cn.bing.com/translator' });
}

test('空白输入不发请求', async () => {
  let called = 0;
  const result = await translate({
    text: '  \n',
    engine: 'free',
    config: { free: { provider: 'microsoft' } },
    fetchImpl: () => {
      called += 1;
      throw new Error('should not fetch');
    },
  });
  assert.equal(result.text, '');
  assert.equal(called, 0);
});

test('微软翻译：中到英、英到中，页面 token 会缓存，并跟着跳转到区域域名', async () => {
  resetTokenCache();
  const calls = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    calls.push({ href, body: options && options.body });
    if (href.includes('/translator') && !href.includes('ttranslatev3')) return pageResponse();
    const params = new URLSearchParams(options.body);
    const translated = params.get('to') === 'en' ? 'hello' : '你好';
    return jsonResponse(200, [{ translations: [{ text: translated }] }]);
  };

  const zh = await translateMicrosoft({ text: '你好', direction: 'zh2en', fetchImpl });
  const en = await translateMicrosoft({ text: 'hello', direction: 'en2zh', fetchImpl });
  assert.equal(zh, 'hello');
  assert.equal(en, '你好');
  assert.equal(calls.filter((call) => call.href.includes('/translator') && !call.href.includes('ttranslate')).length, 1);
  assert.match(calls[1].href, /^https:\/\/cn\.bing\.com\/ttranslatev3/);
  assert.match(calls[1].href, /IG=AABBCCDD/);
  assert.match(calls[1].href, /IID=translator\.5026/);
  assert.match(calls[1].body, /fromLang=zh-Hans/);
  assert.match(calls[1].body, /to=en/);
  assert.match(calls[2].body, /fromLang=en/);
  assert.match(calls[2].body, /to=zh-Hans/);
  assert.equal(parseMicrosoft([{ translations: [{ text: 'ok' }] }]), 'ok');
  assert.equal(parseBingAuth(PAGE_HTML, 1000).token, 'tok-abc');
  assert.equal(translateUrlFor('https://cn.bing.com/translator'), 'https://cn.bing.com/ttranslatev3');
});

test('微软翻译 token 失效（statusCode 205）时重取一次', async () => {
  resetTokenCache();
  let pages = 0;
  let posts = 0;
  const fetchImpl = async (url, options) => {
    const href = String(url);
    if (href.includes('/translator') && !href.includes('ttranslatev3')) {
      pages += 1;
      return pageResponse();
    }
    posts += 1;
    if (posts === 1) return jsonResponse(200, { statusCode: 205 });
    assert.equal(options.body.includes('tok-abc'), true);
    return jsonResponse(200, [{ translations: [{ text: 'hi' }] }]);
  };
  const text = await translateMicrosoft({ text: '你好', direction: 'zh2en', fetchImpl });
  assert.equal(text, 'hi');
  assert.equal(pages, 2);
});

test('Google 翻译解析多段结果，并按方向设置 tl', async () => {
  assert.equal(parseGoogle([[['Hello', '你好'], ['!', '']]]), 'Hello!');
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(200, [[['Hello', '你好']]]);
  };
  const result = await translate({
    text: '你好',
    direction: 'zh2en',
    engine: 'free',
    config: { free: { provider: 'google' } },
    fetchImpl,
  });
  assert.equal(result.text, 'Hello');
  assert.match(calls[0], /tl=en/);
  assert.match(calls[0], /sl=zh-CN/);

  await translate({
    text: 'hello',
    direction: 'en2zh',
    engine: 'free',
    config: { free: { provider: 'google' } },
    fetchImpl,
  });
  assert.match(calls[1], /tl=zh-CN/);
  assert.match(calls[1], /sl=en/);
});

test('Google 连不上时给出可切换的提示', async () => {
  await assert.rejects(
    () => translate({
      text: 'hi',
      direction: 'en2zh',
      engine: 'free',
      config: { free: { provider: 'google' } },
      fetchImpl: async () => {
        throw new Error('getaddrinfo');
      },
    }),
    (err) => {
      assert.equal(err.message, '网络连不上 Google，换微软或大模型试试');
      return true;
    },
  );
});
