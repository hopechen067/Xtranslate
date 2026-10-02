'use strict';

let win32 = null;

function loadWin32() {
  if (win32) return win32;
  if (process.platform !== 'win32') return null;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: 'long',
    dy: 'long',
    mouseData: 'uint32_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
    uMsg: 'uint32_t',
    wParamL: 'uint16_t',
    wParamH: 'uint16_t',
  });
  const INPUT = koffi.struct('INPUT', {
    type: 'uint32_t',
    u: koffi.union({
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT,
    }),
  });

  // 64 位默认对齐：两个 DWORD 之后 HWND 从偏移 8 开始，末尾 RECT，共 72 字节。
  const RECT = koffi.struct('RECT', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  });
  const POINT = koffi.struct('POINT', {
    x: 'long',
    y: 'long',
  });
  const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
    cbSize: 'uint32_t',
    flags: 'uint32_t',
    hwndActive: 'void *',
    hwndFocus: 'void *',
    hwndCapture: 'void *',
    hwndMenuOwner: 'void *',
    hwndMoveSize: 'void *',
    hwndCaret: 'void *',
    rcCaret: RECT,
  });

  win32 = {
    koffi,
    INPUT,
    GUITHREADINFO,
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hWnd)'),
    AllowSetForegroundWindow: user32.func('bool __stdcall AllowSetForegroundWindow(uint32_t dwProcessId)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),
    AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, bool fAttach)'),
    GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
    SendInput: user32.func('unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)'),
    GetGUIThreadInfo: user32.func('bool __stdcall GetGUIThreadInfo(uint32_t idThread, _Inout_ GUITHREADINFO *pgui)'),
    ClientToScreen: user32.func('bool __stdcall ClientToScreen(void *hWnd, _Inout_ POINT *lpPoint)'),
  };
  return win32;
}

module.exports = { loadWin32 };
