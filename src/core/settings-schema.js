// Settings: defaults, allowed values and validation. Shared by the main
// process (persistence) and the Settings window (controls).

export const FONTS = [
  { id: 'inter', label: 'Inter', family: 'Inter Variable', pkg: 'inter', min: 100, max: 900, italic: true },
  { id: 'atkinson', label: 'Atkinson Hyperlegible Next', family: 'Atkinson Hyperlegible Next Variable', pkg: 'atkinson-hyperlegible-next', min: 200, max: 800, italic: true },
  { id: 'lexend', label: 'Lexend', family: 'Lexend Variable', pkg: 'lexend', min: 100, max: 900, italic: false },
  { id: 'figtree', label: 'Figtree', family: 'Figtree Variable', pkg: 'figtree', min: 300, max: 900, italic: true },
  { id: 'manrope', label: 'Manrope', family: 'Manrope Variable', pkg: 'manrope', min: 200, max: 800, italic: false },
  { id: 'nunito', label: 'Nunito', family: 'Nunito Variable', pkg: 'nunito', min: 200, max: 1000, italic: true },
  { id: 'literata', label: 'Literata', family: 'Literata Variable', pkg: 'literata', min: 200, max: 900, italic: true },
  { id: 'source-serif', label: 'Source Serif 4', family: 'Source Serif 4 Variable', pkg: 'source-serif-4', min: 200, max: 900, italic: true },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono Variable', pkg: 'jetbrains-mono', min: 100, max: 800, italic: true },
];

export const SHORTCUT_ACTIONS = [
  { id: 'toggleVisible', label: 'Show / hide prompter', default: 'Ctrl+Alt+Y' },
  { id: 'toggleExpanded', label: 'Expand / collapse', default: 'Ctrl+Alt+Enter' },
  { id: 'playPause', label: 'Start / pause', default: 'Ctrl+Alt+S' },
  { id: 'toggleVoice', label: 'Voice tracking on / off', default: 'Ctrl+Alt+M' },
  { id: 'lineBack', label: 'Scroll back a line', default: 'Ctrl+Alt+PageUp' },
  { id: 'lineForward', label: 'Scroll forward a line', default: 'Ctrl+Alt+PageDown' },
  { id: 'faster', label: 'Faster auto-scroll', default: 'Ctrl+Alt+=' },
  { id: 'slower', label: 'Slower auto-scroll', default: 'Ctrl+Alt+-' },
  { id: 'restart', label: 'Back to the start', default: 'Ctrl+Alt+Home' },
];

/**
 * Field definitions. `type` drives validation and the settings UI.
 * number: { min, max, step }, enum: { options }, bool, color, string.
 */
export const FIELDS = {
  // Typography
  fontId: { type: 'enum', options: FONTS.map((f) => f.id), default: 'inter' },
  fontSize: { type: 'number', min: 14, max: 120, step: 1, default: 34 },
  fontWeight: { type: 'number', min: 100, max: 1000, step: 10, default: 520 },
  lineHeight: { type: 'number', min: 1, max: 2.4, step: 0.05, default: 1.42 },
  letterSpacing: { type: 'number', min: -0.05, max: 0.2, step: 0.005, default: 0 },
  textAlign: { type: 'enum', options: ['left', 'center', 'right', 'justify'], default: 'left' },

  // Colors
  backgroundColor: { type: 'color', default: '#000000' },
  textColor: { type: 'color', default: '#ffffff' },
  highlightColor: { type: 'color', default: '#ffd166' },
  backgroundOpacity: { type: 'number', min: 0.35, max: 1, step: 0.01, default: 1 },
  readTextOpacity: { type: 'number', min: 0.1, max: 1, step: 0.01, default: 0.38 },

  // Display
  width: { type: 'number', min: 360, max: 2400, step: 10, default: 780 },
  height: { type: 'number', min: 120, max: 1400, step: 10, default: 250 },
  displayId: { type: 'string', default: '' },
  offsetX: { type: 'number', min: -4000, max: 4000, step: 1, default: 0 },
  anchor: { type: 'enum', options: ['screen', 'workarea'], default: 'screen' },
  alwaysOnTop: { type: 'bool', default: true },
  bezelStyle: { type: 'enum', options: ['liquid', 'flush', 'floating'], default: 'liquid' },
  bezelIntensity: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.7 },
  cornerRadius: { type: 'number', min: 8, max: 48, step: 1, default: 30 },
  shadow: { type: 'bool', default: true },
  mirror: { type: 'bool', default: false },
  showProgress: { type: 'bool', default: true },

  // Reading
  scrollMode: { type: 'enum', options: ['voice', 'auto'], default: 'voice' },
  autoScrollSpeed: { type: 'number', min: 5, max: 400, step: 1, default: 48 },
  wheelSpeed: { type: 'number', min: 0.25, max: 3, step: 0.05, default: 1 },
  readingLine: { type: 'number', min: 0.12, max: 0.6, step: 0.01, default: 0.3 },
  highlightSpoken: { type: 'bool', default: true },
  dimReadText: { type: 'bool', default: true },
  showReadingMarker: { type: 'bool', default: true },
  scrollSmoothness: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.55 },
  countdown: { type: 'number', min: 0, max: 10, step: 1, default: 0 },

  // Voice
  speechSensitivity: { type: 'enum', options: ['cautious', 'balanced', 'responsive'], default: 'balanced' },
  allowJumps: { type: 'bool', default: true },
  micDeviceId: { type: 'string', default: '' },
  modelId: { type: 'string', default: '' },
  speechThreads: { type: 'number', min: 1, max: 4, step: 1, default: 1 },

  // App
  launchAtLogin: { type: 'bool', default: false },
  startState: { type: 'enum', options: ['expanded', 'compact', 'hidden'], default: 'expanded' },
  globalShortcuts: { type: 'bool', default: true },
  reopenLastScript: { type: 'bool', default: true },
  watchScriptFile: { type: 'bool', default: true },
  shortcuts: { type: 'object', default: Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.default])) },
};

export const DEFAULTS = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.default)]));

const COLOR = /^#[0-9a-f]{6}$/i;

/** Validate one value; returns the cleaned value or undefined if invalid. */
export function cleanValue(key, value) {
  const f = FIELDS[key];
  if (!f) return undefined;
  switch (f.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(f.max, Math.max(f.min, n));
    }
    case 'enum': return f.options.includes(value) ? value : undefined;
    case 'bool': return typeof value === 'boolean' ? value : undefined;
    case 'color': return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : undefined;
    case 'string': return typeof value === 'string' ? value.slice(0, 512) : undefined;
    case 'object': {
      if (key !== 'shortcuts' || !value || typeof value !== 'object') return undefined;
      const out = {};
      for (const a of SHORTCUT_ACTIONS) {
        const v = value[a.id];
        out[a.id] = typeof v === 'string' ? v.slice(0, 64) : a.default;
      }
      return out;
    }
    default: return undefined;
  }
}

/** Merge a partial object onto settings, keeping only valid fields. */
export function applyPatch(settings, patch) {
  const next = { ...settings };
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const clean = cleanValue(k, v);
    if (clean === undefined) continue;
    if (JSON.stringify(next[k]) !== JSON.stringify(clean)) {
      next[k] = clean;
      changed.push(k);
    }
  }
  return { settings: next, changed };
}

/** Build complete, valid settings from whatever was stored on disk. */
export function sanitize(stored) {
  return applyPatch(structuredClone(DEFAULTS), stored || {}).settings;
}

export function fontById(id) {
  return FONTS.find((f) => f.id === id) || FONTS[0];
}
