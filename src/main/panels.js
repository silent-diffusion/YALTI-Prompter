// Secondary windows: Settings and the Script editor. Dark, quiet and native-
// feeling, with the standard Windows caption buttons.

import { BrowserWindow, dialog, nativeTheme, screen } from 'electron';
import { pageUrl } from './protocol.js';
import { paths } from './paths.js';

const PANELS = {
  settings: { width: 820, height: 640, minWidth: 640, minHeight: 480, title: 'YALTI Prompter — Settings' },
  editor: { width: 860, height: 660, minWidth: 520, minHeight: 360, title: 'YALTI Prompter — Script' },
};

export class Panels {
  constructor() {
    /** @type {Record<string, BrowserWindow>} */
    this.windows = {};
  }

  open(name, { section } = {}) {
    const spec = PANELS[name];
    if (!spec) return null;
    const existing = this.windows[name];
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      if (section) existing.webContents.send('panel:section', section);
      return existing;
    }
    nativeTheme.themeSource = 'dark';
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const win = new BrowserWindow({
      width: Math.min(spec.width, area.width - 40),
      height: Math.min(spec.height, area.height - 40),
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      x: Math.round(area.x + (area.width - Math.min(spec.width, area.width - 40)) / 2),
      y: Math.round(area.y + Math.max(40, (area.height - Math.min(spec.height, area.height - 40)) / 2)),
      show: false,
      title: spec.title,
      backgroundColor: '#0c0c0e',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0c0c0e', symbolColor: '#d7d7dc', height: 44 },
      icon: paths.icon('icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: paths.preload('panel.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: name === 'editor',
      },
    });
    win.setMenu(null);
    const url = new URL(pageUrl(name));
    if (section) url.hash = section;
    win.loadURL(url.toString());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { delete this.windows[name]; });
    // The editor asks before discarding unsaved edits.
    win.webContents.on('will-prevent-unload', (e) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Discard changes', 'Keep editing'],
        defaultId: 1,
        cancelId: 1,
        message: 'Your script has unsaved changes.',
        detail: 'The prompter already shows your edits, but the file on disk has not been updated.',
      });
      if (choice === 0) e.preventDefault();
    });
    this.windows[name] = win;
    return win;
  }

  get(name) {
    const w = this.windows[name];
    return w && !w.isDestroyed() ? w : null;
  }

  broadcast(channel, ...args) {
    for (const w of Object.values(this.windows)) {
      if (!w.isDestroyed()) w.webContents.send(channel, ...args);
    }
  }

  closeAll() {
    for (const w of Object.values(this.windows)) if (!w.isDestroyed()) w.close();
  }
}
