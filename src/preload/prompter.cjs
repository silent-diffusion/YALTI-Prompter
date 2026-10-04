// Bridge between the prompter page and the main process. Exposes a small,
// fixed API; the page itself has no Node.js access.

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'settings:changed', 'script:loaded', 'command', 'toast', 'speech:status',
  'speech:crashed', 'shortcuts:status', 'window:geometry',
]);

// The speech engine's MessagePort cannot cross the context bridge directly,
// so it is handed to the page with window.postMessage.
ipcRenderer.on('speech:port', (event) => {
  window.postMessage({ yalti: 'speech-port' }, window.location.origin, event.ports);
});

contextBridge.exposeInMainWorld('yalti', {
  initial: () => ipcRenderer.invoke('app:initial'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  openScriptDialog: () => ipcRenderer.invoke('script:open-dialog'),
  openScriptPath: (path) => ipcRenderer.invoke('script:open-path', path),
  openScriptText: (text, name) => ipcRenderer.invoke('script:open-text', { text, name }),
  reloadScript: () => ipcRenderer.invoke('script:reload'),
  pasteScript: () => ipcRenderer.invoke('script:paste'),
  openSample: () => ipcRenderer.invoke('script:sample'),
  rememberPosition: (key, word) => ipcRenderer.send('script:position', { key, word }),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },

  setIgnoreMouse: (ignore) => ipcRenderer.send('window:ignore-mouse', !!ignore),
  drag: (phase, screenX) => ipcRenderer.send('window:drag', { phase, screenX }),
  setResizing: (on) => ipcRenderer.send('window:resizing', !!on),
  hideWindow: () => ipcRenderer.send('window:hide'),
  showWindow: () => ipcRenderer.send('window:show'),
  geometry: () => ipcRenderer.invoke('window:geometry'),

  reportState: (state) => ipcRenderer.send('ui:state', state),
  command: (name, arg) => ipcRenderer.send('command', name, arg),
  openPanel: (name, section) => ipcRenderer.invoke('panel:open', name, section),
  openShell: (what) => ipcRenderer.invoke('shell:open', what),

  speechConnect: () => ipcRenderer.invoke('speech:connect'),
  speechRelease: () => ipcRenderer.send('speech:release'),

  on: (channel, callback) => {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
