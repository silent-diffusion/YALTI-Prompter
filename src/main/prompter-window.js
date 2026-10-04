// The prompter window: a borderless, transparent surface fixed to the top edge
// of a display. The island shape is drawn inside it; transparent areas pass
// mouse clicks through to whatever is underneath.

import { BrowserWindow, screen } from 'electron';
import { pageUrl } from './protocol.js';
import { paths } from './paths.js';

// Room around the island for the liquid shoulders, soft shadow and motion.
export const SIDE_PAD = 64;
export const BOTTOM_PAD = 76;
export const FLOAT_GAP = 10;
const SNAP = 14;

export class PrompterWindow {
  /**
   * @param {import('./store.js').SettingsStore} store
   */
  constructor(store) {
    this.store = store;
    this.win = null;
    this.resizing = false;
    this.drag = null;
    this.visible = false;
  }

  display() {
    const id = this.store.get().displayId;
    const all = screen.getAllDisplays();
    return all.find((d) => String(d.id) === id) || screen.getPrimaryDisplay();
  }

  /** Island size clamped to the display, plus the window bounds around it. */
  geometry({ resizing = this.resizing } = {}) {
    const s = this.store.get();
    const d = this.display();
    const area = s.anchor === 'workarea' ? d.workArea : d.bounds;
    const floatGap = s.bezelStyle === 'floating' ? FLOAT_GAP : 0;
    const maxW = Math.max(360, area.width - SIDE_PAD * 2);
    const maxH = Math.max(120, Math.round(area.height * 0.85) - BOTTOM_PAD - floatGap);
    const islandWidth = Math.min(s.width, maxW);
    const islandHeight = Math.min(s.height, maxH);
    const boxW = resizing ? maxW : islandWidth;
    const boxH = resizing ? maxH : islandHeight;
    const width = boxW + SIDE_PAD * 2;
    const height = boxH + BOTTOM_PAD + floatGap;
    const slack = Math.max(0, (area.width - width) / 2);
    const offsetX = Math.max(-slack, Math.min(slack, resizing ? 0 : s.offsetX));
    const centerX = resizing && this.win ? this._currentCenter() : area.x + area.width / 2 + offsetX;
    const x = Math.round(centerX - width / 2);
    return {
      bounds: { x: Math.max(area.x, Math.min(area.x + area.width - width, x)), y: area.y, width, height },
      islandWidth, islandHeight, maxWidth: maxW, maxHeight: maxH, floatGap, resizing, offsetX,
    };
  }

  _currentCenter() {
    const b = this.win.getBounds();
    return b.x + b.width / 2;
  }

  create() {
    const g = this.geometry();
    const s = this.store.get();
    this.win = new BrowserWindow({
      ...g.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: s.alwaysOnTop,
      thickFrame: false,
      roundedCorners: false,
      title: 'YALTI Prompter',
      icon: paths.icon('icon.png'),
      webPreferences: {
        preload: paths.preload('prompter.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.applyAlwaysOnTop();
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadURL(pageUrl('prompter'));
    this.win.once('ready-to-show', () => { this.readyAt = Date.now(); });
    this.win.on('closed', () => { this.win = null; });
    // Keep the window on its display when monitors change.
    const relayout = () => this.layout();
    screen.on('display-metrics-changed', relayout);
    screen.on('display-added', relayout);
    screen.on('display-removed', relayout);
    return this.win;
  }

  applyAlwaysOnTop() {
    if (!this.win) return;
    if (this.store.get().alwaysOnTop) this.win.setAlwaysOnTop(true, 'screen-saver');
    else this.win.setAlwaysOnTop(false);
  }

  layout() {
    if (!this.win) return;
    const g = this.geometry();
    this.win.setBounds(g.bounds);
    this.win.webContents.send('window:geometry', g);
  }

  show() {
    if (!this.win) return;
    if (!this.win.isVisible()) this.win.showInactive();
    this.visible = true;
  }

  hide() {
    if (!this.win) return;
    this.win.hide();
    this.visible = false;
  }

  setIgnoreMouse(ignore) {
    if (!this.win) return;
    this.win.setIgnoreMouseEvents(!!ignore, { forward: true });
  }

  /** Slide the island along the top edge. */
  dragMove(phase, screenX) {
    if (!this.win) return;
    if (phase === 'start') {
      this.drag = { startX: screenX, startOffset: this.geometry().offsetX };
      return;
    }
    if (!this.drag) return;
    let offset = this.drag.startOffset + (screenX - this.drag.startX);
    if (Math.abs(offset) < SNAP) offset = 0;
    const s = this.store.get();
    const d = this.display();
    const area = s.anchor === 'workarea' ? d.workArea : d.bounds;
    const g = this.geometry();
    const slack = Math.max(0, (area.width - g.bounds.width) / 2);
    offset = Math.max(-slack, Math.min(slack, offset));
    const x = Math.round(area.x + area.width / 2 + offset - g.bounds.width / 2);
    this.win.setPosition(x, g.bounds.y);
    if (phase === 'end') {
      this.drag = null;
      this.store.update({ offsetX: Math.round(offset) });
    }
  }

  /** Live resizing: the window grows to the maximum while the user drags. */
  setResizing(on) {
    this.resizing = !!on;
    this.layout();
  }

  moveToDisplay(displayId) {
    this.store.update({ displayId: String(displayId), offsetX: 0 });
  }
}
