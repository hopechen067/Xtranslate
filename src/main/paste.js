'use strict';

const { loadWin32 } = require('./win32');

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
const VK_V = 0x56;
const VK_F24 = 0x87; // 几乎没有软件响应，用来解前台锁而不触发菜单栏
const ASFW_ANY = 0xffffffff;

const PASTE_DELAY_MS = 60;
const RESTORE_DELAY_MS = 400;

function normalizeNewlines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

/** 只有剪贴板里仍是我们刚写进去的文本时才恢复，避免盖掉用户中途复制的内容。 */
function shouldRestoreClipboard(currentText, writtenText) {
  return normalizeNewlines(currentText) === normalizeNewlines(writtenText);
}

function snapshotClipboard(clipboard) {
  const image = typeof clipboard.readImage === 'function' ? clipboard.readImage() : null;
  return {
    text: clipboard.readText(),
    html: typeof clipboard.readHTML === 'function' ? clipboard.readHTML() : '',
    rtf: typeof clipboard.readRTF === 'function' ? clipboard.readRTF() : '',
    image: image && typeof image.isEmpty === 'function' && !image.isEmpty() ? image : null,
  };
}

function writeSnapshot(clipboard, snap) {
  const payload = {};
  if (snap.text) payload.text = snap.text;
  if (snap.html) payload.html = snap.html;
  if (snap.rtf) payload.rtf = snap.rtf;
  if (snap.image) payload.image = snap.image;
  if (Object.keys(payload).length === 0) {
    clipboard.clear();
    return;
  }
  clipboard.write(payload);
}

function captureForeground() {
  try {
    const api = loadWin32();
    if (!api) return null;
    return api.GetForegroundWindow();
  } catch (err) {
    console.warn('[xtranslate] 读取前台窗口失败', err && err.message);
    return null;
  }
}

function keyEvent(vk, down) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk,
        wScan: 0,
        dwFlags: down ? 0 : KEYEVENTF_KEYUP,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

function sendInputs(api, events) {
  return api.SendInput(events.length, events, api.koffi.sizeof(api.INPUT));
}

function sameWindow(api, a, b) {
  try {
    return !!a && !!b && api.koffi.address(a) === api.koffi.address(b);
  } catch {
    return false;
  }
}

function forceForeground(api, hwnd) {
  if (!hwnd) return false;
  // 浮窗隐藏后 Windows 通常已把焦点还给原窗口，这时什么都不做，
  // 避免任何模拟按键落进目标程序（单按 Alt 会激活记事本/Office 的菜单栏，吞掉 Ctrl+V）
  if (sameWindow(api, api.GetForegroundWindow(), hwnd)) return true;
  try {
    api.AllowSetForegroundWindow(ASFW_ANY);
  } catch {
    // 允许失败，后面还有 Alt 键技巧
  }

  let currentThread = 0;
  let targetThread = 0;
  let foregroundThread = 0;
  try {
    currentThread = api.GetCurrentThreadId();
    targetThread = api.GetWindowThreadProcessId(hwnd, [0]) || 0;
    const foreground = api.GetForegroundWindow();
    if (foreground) foregroundThread = api.GetWindowThreadProcessId(foreground, [0]) || 0;
  } catch {
    // 拿不到线程 id 时仍然尝试 SetForegroundWindow
  }

  const attached = [];
  const attach = (from, to) => {
    if (!from || !to || from === to) return;
    try {
      if (api.AttachThreadInput(from, to, true)) attached.push([from, to]);
    } catch {
      // 挂不上输入队列就继续走 Alt 键
    }
  };

  try {
    attach(foregroundThread, currentThread);
    attach(targetThread, currentThread);
    // 本进程刚产生过输入，Windows 才允许它切换前台；用 F24 而不是 Alt，免得激活菜单栏
    sendInputs(api, [keyEvent(VK_F24, true), keyEvent(VK_F24, false)]);
    return !!api.SetForegroundWindow(hwnd);
  } finally {
    for (const [from, to] of attached.reverse()) {
      try {
        api.AttachThreadInput(from, to, false);
      } catch {
        // 解开失败不影响粘贴
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 备份剪贴板 → 写入译文 → 隐藏浮窗 → 切回目标窗口 → Ctrl+V → 条件恢复。
 * 非 Windows 只写剪贴板并隐藏。
 */
async function commitPaste({ text, clipboard, hide, restore, hwnd, sleepImpl }) {
  const wait = sleepImpl || sleep;
  const written = String(text ?? '');
  const snap = snapshotClipboard(clipboard);
  clipboard.writeText(written);
  if (hide) await hide();

  if (process.platform !== 'win32') return;

  let api;
  try {
    api = loadWin32();
  } catch (err) {
    console.warn('[xtranslate] 无法加载 Win32 粘贴，已只写入剪贴板', err && err.message);
    return;
  }
  if (!api) return;

  try {
    forceForeground(api, hwnd);
  } catch (err) {
    console.warn('[xtranslate] 切回目标窗口失败', err && err.message);
  }

  await wait(PASTE_DELAY_MS);
  try {
    sendInputs(api, [
      keyEvent(VK_CONTROL, true),
      keyEvent(VK_V, true),
      keyEvent(VK_V, false),
      keyEvent(VK_CONTROL, false),
    ]);
  } catch (err) {
    console.warn('[xtranslate] 发送 Ctrl+V 失败', err && err.message);
  }

  if (!restore) return;
  await wait(RESTORE_DELAY_MS);
  try {
    if (shouldRestoreClipboard(clipboard.readText(), written)) writeSnapshot(clipboard, snap);
  } catch (err) {
    console.warn('[xtranslate] 恢复剪贴板失败', err && err.message);
  }
}

function inputStructSize() {
  const api = loadWin32();
  if (!api) return null;
  return api.koffi.sizeof(api.INPUT);
}

module.exports = {
  captureForeground,
  commitPaste,
  inputStructSize,
  shouldRestoreClipboard,
  snapshotClipboard,
  writeSnapshot,
  normalizeNewlines,
  PASTE_DELAY_MS,
  RESTORE_DELAY_MS,
};
