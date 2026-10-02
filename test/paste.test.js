'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldRestoreClipboard, snapshotClipboard, writeSnapshot, inputStructSize } = require('../src/main/paste');

test('Win32 INPUT 结构按 64 位对齐是 40 字节', { skip: process.platform !== 'win32' }, () => {
  assert.equal(inputStructSize(), 40);
});

test('换行差异不影响“是不是我们写进去的”判断', () => {
  assert.equal(shouldRestoreClipboard('a\r\nb', 'a\nb'), true);
  assert.equal(shouldRestoreClipboard('user copied', 'translation'), false);
});

test('剪贴板快照能带回文本、HTML、RTF 和图片', () => {
  const image = { isEmpty: () => false, id: 'img' };
  const written = [];
  const clipboard = {
    text: 'old',
    html: '<b>old</b>',
    rtf: '{\\rtf old}',
    image,
    readText: () => clipboard.text,
    readHTML: () => clipboard.html,
    readRTF: () => clipboard.rtf,
    readImage: () => clipboard.image,
    writeText: (value) => {
      clipboard.text = value;
    },
    write: (payload) => written.push(payload),
    clear: () => written.push('clear'),
  };
  const snap = snapshotClipboard(clipboard);
  clipboard.writeText('translated');
  assert.equal(shouldRestoreClipboard(clipboard.readText(), 'translated'), true);
  writeSnapshot(clipboard, snap);
  assert.equal(written[0].text, 'old');
  assert.equal(written[0].html, '<b>old</b>');
  assert.equal(written[0].rtf, '{\\rtf old}');
  assert.equal(written[0].image, image);

  clipboard.readText = () => 'user copied later';
  assert.equal(shouldRestoreClipboard(clipboard.readText(), 'translated'), false);
});
