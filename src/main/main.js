// YALTI Prompter — main process.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { configurePortableMode, paths } from './paths.js';
import { APP_ORIGIN, handleProtocol, registerScheme } from './protocol.js';
import { SettingsStore, StateStore } from './store.js';
import { ScriptManager } from './scripts.js';
import { SCRIPT_EXTENSIONS } from './script-parser.js';
import { SpeechHost } from './speech-host.js';
import { PrompterWindow } from './prompter-window.js';
import { Panels } from './panels.js';
import { AppTray } from './tray.js';
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js';
import { FONTS, SHORTCUT_ACTIONS } from '../core/settings-schema.js';

const isDev = process.argv.includes('--dev');
const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
const portable = configurePortableMode();

if (smokeArg) {
  // Automated test runs use their own profile and never touch real settings.
  app.setPath('userData', smokeArg.slice('--smoke='.length) + '-profile');
  if (process.env.YALTI_FAKE_MIC) {
    // Feed a WAV file through Chromium's fake microphone (tests only).
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
    app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.YALTI_FAKE_MIC);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('app.yalti.prompter');
registerScheme();
Menu.setApplicationMenu(null);

/** @type {SettingsStore} */ let settings;
/** @type {StateStore} */ let stateStore;
/** @type {ScriptManager} */ let scripts;
/** @type {SpeechHost} */ let speech;
/** @type {PrompterWindow} */ let prompter;
/** @type {Panels} */ let panels;
/** @type {AppTray} */ let tray;
let shortcutStatus = {};
let quitting = false;
let ui = { visibility: 'expanded', playing: false, voiceState: 'off', listening: false };

const SCRIPT_FILTERS = [
  { name: 'Scripts', extensions: SCRIPT_EXTENSIONS },
  { name: 'All files', extensions: ['*'] },
];

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => !a.startsWith('-') && ScriptManager.isSupported(a) && existsSync(a)) || null;
}

function sendToPrompter(channel, ...args) {
  const w = prompter?.win;
  if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
}

function broadcast(channel, ...args) {
  sendToPrompter(channel, ...args);
  panels?.broadcast(channel, ...args);
}

function notify(message, kind = 'info') {
  sendToPrompter('toast', { message, kind });
}

function openScriptFile(file) {
  try {
    scripts.openFile(file);
    showPrompter();
  } catch (err) {
    notify(`Couldn’t open that script: ${err.message}`, 'error');
  }
}

async function openScriptDialog(parent) {
  const res = await dialog.showOpenDialog(parent && !parent.isDestroyed() ? parent : undefined, {
    title: 'Open a script',
    properties: ['openFile'],
    filters: SCRIPT_FILTERS,
  });
  if (!res.canceled && res.filePaths[0]) openScriptFile(res.filePaths[0]);
  return !res.canceled;
}

function pasteScript() {
  const text = clipboard.readText();
  if (!text || !text.trim()) {
    notify('The clipboard has no text to use as a script.', 'error');
    return false;
  }
  scripts.openText(text, { title: 'Pasted script' });
  showPrompter();
  return true;
}

function showPrompter() {
  prompter.show();
  sendToPrompter('command', 'show');
}

/** Commands from the tray, global shortcuts and windows. */
function command(name, arg) {
  switch (name) {
    case 'toggleVisible':
      if (prompter.visible && ui.visibility !== 'hidden') sendToPrompter('command', 'hide');
      else showPrompter();
      return;
    case 'openDialog': openScriptDialog(); return;
    case 'openRecent':
      if (existsSync(arg)) openScriptFile(arg);
      else { stateStore.removeRecent(arg); tray.refresh(); notify('That script no longer exists.', 'error'); }
      return;
    case 'clearRecent': stateStore.clearRecent(); tray.refresh(); return;
    case 'pasteScript': pasteScript(); return;
    case 'reloadScript': scripts.reload(); return;
    case 'openEditor': panels.open('editor'); return;
    case 'openSettings': panels.open('settings', { section: arg }); return;
    case 'toggleSetting': settings.update({ [arg]: !settings.get()[arg] }); return;
    case 'moveToDisplay': prompter.moveToDisplay(arg); return;
    case 'quit': quitting = true; app.quit(); return;
    default: {
      // Prompter actions (play, voice, scrolling…) are handled by the window.
      const hidden = !prompter.visible || ui.visibility === 'hidden';
      if (hidden && name === 'toggleExpanded') { showPrompter(); sendToPrompter('command', 'expand'); return; }
      if (hidden && ['playPause', 'toggleVoice'].includes(name)) showPrompter();
      sendToPrompter('command', name, arg);
    }
  }
}

function applyShortcuts() {
  shortcutStatus = registerShortcuts(settings.get(), (id) => command(id));
  broadcast('shortcuts:status', shortcutStatus);
}

function applyLoginItem() {
  if (!app.isPackaged || portable) return;
  app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin, args: ['--background'] });
}

function appState() {
  const s = settings.get();
  return {
    settings: s,
    ui,
    recent: stateStore.state.recent,
    scriptPath: scripts.current?.kind === 'file' ? scripts.current.path : null,
    displayId: String(prompter.display().id),
  };
}

function appInfo() {
  return {
    name: 'YALTI Prompter',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    portable,
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    platform: process.platform,
  };
}

/** Only our own pages may talk to the main process. */
function trusted(event) {
  const url = event.senderFrame?.url || '';
  return url.startsWith(APP_ORIGIN + '/');
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted sender');
    return fn(event, ...args);
  });
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!trusted(event)) return;
    fn(event, ...args);
  });
}

function registerIpc() {
  handle('app:initial', () => ({
    settings: settings.get(),
    script: scripts.current,
    fonts: FONTS,
    shortcuts: SHORTCUT_ACTIONS,
    shortcutStatus,
    info: appInfo(),
    firstRun: settings.firstRun,
    background: process.argv.includes('--background'),
    speech: speech.status,
    models: speech.models().map(({ id, name, language }) => ({ id, name, language })),
    recent: stateStore.state.recent,
  }));

  handle('settings:update', (_e, patch) => { settings.update(patch); return settings.get(); });
  handle('app:displays', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: `Display ${i + 1} — ${d.size.width}×${d.size.height}${d.id === primary ? ' (main)' : ''}`,
      primary: d.id === primary,
    }));
  });
  handle('app:recent', () => stateStore.state.recent);
  handle('script:open-recent', (_e, file) => {
    if (typeof file !== 'string' || !stateStore.state.recent.includes(file)) return false;
    command('openRecent', file);
    return true;
  });
  handle('settings:reset', (_e, keys) => { settings.reset(Array.isArray(keys) ? keys : undefined); return settings.get(); });

  handle('script:open-dialog', (e) => openScriptDialog(BrowserWindow.fromWebContents(e.sender)));
  handle('script:open-path', (_e, file) => {
    if (typeof file !== 'string' || !existsSync(file)) return false;
    if (!ScriptManager.isSupported(file)) { notify('That file type isn’t a supported script (.txt, .md, …).', 'error'); return false; }
    openScriptFile(file);
    return true;
  });
  handle('script:reload', () => !!scripts.reload());
  handle('script:paste', () => pasteScript());
  handle('script:sample', () => { scripts.openSample(); return true; });
  handle('script:current', () => scripts.current);
  handle('script:apply', (_e, text) => {
    if (typeof text !== 'string') return null;
    if (scripts.current?.kind === 'file') {
      // Live preview from the editor without saving the file yet.
      const cur = scripts.current;
      return scripts._setCurrent({ ...scripts._payload(text, { path: cur.path, format: cur.format, kind: 'file', keepPosition: true }), unsaved: true });
    }
    return scripts.openText(text, { keepPosition: true, title: scripts.current?.title });
  });
  handle('script:save', async (e, { text, saveAs } = {}) => {
    if (typeof text !== 'string') return null;
    let target = !saveAs && scripts.current?.kind === 'file' ? scripts.current.path : null;
    if (!target) {
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: 'Save script',
        defaultPath: scripts.current?.fileName || 'Script.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Plain text', extensions: ['txt'] }],
      });
      if (res.canceled || !res.filePath) return null;
      target = res.filePath;
    }
    return scripts.save(text, target);
  });
  on('script:position', (_e, { key, word } = {}) => {
    if (typeof key === 'string' && Number.isFinite(word)) scripts.rememberPosition(key, word);
  });

  on('window:ignore-mouse', (_e, ignore) => prompter.setIgnoreMouse(ignore));
  on('window:drag', (_e, { phase, screenX } = {}) => prompter.dragMove(phase, screenX));
  on('window:resizing', (_e, on) => prompter.setResizing(on));
  on('window:hide', () => prompter.hide());
  on('window:show', () => prompter.show());
  handle('window:geometry', () => prompter.geometry());

  on('ui:state', (_e, state) => {
    if (state && typeof state === 'object') {
      ui = { ...ui, ...state };
      tray.refresh();
    }
  });

  on('command', (_e, name, arg) => command(name, arg));
  handle('panel:open', (_e, name, section) => { panels.open(name, { section }); return true; });

  handle('speech:connect', (e) => speech.connect(e.sender));
  on('speech:release', () => speech.release());
  handle('speech:models', () => speech.models().map(({ id, name, language }) => ({ id, name, language })));

  handle('shell:open', (_e, what) => {
    const targets = {
      licenses: () => shell.openPath(paths.licenses()),
      data: () => shell.openPath(app.getPath('userData')),
      models: () => { mkdirSync(paths.userModels(), { recursive: true }); return shell.openPath(paths.userModels()); },
      'mic-privacy': () => shell.openExternal('ms-settings:privacy-microphone'),
      repo: () => shell.openExternal('https://github.com/silent-diffusion/YALTI-Prompter'),
      'script-folder': () => scripts.current?.kind === 'file' && shell.showItemInFolder(scripts.current.path),
      'script-external': () => scripts.current?.kind === 'file' && shell.openPath(scripts.current.path),
    };
    if (targets[what]) { targets[what](); return true; }
    return false;
  });
  handle('app:quit', () => { quitting = true; app.quit(); });
}

function secureContents(contents) {
  contents.on('will-navigate', (e, url) => { if (!url.startsWith(APP_ORIGIN)) e.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
}

function setupPermissions() {
  const ses = session.defaultSession;
  // The microphone is used only by our own prompter page, and only locally.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc.getURL();
    callback(origin.startsWith(APP_ORIGIN) && (permission === 'media' || permission === 'clipboard-sanitized-write'));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => origin.startsWith(APP_ORIGIN) && permission === 'media');
  ses.setDevicePermissionHandler(() => false);
}

app.on('web-contents-created', (_e, contents) => secureContents(contents));

app.on('second-instance', (_e, argv) => {
  if (!prompter?.win) return; // still starting up
  const file = fileFromArgs(argv);
  if (file) openScriptFile(file);
  else showPrompter();
});

app.on('before-quit', () => {
  quitting = true;
  settings?.saveNow();
  stateStore?.saveNow();
});

app.on('window-all-closed', () => {
  // The prompter lives in the tray; closing panels never quits.
  if (quitting) app.quit();
});

app.on('will-quit', () => {
  unregisterShortcuts();
  speech?.stop();
  scripts?.dispose();
  tray?.destroy();
});

app.whenReady().then(async () => {
  handleProtocol();
  setupPermissions();

  settings = new SettingsStore(paths.settingsFile());
  if (settings.firstRun) settings.saveNow(); // remember that the welcome has been shown
  stateStore = new StateStore(paths.stateFile());
  scripts = new ScriptManager(stateStore);
  scripts.setWatchEnabled(settings.get().watchScriptFile);
  speech = new SpeechHost(() => settings.get());
  prompter = new PrompterWindow(settings);
  panels = new Panels();
  tray = new AppTray({ getState: appState, command });

  registerIpc();

  settings.on('change', (s, changed) => {
    broadcast('settings:changed', s, changed);
    const has = (...keys) => keys.some((k) => changed.includes(k));
    if (has('width', 'height', 'displayId', 'offsetX', 'anchor', 'bezelStyle')) prompter.layout();
    if (has('alwaysOnTop')) prompter.applyAlwaysOnTop();
    if (has('globalShortcuts', 'shortcuts')) applyShortcuts();
    if (has('launchAtLogin')) applyLoginItem();
    if (has('watchScriptFile')) scripts.setWatchEnabled(s.watchScriptFile);
    if (has('modelId', 'speechThreads') && speech.child) speech.stop();
    tray.refresh();
  });
  scripts.on('loaded', (script) => {
    broadcast('script:loaded', script);
    tray.refresh();
  });
  speech.on('status', (status) => broadcast('speech:status', status));
  speech.on('crashed', () => sendToPrompter('speech:crashed'));

  // Open a file passed on the command line, else the last script, else the welcome script.
  const argFile = fileFromArgs(process.argv);
  if (argFile) {
    try { scripts.openFile(argFile); } catch { /* fall through */ }
  }
  if (!scripts.current && settings.get().reopenLastScript && !settings.firstRun) scripts.restoreLast();
  if (!scripts.current) scripts.openSample();

  const win = prompter.create();
  tray.create();
  applyShortcuts();
  applyLoginItem();

  const startHidden = process.argv.includes('--background') && settings.get().startState === 'hidden';
  win.once('ready-to-show', () => {
    if (!startHidden) prompter.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });
  // Windows is signing out or shutting down: never hold it up.
  win.on('session-end', () => {
    quitting = true;
    settings.saveNow();
    stateStore.saveNow();
  });
  // Alt+F4 on the prompter hides it into the edge; the app keeps running in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      sendToPrompter('command', 'hide');
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Prompter renderer gone:', details.reason);
    if (!quitting) setTimeout(() => { if (prompter.win && !prompter.win.isDestroyed()) prompter.win.reload(); }, 500);
  });

  if (smokeArg) {
    const { runSmokeTest } = await import('./smoke.js');
    runSmokeTest({ outDir: smokeArg.slice('--smoke='.length), prompter, scripts, settings, speech, panels, command, shortcutStatus: () => shortcutStatus });
  }
});

