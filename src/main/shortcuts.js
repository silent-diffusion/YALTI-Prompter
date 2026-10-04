// System-wide keyboard shortcuts, so the prompter can be driven while another
// app (slides, video call) has focus.

import { globalShortcut } from 'electron';
import { SHORTCUT_ACTIONS } from '../core/settings-schema.js';

/**
 * Register shortcuts from settings. Returns a status per action:
 * 'ok', 'off', 'invalid' or 'taken' (another app already uses it).
 */
export function registerShortcuts(settings, onAction) {
  globalShortcut.unregisterAll();
  const status = {};
  for (const action of SHORTCUT_ACTIONS) {
    const accel = (settings.shortcuts?.[action.id] || '').trim();
    if (!settings.globalShortcuts || !accel) { status[action.id] = 'off'; continue; }
    try {
      const ok = globalShortcut.register(accel, () => onAction(action.id));
      status[action.id] = ok ? 'ok' : 'taken';
    } catch {
      status[action.id] = 'invalid';
    }
  }
  return status;
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}
