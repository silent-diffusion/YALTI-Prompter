// YALTI Prompter — main process.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, screen, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { APP_ROOT, configurePortableMode, paths } from './paths.js';
import { APP_ORIGIN, handleProtocol, registerScheme } from './protocol.js';
import { SettingsStore, StateStore } from './store.js';
import { ScriptManager } from './scripts.js';
import { formatForPath, SCRIPT_EXTENSIONS } from './script-parser.js';
import { SpeechHost } from './speech-host.js';
import { PrompterWindow } from './prompter-window.js';
import { Panels } from './panels.js';
import { AppTray } from './tray.js';
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js';
import { Updater } from './updater.js';
import { FONTS, SHORTCUT_ACTIONS } from '../core/settings-schema.js';
import { releasesPage, repoFromUrl } from '../core/updates.js';

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
/** @type {Updater} */ let updater;
let shortcutStatus = {};
let quitting = false;
let sessionEnding = false;
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

const MAX_TEXT_CHARS = 25 * 1024 * 1024;

/**
 * Text dropped on a window: a highlighted selection (no name), or the contents
 * of a file that has no path on disk (e.g. dragged out of a browser), which
 * keeps its format from the file name.
 */
function openDroppedText(text, name) {
  // The prompter shows the error; other windows can show the returned message too.
  const fail = (message) => { notify(message, 'error'); return { ok: false, message, notified: true }; };
  if (typeof text !== 'string' || !text.trim()) return fail('There is no text to use as a script.');
  if (text.length > MAX_TEXT_CHARS) return fail('That text is too large for a script.');
  if (typeof name === 'string' && name) {
    if (!ScriptManager.isSupported(name)) return fail('That file type isn’t a supported script (.txt, .md, …).');
    scripts.openText(text, { title: basename(name).replace(/\.[^.]+$/, ''), format: formatForPath(name) });
  } else {
    scripts.openText(text, { title: 'Dropped text' });
  }
  showPrompter();
  return { ok: true };
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

/* ---------- Updates ---------- */

const AUTO_UPDATE_DELAY_MS = 15 * 1000;
const AUTO_UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
let autoNotified = '';

/** The GitHub repository releases come from (package.json "repository"). */
function appRepo() {
  try {
    return repoFromUrl(JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).repository?.url);
  } catch {
    return repoFromUrl('');
  }
}

/** How this copy was installed, which decides how it can update itself. */
function installKind() {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  return existsSync(join(dirname(process.execPath), 'Uninstall YALTI Prompter.exe')) ? 'installer' : 'zip';
}

function writable(dir) {
  try { accessSync(dir, constants.W_OK); return true; } catch { return false; }
}

/** Installers wait in the temp folder; a new portable copy goes next to this one; zips to Downloads. */
function updateDownloadDir(kind) {
  if (kind === 'installer') return join(app.getPath('temp'), 'YALTI Prompter update');
  const here = process.env.PORTABLE_EXECUTABLE_FILE ? dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null;
  if (kind === 'portable' && here && writable(here)) return here;
  return app.getPath('downloads');
}

/** Start a program on its own, resolving once it is running. */
function launchDetached(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createUpdater() {
  updater = new Updater({
    currentVersion: app.getVersion(),
    kind: installKind(),
    repo: appRepo(),
    fetch: (url, init) => net.fetch(url, init),
    downloadDir: updateDownloadDir,
    launch: launchDetached, // called while quitting, from will-quit
    quit: () => { quitting = true; app.quit(); },
    beforeRelaunch: () => app.releaseSingleInstanceLock(),
    reveal: (file) => shell.showItemInFolder(file),
  });
  let shownState = '';
  updater.on('status', (status) => {
    panels.broadcast('update:status', status);
    // Download progress arrives several times a second; the tray menu only shows the state.
    if (status.state !== shownState) {
      shownState = status.state;
      tray.refresh();
    }
  });
}

/** Automatic updates: check quietly, download installer updates in the background, install on quit. */
async function autoUpdate() {
  if (!settings.get().autoUpdate || smokeArg) return;
  const s = await updater.check();
  if (s.state !== 'available') return;
  const version = s.latest.version;
  if (s.kind === 'installer') {
    const d = await updater.download();
    if (d.state === 'downloaded' && autoNotified !== version) {
      autoNotified = version;
      notify(`YALTI ${version} is ready — it installs when you quit.`);
    }
  } else if (autoNotified !== version) {
    autoNotified = version;
    notify(`YALTI ${version} is available — see Settings → Updates.`);
  }
}

function checkForUpdates() {
  panels.open('settings', { section: 'updates' });
  updater.check();
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
    case 'checkUpdates': checkForUpdates(); return;
    case 'installUpdate': updater.install(); return;
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
    update: updater.status,
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
    update: updater.status,
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
  handle('script:open-text', (_e, { text, name } = {}) => openDroppedText(text, name));
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
    return scripts.openText(text, { keepPosition: true, title: scripts.current?.title, format: scripts.current?.format || 'markdown' });
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

  handle('update:status', () => updater.status);
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:cancel', () => { updater.cancel(); return true; });
  handle('update:install', () => updater.install());

  handle('speech:connect', (e) => speech.connect(e.sender));
  on('speech:release', () => speech.release());
  handle('speech:models', () => speech.models().map(({ id, name, language }) => ({ id, name, language })));

  handle('shell:open', (_e, what) => {
    const targets = {
      licenses: () => shell.openPath(paths.licenses()),
      data: () => shell.openPath(app.getPath('userData')),
      models: () => { mkdirSync(paths.userModels(), { recursive: true }); return shell.openPath(paths.userModels()); },
      'mic-privacy': () => shell.openExternal('ms-settings:privacy-microphone'),
      repo: () => shell.openExternal(`https://github.com/${appRepo()}`),
      release: () => shell.openExternal(updater.status.latest?.url || releasesPage(appRepo())),
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
  // The installer offers "Check for updates" when YALTI is already installed.
  if (argv.includes('--check-updates')) { checkForUpdates(); return; }
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
  // A requested restart into the new version, or a downloaded installer update,
  // starts now (never while Windows is shutting down).
  if (!sessionEnding) updater?.installOnQuit();
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
  createUpdater();

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
    if (has('autoUpdate') && s.autoUpdate) autoUpdate();
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
    sessionEnding = true;
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

  if (!smokeArg) {
    setTimeout(autoUpdate, AUTO_UPDATE_DELAY_MS);
    setInterval(autoUpdate, AUTO_UPDATE_EVERY_MS);
    if (process.argv.includes('--check-updates')) win.once('ready-to-show', () => checkForUpdates());
  }

  if (smokeArg) {
    const { runSmokeTest } = await import('./smoke.js');
    runSmokeTest({ outDir: smokeArg.slice('--smoke='.length), prompter, scripts, settings, speech, panels, command, shortcutStatus: () => shortcutStatus });
  }
});

