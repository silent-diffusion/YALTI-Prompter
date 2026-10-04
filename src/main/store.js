// Persistent JSON stores for settings (user preferences) and app state
// (recent scripts, reading positions). Writes are debounced and atomic.

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyPatch, DEFAULTS, sanitize } from '../core/settings-schema.js';

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // corrupt file: fall back to defaults
  }
}

function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

class JsonFile extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.timer = null;
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      writeJsonAtomic(this.file, this.serialize());
    } catch (err) {
      console.error('Could not save', this.file, err);
    }
  }
}

export class SettingsStore extends JsonFile {
  constructor(file) {
    super(file);
    const stored = readJson(file);
    this.firstRun = stored === null;
    this.settings = sanitize(stored);
  }

  serialize() { return this.settings; }

  get() { return this.settings; }

  update(patch) {
    const { settings, changed } = applyPatch(this.settings, patch);
    if (changed.length) {
      this.settings = settings;
      this.scheduleSave();
      this.emit('change', this.settings, changed);
    }
    return changed;
  }

  reset(keys) {
    const patch = {};
    for (const k of keys || Object.keys(DEFAULTS)) patch[k] = structuredClone(DEFAULTS[k]);
    return this.update(patch);
  }
}

const MAX_RECENT = 10;
const SCRATCH_FORMATS = ['markdown', 'text', 'subtitles'];
const MAX_POSITIONS = 60;

export class StateStore extends JsonFile {
  constructor(file) {
    super(file);
    const stored = readJson(file) || {};
    this.state = {
      recent: Array.isArray(stored.recent) ? stored.recent.filter((p) => typeof p === 'string').slice(0, MAX_RECENT) : [],
      lastScript: typeof stored.lastScript === 'string' ? stored.lastScript : null,
      positions: stored.positions && typeof stored.positions === 'object' ? stored.positions : {},
      // How the in-app (scratch) script is parsed when it is reopened.
      scratchFormat: SCRATCH_FORMATS.includes(stored.scratchFormat) ? stored.scratchFormat : 'markdown',
      // How long the speech recognizer last took to initialize, for the loading indicator.
      speechInitMs: Number.isFinite(stored.speechInitMs) ? stored.speechInitMs : null,
    };
  }

  serialize() { return this.state; }

  addRecent(path) {
    const r = this.state.recent.filter((p) => p.toLowerCase() !== path.toLowerCase());
    r.unshift(path);
    this.state.recent = r.slice(0, MAX_RECENT);
    this.scheduleSave();
  }

  removeRecent(path) {
    this.state.recent = this.state.recent.filter((p) => p !== path);
    this.scheduleSave();
  }

  clearRecent() {
    this.state.recent = [];
    this.scheduleSave();
  }

  setLastScript(path, scratchFormat) {
    this.state.lastScript = path;
    if (path === 'scratch' && SCRATCH_FORMATS.includes(scratchFormat)) this.state.scratchFormat = scratchFormat;
    this.scheduleSave();
  }

  setSpeechInitMs(ms) {
    this.state.speechInitMs = Math.round(Math.min(60000, Math.max(100, ms)));
    this.scheduleSave();
  }

  getPosition(key) {
    const p = this.state.positions[key];
    return p && typeof p.word === 'number' ? p.word : 0;
  }

  setPosition(key, word) {
    if (!key) return;
    this.state.positions[key] = { word: Math.max(0, Math.floor(word)), at: Date.now() };
    const keys = Object.keys(this.state.positions);
    if (keys.length > MAX_POSITIONS) {
      keys.sort((a, b) => this.state.positions[a].at - this.state.positions[b].at);
      for (const k of keys.slice(0, keys.length - MAX_POSITIONS)) delete this.state.positions[k];
    }
    this.scheduleSave();
  }
}
