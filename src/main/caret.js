'use strict';

const { loadWin32 } = require('./win32');

const POPUP_ALIGN_OFFSET = 24;
const POPUP_GAP = 6;
const DEFAULT_RESERVE = 320;

function hwndIsNull(api, hwnd) {
  if (hwnd == null) return true;
  try {
    const addr = api.koffi.address(hwnd);
    return addr === 0 || addr === 0n;
  } catch {
    return false;
  }
}

function caretRectIsEmpty(rc) {
  if (!rc) return true;
  return !rc.left && !rc.top && !rc.right && !rc.bottom;
}

/**
 * 目标窗口文字光标的屏幕物理像素矩形。非 Windows、没有光标或任何失败都返回 null。
 */
function getCaretRect(hwnd) {
  try {
    if (!hwnd) return null;
    const api = loadWin32();
    if (!api) return null;
    const threadId = api.GetWindowThreadProcessId(hwnd, [0]);
    if (!threadId) return null;
    const info = { cbSize: api.koffi.sizeof(api.GUITHREADINFO) };
    if (!api.GetGUIThreadInfo(threadId, info)) return null;
    if (hwndIsNull(api, info.hwndCaret) || caretRectIsEmpty(info.rcCaret)) return null;
    const pt = { x: info.rcCaret.left, y: info.rcCaret.top };
    if (!api.ClientToScreen(info.hwndCaret, pt)) return null;
    return {
      x: Number(pt.x),
      y: Number(pt.y),
      width: Number(info.rcCaret.right - info.rcCaret.left),
      height: Number(info.rcCaret.bottom - info.rcCaret.top),
    };
  } catch {
    return null;
  }
}

function guiThreadInfoSize() {
  try {
    const api = loadWin32();
    if (!api) return null;
    return api.koffi.sizeof(api.GUITHREADINFO);
  } catch {
    return null;
  }
}

function clampInt(value, min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (!(hi >= lo)) return lo;
  return Math.min(Math.max(Math.round(value), lo), hi);
}

/**
 * 给定锚点、浮窗尺寸和工作区，算出浮窗左上角，以及这次是贴在锚点上方还是下方。
 * anchor / size / workArea 都是 DIP。reserve 是预留的最大高度，用来判断下方还能不能长高。
 */
function computePopupPosition({ anchor, size, workArea, reserve }) {
  const reserveHeight = reserve == null ? DEFAULT_RESERVE : reserve;
  const width = size.width;
  const height = size.height;
  const anchorTop = anchor.y;
  const anchorBottom = anchor.y + (anchor.height || 0);
  const need = Math.max(height, reserveHeight);
  const areaBottom = workArea.y + workArea.height;
  const above = anchorBottom + POPUP_GAP + need > areaBottom;
  const rawY = above ? anchorTop - POPUP_GAP - height : anchorBottom + POPUP_GAP;
  return {
    x: clampInt(anchor.x - POPUP_ALIGN_OFFSET, workArea.x, workArea.x + workArea.width - width),
    y: clampInt(rawY, workArea.y, areaBottom - height),
    above,
  };
}

module.exports = {
  getCaretRect,
  guiThreadInfoSize,
  computePopupPosition,
  POPUP_ALIGN_OFFSET,
  POPUP_GAP,
  DEFAULT_RESERVE,
};
