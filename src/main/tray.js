// System tray icon: the always-available way back to the prompter.

import { Menu, Tray, nativeImage, screen } from 'electron';
import { basename } from 'node:path';
import { paths } from './paths.js';

export class AppTray {
  /**
   * @param {{ getState: () => any, command: (name: string, arg?: any) => void }} app
   */
  constructor(app) {
    this.app = app;
    this.tray = null;
    this.timer = null;
  }

  create() {
    const image = nativeImage.createFromPath(paths.icon('tray.ico'));
    this.tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(paths.icon('icon.png')).resize({ width: 16, height: 16 }) : image);
    this.tray.setToolTip('YALTI Prompter');
    this.tray.on('click', () => this.app.command('toggleVisible'));
    this.refresh();
  }

  /** Rebuild the menu soon (state changes can come in bursts). */
  refresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._build(), 60);
  }

  _build() {
    if (!this.tray) return;
    const s = this.app.getState();
    const c = (name, arg) => () => this.app.command(name, arg);
    const accel = (id) => (s.settings.globalShortcuts ? s.settings.shortcuts[id] : undefined);
    const recent = s.recent.length
      ? s.recent.map((p) => ({ label: basename(p).replace(/&/g, '&&'), click: c('openRecent', p) })).concat([{ type: 'separator' }, { label: 'Clear recent', click: c('clearRecent') }])
      : [{ label: 'No recent scripts', enabled: false }];
    const displays = screen.getAllDisplays();
    const menu = Menu.buildFromTemplate([
      { label: s.ui.visibility === 'hidden' ? 'Show prompter' : 'Hide prompter', accelerator: accel('toggleVisible'), click: c('toggleVisible') },
      { label: s.ui.visibility === 'expanded' ? 'Collapse' : 'Expand', accelerator: accel('toggleExpanded'), click: c('toggleExpanded') },
      { type: 'separator' },
      { label: 'Open script…', click: c('openDialog') },
      { label: 'Recent scripts', submenu: recent },
      { label: 'New script from clipboard', click: c('pasteScript') },
      { label: 'Edit script…', click: c('openEditor') },
      { label: 'Reload script', enabled: !!s.scriptPath, click: c('reloadScript') },
      { type: 'separator' },
      { label: s.ui.playing ? 'Pause' : 'Start', accelerator: accel('playPause'), click: c('playPause') },
      { label: 'Voice tracking', type: 'checkbox', checked: !!s.ui.listening, accelerator: accel('toggleVoice'), click: c('toggleVoice') },
      { label: 'Auto-scroll', type: 'checkbox', checked: s.settings.scrollMode === 'auto', click: c('setMode', s.settings.scrollMode === 'auto' ? 'voice' : 'auto') },
      { label: 'Back to the start', accelerator: accel('restart'), click: c('restart') },
      { type: 'separator' },
      { label: 'Always on top', type: 'checkbox', checked: s.settings.alwaysOnTop, click: c('toggleSetting', 'alwaysOnTop') },
      ...(displays.length > 1 ? [{
        label: 'Show on display',
        submenu: displays.map((d, i) => ({
          label: `Display ${i + 1} — ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' (main)' : ''}`,
          type: 'radio',
          checked: String(d.id) === s.displayId,
          click: c('moveToDisplay', d.id),
        })),
      }] : []),
      { label: 'Settings…', click: c('openSettings') },
      { type: 'separator' },
      { label: 'Quit YALTI Prompter', click: c('quit') },
    ]);
    this.tray.setContextMenu(menu);
  }

  destroy() {
    clearTimeout(this.timer);
    if (this.tray) this.tray.destroy();
    this.tray = null;
  }
}
