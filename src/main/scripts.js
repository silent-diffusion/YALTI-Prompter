// Loads, watches, edits and remembers scripts.

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { decodeBuffer, formatForPath, parseScript, scriptTitle, SCRIPT_EXTENSIONS } from './script-parser.js';
import { countWords } from '../core/text.js';
import { paths } from './paths.js';

const MAX_BYTES = 25 * 1024 * 1024;
let nextId = 1;

export class ScriptManager extends EventEmitter {
  /** @param {import('./store.js').StateStore} state */
  constructor(state) {
    super();
    this.state = state;
    this.current = null;
    this.watcher = null;
    this.watchEnabled = true;
    this.reloadTimer = null;
  }

  static isSupported(file) {
    return SCRIPT_EXTENSIONS.includes(extname(file).slice(1).toLowerCase());
  }

  /** Build the payload sent to windows. */
  _payload(text, { path = null, format, title, kind, keepPosition = false }) {
    const blocks = parseScript(text, format);
    const key = path || kind;
    return {
      id: nextId++,
      path,
      kind, // 'file' | 'sample' | 'scratch'
      key,
      format,
      title: title || scriptTitle(blocks, path),
      fileName: path ? basename(path) : null,
      text,
      blocks,
      wordCount: countWords(text),
      restoreWord: keepPosition ? null : this.state.getPosition(key),
      keepPosition,
    };
  }

  _setCurrent(script) {
    this.current = script;
    this._watch();
    this.emit('loaded', script);
    return script;
  }

  openFile(file, { keepPosition = false } = {}) {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('That is not a file.');
    if (st.size > MAX_BYTES) throw new Error('That file is too large for a script (over 25 MB).');
    const text = decodeBuffer(readFileSync(file));
    const script = this._payload(text, { path: file, format: formatForPath(file), kind: 'file', keepPosition });
    this.state.addRecent(file);
    this.state.setLastScript(file);
    return this._setCurrent(script);
  }

  openSample(name = 'welcome.md') {
    const file = join(paths.samples(), name);
    const text = readFileSync(file, 'utf8');
    this.state.setLastScript(`sample:${name}`);
    return this._setCurrent(this._payload(text, { format: 'markdown', kind: 'sample' }));
  }

  /** A script that lives only inside the app (pasted, dropped or written in the editor). */
  openText(text, { title = null, format = 'markdown', keepPosition = false } = {}) {
    try { writeFileSync(paths.scratchFile(), text, 'utf8'); } catch { /* not fatal */ }
    this.state.setLastScript('scratch', format);
    return this._setCurrent(this._payload(text, { format, kind: 'scratch', title, keepPosition }));
  }

  /** Re-open whatever was open last time. Returns null if nothing usable. */
  restoreLast() {
    const last = this.state.state.lastScript;
    try {
      if (last === 'scratch' && existsSync(paths.scratchFile())) {
        return this.openText(readFileSync(paths.scratchFile(), 'utf8'), { format: this.state.state.scratchFormat });
      }
      if (last && last.startsWith('sample:')) return this.openSample(last.slice(7));
      if (last && existsSync(last)) return this.openFile(last);
    } catch (err) {
      console.warn('Could not restore last script:', err.message);
    }
    return null;
  }

  reload() {
    const cur = this.current;
    if (!cur) return null;
    if (cur.kind === 'file') return this.openFile(cur.path, { keepPosition: true });
    if (cur.kind === 'sample') return this.current;
    return this.current;
  }

  /** Save editor text. Returns the new current script. */
  save(text, file) {
    const target = file || (this.current && this.current.kind === 'file' ? this.current.path : null);
    if (!target) throw new Error('No file to save to.');
    this._unwatch();
    writeFileSync(target, text, 'utf8');
    return this.openFile(target, { keepPosition: true });
  }

  setWatchEnabled(on) {
    this.watchEnabled = on;
    this._watch();
  }

  _unwatch() {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* ignore */ }
      this.watcher = null;
    }
  }

  _watch() {
    this._unwatch();
    const cur = this.current;
    if (!this.watchEnabled || !cur || cur.kind !== 'file') return;
    try {
      this.watcher = watch(cur.path, { persistent: false }, () => {
        clearTimeout(this.reloadTimer);
        // Editors often write in several steps; wait for the file to settle.
        this.reloadTimer = setTimeout(() => {
          if (!this.current || this.current.path !== cur.path || !existsSync(cur.path)) return;
          try {
            const text = decodeBuffer(readFileSync(cur.path));
            if (text === this.current.text) return;
            const script = this._payload(text, { path: cur.path, format: cur.format, kind: 'file', keepPosition: true });
            script.reloaded = true;
            this._setCurrent(script);
          } catch (err) {
            console.warn('Reload failed:', err.message);
          }
        }, 300);
      });
    } catch (err) {
      console.warn('Cannot watch script:', err.message);
    }
  }

  rememberPosition(key, word) {
    this.state.setPosition(key, word);
  }

  dispose() {
    this._unwatch();
    clearTimeout(this.reloadTimer);
  }
}
