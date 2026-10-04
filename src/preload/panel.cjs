// Bridge for the Settings and Script editor windows.

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['settings:changed', 'script:loaded', 'shortcuts:status', 'speech:status', 'panel:section', 'update:status']);

contextBridge.exposeInMainWorld('yalti', {
  initial: () => ipcRenderer.invoke('app:initial'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: (keys) => ipcRenderer.invoke('settings:reset', keys),
  models: () => ipcRenderer.invoke('speech:models'),
  displays: () => ipcRenderer.invoke('app:displays'),
  recent: () => ipcRenderer.invoke('app:recent'),
  openRecent: (path) => ipcRenderer.invoke('script:open-recent', path),

  currentScript: () => ipcRenderer.invoke('script:current'),
  openScriptDialog: () => ipcRenderer.invoke('script:open-dialog'),
  openScriptPath: (path) => ipcRenderer.invoke('script:open-path', path),
  openScriptText: (text, name) => ipcRenderer.invoke('script:open-text', { text, name }),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  applyScript: (text) => ipcRenderer.invoke('script:apply', text),
  saveScript: (text, saveAs) => ipcRenderer.invoke('script:save', { text, saveAs }),
  reloadScript: () => ipcRenderer.invoke('script:reload'),
  pasteScript: () => ipcRenderer.invoke('script:paste'),
  openSample: () => ipcRenderer.invoke('script:sample'),

  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdate: () => ipcRenderer.invoke('update:cancel'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  command: (name, arg) => ipcRenderer.send('command', name, arg),
  openPanel: (name, section) => ipcRenderer.invoke('panel:open', name, section),
  openShell: (what) => ipcRenderer.invoke('shell:open', what),
  quit: () => ipcRenderer.invoke('app:quit'),

  on: (channel, callback) => {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
