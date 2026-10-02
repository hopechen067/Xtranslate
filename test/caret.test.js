'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePopupPosition, guiThreadInfoSize } = require('../src/main/caret');

const SIZE = { width: 560, height: 140 };
const RESERVE = 320;

test('GUITHREADINFO 在 64 位 Windows 上是 72 字节', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
}, () => {
  assert.equal(guiThreadInfoSize(), 72);
});

test('锚点下方空间够时，浮窗贴在光标下沿', () => {
  const pos = computePopupPosition({
    anchor: { x: 400, y: 300, width: 1, height: 18 },
    size: SIZE,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  assert.deepEqual(pos, { x: 376, y: 324, above: false });
});

test('按预留高度判断下方放不下时，改放到锚点上方', () => {
  const pos = computePopupPosition({
    anchor: { x: 400, y: 900, width: 1, height: 18 },
    size: SIZE,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  // 下沿 918 + 6 + 320 超出 1080；上方时底部贴住锚点顶 - 6
  assert.deepEqual(pos, { x: 376, y: 754, above: true });
});

test('当前窗口已经高于预留高度时，用当前高度判断放不放得下', () => {
  const pos = computePopupPosition({
    anchor: { x: 400, y: 700, width: 1, height: 20 },
    size: { width: 560, height: 400 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  assert.equal(pos.above, true);
  assert.equal(pos.y, 700 - 6 - 400);
});

test('贴左、贴右、贴上时夹进工作区', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const left = computePopupPosition({
    anchor: { x: 10, y: 300, width: 1, height: 18 },
    size: SIZE,
    workArea,
    reserve: RESERVE,
  });
  assert.equal(left.x, 0);
  assert.equal(left.above, false);

  const right = computePopupPosition({
    anchor: { x: 1800, y: 300, width: 1, height: 18 },
    size: SIZE,
    workArea,
    reserve: RESERVE,
  });
  assert.equal(right.x, 1920 - 560);
  assert.equal(right.above, false);

  const top = computePopupPosition({
    anchor: { x: 400, y: 20, width: 1, height: 16 },
    size: SIZE,
    workArea: { x: 0, y: 0, width: 1920, height: 200 },
    reserve: RESERVE,
  });
  assert.equal(top.above, true);
  assert.equal(top.y, 0);
  assert.equal(top.x, 376);
});

test('锚点在右侧副屏时，夹紧范围跟着那块工作区走', () => {
  const pos = computePopupPosition({
    anchor: { x: 3700, y: 100, width: 1, height: 20 },
    size: SIZE,
    workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  assert.deepEqual(pos, { x: 3280, y: 126, above: false });
});

test('锚点在左侧或上方的副屏（工作区坐标为负）时同样夹紧', () => {
  const below = computePopupPosition({
    anchor: { x: -800, y: 40, width: 2, height: 16 },
    size: SIZE,
    workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  assert.deepEqual(below, { x: -824, y: 62, above: false });

  const seam = computePopupPosition({
    anchor: { x: -100, y: 40, width: 2, height: 16 },
    size: SIZE,
    workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
    reserve: RESERVE,
  });
  assert.equal(seam.x, -560);
  assert.equal(seam.y, 62);

  const above = computePopupPosition({
    anchor: { x: -800, y: -180, width: 2, height: 16 },
    size: SIZE,
    workArea: { x: -1920, y: -200, width: 1920, height: 220 },
    reserve: RESERVE,
  });
  assert.equal(above.above, true);
  assert.equal(above.x, -824);
  assert.equal(above.y, -200);
});
