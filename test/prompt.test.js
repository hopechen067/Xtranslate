'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDirection, buildPrompt, cleanOutput } = require('../src/main/prompt');

test('detectDirection 按汉字和拉丁字母的大致词数判断', () => {
  assert.equal(detectDirection(''), 'zh2en');
  assert.equal(detectDirection('   '), 'zh2en');
  assert.equal(detectDirection('你好'), 'zh2en');
  assert.equal(detectDirection('Hello'), 'en2zh');
  assert.equal(detectDirection('Hello world, this is a long sentence'), 'en2zh');
  assert.equal(detectDirection('我明天有个 meeting'), 'zh2en');
});

test('buildPrompt 包住原文，并按方向选系统提示', () => {
  const zh = buildPrompt('我先撤了', 'auto');
  assert.equal(zh.direction, 'zh2en');
  assert.equal(zh.temperature, 0.3);
  assert.match(zh.system, /英语母语者/);
  assert.equal(zh.user, '<text>\n我先撤了\n</text>');

  const en = buildPrompt('see you', 'en2zh');
  assert.equal(en.direction, 'en2zh');
  assert.match(en.system, /发微信/);
  assert.equal(en.user, '<text>\nsee you\n</text>');

  const forced = buildPrompt('Hello', 'zh2en');
  assert.equal(forced.direction, 'zh2en');
});

test('cleanOutput 去掉包装、前缀和外层引号', () => {
  assert.equal(cleanOutput('  译文：你好 '), '你好');
  assert.equal(cleanOutput('Translation: hello'), 'hello');
  assert.equal(cleanOutput('<text>\nhi\n</text>'), 'hi');
  assert.equal(cleanOutput('"hello"'), 'hello');
  assert.equal(cleanOutput('“你好”'), '你好');
  assert.equal(cleanOutput('「好的」'), '好的');
  assert.equal(cleanOutput('say "hi" now'), 'say "hi" now');
  assert.equal(cleanOutput(''), '');
});
