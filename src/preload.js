'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('xt', {
  translate: (req) => ipcRenderer.invoke('xt:translate', req),
  onPartial: (cb) => listen('xt:partial', cb),
  cancel: (id) => ipcRenderer.invoke('xt:cancel', id),
  commit: (text) => ipcRenderer.invoke('xt:commit', text),
  hide: () => ipcRenderer.invoke('xt:hide'),
  resize: (height) => ipcRenderer.invoke('xt:resize', height),
  onShow: (cb) => listen('xt:show', cb),
  getConfig: () => ipcRenderer.invoke('xt:getConfig'),
  setConfig: (partial) => ipcRenderer.invoke('xt:setConfig', partial),
  getProviders: () => ipcRenderer.invoke('xt:getProviders'),
  testEngine: (partial) => ipcRenderer.invoke('xt:testEngine', partial),
  openSettings: () => ipcRenderer.invoke('xt:openSettings'),
  onConfigChanged: (cb) => listen('xt:config', cb),
});
