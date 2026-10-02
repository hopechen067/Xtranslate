'use strict';

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  clipboard,
  safeStorage,
  shell,
} = require('electron');

const { PROVIDERS } = require('./providers');
const { createConfigStore, mergeConfig } = require('./config');
const { translate, warmup } = require('./engines');
const { captureForeground, commitPaste } = require('./paste');
const { getCaretRect, computePopupPosition, DEFAULT_RESERVE } = require('./caret');

const POPUP_WIDTH = 560;
const POPUP_HEIGHT = 140;

let store = null;
let tray = null;
let popup = null;
let settingsWin = null;
let quitting = false;
let activeHotkey = null;
let targetHwnd = null;
let suppressBlurUntil = 0;
let popupAbove = false;
const inflight = new Map();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPopup();
  });
  app.whenReady().then(start).catch((err) => {
    console.error('[xtranslate] 启动失败', err && err.message ? err.message : err);
    app.quit();
  });
}

function warn(message) {
  console.warn('[xtranslate]', message);
}

// 页面里的外链（如"申请 Key"）一律交给系统浏览器，不在应用内开窗口
function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function webPrefs() {
  return {
    preload: path.join(__dirname, '..', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function pagePath(name) {
  const renderer = path.join(__dirname, '..', 'renderer', name);
  if (fs.existsSync(renderer)) return renderer;
  const fixture = path.join(__dirname, '..', '..', 'test', 'fixtures', name);
  if (fs.existsSync(fixture)) return fixture;
  return null;
}

function missingHtml(name) {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#1c1c1c;color:#f3f3f3;font:14px/1.5 sans-serif;padding:16px">
  <div>找不到页面 src/renderer/${name}</div>
  <div>后端已经启动。前端文件还没放进来，所以先显示这张说明。</div>
</body></html>`;
}

async function loadPage(win, name) {
  const file = pagePath(name);
  if (!file) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(missingHtml(name))}`);
    return;
  }
  try {
    await win.loadFile(file);
  } catch (err) {
    warn(`加载 ${name} 失败：${err && err.message}`);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(missingHtml(name))}`);
  }
}

function trayImage() {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'tray.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  }
  return nativeImage.createFromBuffer(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'GklEQVQ4T2NkoBAwUqifgYoBAwMDw3+G/wwMDAwA' +
    'BhgBAe0l3n0AAAAASUVORK5CYII=',
    'base64',
  ));
}

function popupAnchor() {
  const caret = getCaretRect(targetHwnd);
  if (caret && process.platform === 'win32' && typeof screen.screenToDipRect === 'function') {
    try {
      const dip = screen.screenToDipRect(null, caret);
      if (dip && Number.isFinite(dip.x) && Number.isFinite(dip.y)) {
        return {
          x: dip.x,
          y: dip.y,
          width: dip.width || 0,
          height: dip.height || 0,
        };
      }
    } catch (err) {
      warn(`光标坐标换算失败：${err && err.message}`);
    }
  }
  const cursor = screen.getCursorScreenPoint();
  return { x: cursor.x, y: cursor.y, width: 0, height: 0 };
}

function placePopup() {
  const anchor = popupAnchor();
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const [width, height] = popup.getSize();
  const pos = computePopupPosition({
    anchor,
    size: { width, height },
    workArea: display.workArea,
    reserve: DEFAULT_RESERVE,
  });
  popupAbove = pos.above;
  popup.setPosition(pos.x, pos.y);
}

function emitShow() {
  if (!popup || popup.isDestroyed()) return;
  const payload = { engine: store.get().engine, direction: 'auto' };
  const send = () => {
    if (popup && !popup.isDestroyed()) popup.webContents.send('xt:show', payload);
  };
  if (popup.webContents.isLoading()) popup.webContents.once('did-finish-load', send);
  else send();
}

function showPopup() {
  if (!popup || popup.isDestroyed()) return;
  if (popup.isVisible()) {
    popup.hide();
    return;
  }
  targetHwnd = captureForeground();
  placePopup();
  suppressBlurUntil = Date.now() + 300;
  popup.show();
  popup.focus();
  emitShow();
  warmup(store.get()); // token 有缓存时是空操作；过期了就趁用户打字时重新拿
}

function hidePopup() {
  if (popup && !popup.isDestroyed() && popup.isVisible()) popup.hide();
}

function applyHotkey(next) {
  if (!next || typeof next !== 'string' || !next.trim()) {
    return { ok: false, message: '热键不能为空' };
  }
  if (next === activeHotkey && globalShortcut.isRegistered(next)) return { ok: true };
  const previous = activeHotkey;
  if (previous && previous !== next) globalShortcut.unregister(previous);
  if (globalShortcut.isRegistered(next)) globalShortcut.unregister(next);
  const ok = globalShortcut.register(next, showPopup);
  if (!ok) {
    if (previous && previous !== next) {
      const back = globalShortcut.register(previous, showPopup);
      if (!back) warn(`原来的热键「${previous}」也没能重新注册`);
    }
    return { ok: false, message: `热键「${next}」注册失败，可能被其他程序占用` };
  }
  activeHotkey = next;
  return { ok: true };
}

function applyLogin(openAtLogin) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!openAtLogin });
  } catch (err) {
    warn(`设置开机启动失败：${err && err.message}`);
  }
}

function broadcast(pub) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('xt:config', pub);
  }
}

function refreshTray() {
  if (!tray) return;
  const cfg = store.get();
  const menu = Menu.buildFromTemplate([
    { label: '设置', click: () => openSettings() },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: !!cfg.launchAtLogin,
      click: (item) => {
        try {
          setConfig({ launchAtLogin: item.checked });
        } catch (err) {
          warn(err.message);
          refreshTray();
        }
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function setConfig(partial) {
  const prev = store.get();
  const merged = mergeConfig(prev, partial || {});
  const hotkeyChanged = merged.hotkey !== prev.hotkey;
  if (hotkeyChanged) {
    const registered = applyHotkey(merged.hotkey);
    if (!registered.ok) throw new Error(registered.message);
  }
  let pub;
  try {
    pub = store.set(partial || {});
  } catch (err) {
    if (hotkeyChanged) applyHotkey(prev.hotkey);
    throw err;
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'launchAtLogin')) {
    applyLogin(!!store.get().launchAtLogin);
  warmup(store.get());
  }
  broadcast(pub);
  refreshTray();
  return pub;
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 640,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    title: 'Xtranslate 设置',
    webPreferences: webPrefs(),
  });
  guardNavigation(settingsWin);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  loadPage(settingsWin, 'settings.html')
    .then(() => {
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.show();
    })
    .catch((err) => warn(err && err.message));
}

function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: webPrefs(),
  });
  guardNavigation(popup);
  popup.setAlwaysOnTop(true, 'floating');
  popup.on('blur', () => {
    if (Date.now() < suppressBlurUntil) return;
    hidePopup();
  });
  popup.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      hidePopup();
    }
  });
  loadPage(popup, 'popup.html').catch((err) => warn(err && err.message));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip(`Xtranslate · ${store.get().hotkey} 呼出`);
  tray.on('click', () => openSettings());
  refreshTray();
}

function registerIpc() {
  ipcMain.handle('xt:translate', async (event, req) => {
    const body = req || {};
    const id = body.id != null ? String(body.id) : `${Date.now()}`;
    const cfg = store.get();
    const engine = body.engine || cfg.engine;
    const ac = new AbortController();
    inflight.set(id, ac);
    const started = Date.now();
    try {
      const result = await translate({
        text: body.text,
        direction: body.direction,
        engine,
        signal: ac.signal,
        config: cfg,
        onPartial: (text) => {
          if (!event.sender.isDestroyed()) event.sender.send('xt:partial', { id, text });
        },
      });
      return {
        id,
        text: result.text,
        engine,
        direction: result.direction,
        ms: Date.now() - started,
      };
    } catch (err) {
      throw new Error((err && err.message) || '翻译失败');
    } finally {
      inflight.delete(id);
    }
  });

  ipcMain.handle('xt:cancel', (_event, id) => {
    const ac = inflight.get(String(id));
    if (ac) ac.abort();
  });

  ipcMain.handle('xt:commit', async (_event, text) => {
    const cfg = store.get();
    await commitPaste({
      text: String(text ?? ''),
      clipboard,
      hwnd: targetHwnd,
      restore: cfg.restoreClipboard !== false,
      hide: async () => hidePopup(),
    });
  });

  ipcMain.handle('xt:hide', () => {
    hidePopup();
  });

  ipcMain.handle('xt:resize', (_event, height) => {
    if (!popup || popup.isDestroyed()) return;
    const next = Math.max(80, Math.min(800, Math.round(Number(height) || POPUP_HEIGHT)));
    if (popupAbove) {
      const [, current] = popup.getSize();
      const [x, y] = popup.getPosition();
      popup.setBounds({ x, y: y + current - next, width: POPUP_WIDTH, height: next });
      return;
    }
    popup.setSize(POPUP_WIDTH, next);
  });

  ipcMain.handle('xt:getConfig', () => store.getPublic());

  ipcMain.handle('xt:setConfig', (_event, partial) => setConfig(partial || {}));

  ipcMain.handle('xt:getProviders', () => PROVIDERS);

  ipcMain.handle('xt:testEngine', async (_event, partial) => {
    const cfg = mergeConfig(store.get(), partial || {});
    const started = Date.now();
    try {
      const result = await translate({
        text: '你好',
        direction: 'zh2en',
        engine: cfg.engine,
        config: cfg,
      });
      return { ok: true, sample: result.text, ms: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        sample: '',
        ms: Date.now() - started,
        error: (err && err.message) || '翻译失败',
      };
    }
  });

  ipcMain.handle('xt:openSettings', () => {
    openSettings();
  });
}

async function start() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  app.setAppUserModelId('com.xtranslate.app');

  store = createConfigStore({
    filePath: path.join(app.getPath('userData'), 'config.json'),
    safeStorage,
    warn,
  });

  registerIpc();
  createTray();
  createPopup();

  const initial = applyHotkey(store.get().hotkey);
  if (!initial.ok) warn(initial.message);
  applyLogin(!!store.get().launchAtLogin);
  warmup(store.get());

  console.log('[xtranslate] ready', JSON.stringify({
    hotkey: store.get().hotkey,
    registered: !!(activeHotkey && globalShortcut.isRegistered(activeHotkey)),
  }));
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  // 托盘常驻，关窗口不退出。
});
