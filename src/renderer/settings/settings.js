// Settings window. Every control writes straight to the shared settings, so
// the prompter updates live while you adjust it.

import { FIELDS, FONTS, fontById } from '../../core/settings-schema.js';
import { describeDuration, SPEAKING_WPM } from '../../core/text.js';
import { icon } from '../shared/icons.js';
import { dropKind, openDropped } from '../shared/drop.js';

const api = window.yalti;
let S = null; // current settings
let initial = null;
let updaters = [];
let current = 'text';
let micTest = null;

/* ---------- tiny DOM helper ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only used with our own icon markup
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const set = (patch) => api.updateSettings(patch);
const onRefresh = (fn) => { updaters.push(fn); fn(S); };

function card(title, ...rows) {
  return h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...rows);
}

function row(label, desc, control, opts = {}) {
  return h('div', { class: `row${opts.stack ? ' stack' : ''}` },
    h('div', { class: 'label' }, h('strong', {}, label), desc ? h('span', {}, desc) : null),
    h('div', { class: 'control' }, control));
}

function slider(key, { format = (v) => v, min, max, step } = {}) {
  const f = FIELDS[key];
  const input = h('input', { type: 'range', min: min ?? f.min, max: max ?? f.max, step: step ?? f.step, 'aria-label': key });
  const value = h('span', { class: 'value' });
  let pending = null;
  let frame = 0;
  const paint = () => {
    const lo = Number(input.min), hi = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - lo) / (hi - lo)) * 100}%`);
    value.textContent = format(Number(input.value));
  };
  input.addEventListener('input', () => {
    paint();
    pending = Number(input.value);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; set({ [key]: pending }); });
  });
  onRefresh((s) => {
    if (document.activeElement !== input) input.value = s[key];
    paint();
  });
  input.refreshRange = (lo, hi) => { input.min = lo; input.max = hi; paint(); };
  return h('span', { class: 'control' }, input, value);
}

function toggle(key, { onChange } = {}) {
  const btn = h('button', { class: 'switch', role: 'switch', 'aria-label': key });
  btn.addEventListener('click', async () => {
    const next = !S[key];
    await set({ [key]: next });
    onChange?.(next);
  });
  onRefresh((s) => btn.setAttribute('aria-checked', String(!!s[key])));
  return btn;
}

function seg(key, options) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', html: (o.icon ? icon(o.icon, 15) : '') }, o.label);
    b.addEventListener('click', () => set({ [key]: o.value }));
    wrap.append(b);
    return [o.value, b];
  });
  onRefresh((s) => { for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(s[key] === v)); });
  return wrap;
}

function color(key) {
  const input = h('input', { type: 'color', 'aria-label': key });
  const code = h('code', {});
  let frame = 0;
  input.addEventListener('input', () => {
    code.textContent = input.value;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; set({ [key]: input.value }); });
  });
  onRefresh((s) => { input.value = s[key]; code.textContent = s[key]; });
  return h('span', { class: 'color' }, input, code);
}

function button(label, onClick, { iconName, cls = '' } = {}) {
  return h('button', { class: `btn ${cls}`, type: 'button', onclick: onClick, html: iconName ? icon(iconName, 15) : '' }, label);
}

/* ---------- preview ---------- */

function preview() {
  const box = h('div', { class: 'preview' },
    h('span', { class: 'pv-line pv-read' }, 'Thank you all for being here today.'),
    h('span', { class: 'pv-line' }, 'Let me tell you ', h('span', { class: 'pv-now' }, 'where'), ' we are going next.'),
    h('span', { class: 'pv-line', style: { opacity: '0.9' } }, 'It starts with a simple idea.'));
  onRefresh((s) => {
    const font = fontById(s.fontId);
    const size = Math.min(s.fontSize, 34);
    Object.assign(box.style, {
      background: hexA(s.backgroundColor, s.backgroundOpacity),
      color: s.textColor,
      fontFamily: `'${font.family}', sans-serif`,
      fontSize: `${size}px`,
      fontWeight: String(Math.max(font.min, Math.min(font.max, s.fontWeight))),
      lineHeight: String(s.lineHeight),
      letterSpacing: `${s.letterSpacing}em`,
      textAlign: s.textAlign,
      transform: s.mirror ? 'scaleX(-1)' : '',
      borderRadius: `0 0 ${s.cornerRadius}px ${s.cornerRadius}px`,
    });
    box.style.setProperty('--pv-hl', s.highlightColor);
    box.style.setProperty('--pv-read', s.dimReadText ? String(s.readTextOpacity) : '1');
  });
  return box;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------- sections ---------- */

const SECTIONS = [
  { id: 'script', label: 'Script', icon: 'file-text', render: renderScript },
  { id: 'text', label: 'Text', icon: 'type', render: renderText },
  { id: 'colors', label: 'Colors', icon: 'palette', render: renderColors },
  { id: 'display', label: 'Display', icon: 'monitor', render: renderDisplay },
  { id: 'reading', label: 'Reading', icon: 'book-open-text', render: renderReading },
  { id: 'voice', label: 'Voice', icon: 'mic', render: renderVoice },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard', render: renderShortcuts },
  { id: 'general', label: 'General', icon: 'sliders-horizontal', render: renderGeneral },
  { id: 'updates', label: 'Updates', icon: 'download', render: renderUpdates },
  { id: 'about', label: 'About', icon: 'info', render: renderAbout },
];

async function renderScript() {
  const info = h('div', { class: 'label' });
  const paintInfo = (script) => {
    info.replaceChildren(
      h('strong', {}, script ? script.title : 'No script loaded'),
      h('span', {}, script ? `${script.fileName || (script.kind === 'sample' ? 'Built-in welcome script' : 'Pasted / written in YALTI')} · ${script.wordCount.toLocaleString()} words · ${describeDuration(script.wordCount / SPEAKING_WPM)} to read aloud` : 'Open a .txt or .md file to begin.'));
  };
  paintInfo(await api.currentScript());
  const unsub = api.on('script:loaded', paintInfo);
  cleanup.push(unsub);

  const recentList = h('ul', { class: 'recent' });
  const paintRecent = async () => {
    const recent = await api.recent();
    recentList.replaceChildren(...(recent.length ? recent.map((p) => h('li', {}, h('button', { type: 'button', onclick: () => api.openRecent(p) },
      h('span', {}, p.split(/[\\/]/).pop()), h('span', { class: 'path' }, p)))) : [h('li', { class: 'faint', style: { padding: '6px 10px' } }, 'Scripts you open will appear here.')]));
  };
  paintRecent();
  cleanup.push(api.on('script:loaded', paintRecent));

  const zone = h('button', { type: 'button', class: 'dropzone', onclick: () => api.openScriptDialog() },
    h('span', { class: 'dz-icon', html: icon('file-text', 22) }),
    h('strong', {}, 'Drop a script or highlighted text here'),
    h('span', {}, 'Text, Markdown and subtitle files, or a selection dragged from Word, a browser or any app. Click to browse.'));

  return [
    h('h1', {}, 'Script'),
    h('p', { class: 'lede' }, 'Open plain text (.txt), Markdown (.md) and subtitle files (.srt, .vtt). Markdown is shown as clean text — headings, lists and emphasis without the symbols. Text in [square brackets] is shown as a quiet cue and never tracked.'),
    zone,
    card(null,
      h('div', { class: 'row' }, info, h('div', { class: 'control' },
        button('Open…', () => api.openScriptDialog(), { iconName: 'folder-open', cls: 'primary' }),
        button('Edit', () => api.openPanel('editor'), { iconName: 'square-pen' }))),
      row('Other ways to start', 'Paste text from the clipboard, reload from disk, or open the file in your usual editor.',
        h('span', { class: 'control' },
          button('Paste', () => api.pasteScript(), { iconName: 'clipboard-paste' }),
          button('Reload', () => api.reloadScript(), { iconName: 'refresh-cw' }),
          button('Open externally', () => api.openShell('script-external'), { iconName: 'external-link' }))),
      row('Reopen the last script on start', null, toggle('reopenLastScript')),
      row('Reload automatically when the file changes', 'Edit in any editor and save — YALTI keeps your place.', toggle('watchScriptFile'))),
    card('Recent', recentList),
    card(null, row('Welcome script', 'Read the built-in introduction again.', button('Open welcome', () => api.openSample(), { iconName: 'sparkles' }))),
  ];
}

function renderText() {
  const weight = slider('fontWeight', { format: (v) => String(v) });
  const range = weight.querySelector('input');
  onRefresh((s) => { const f = fontById(s.fontId); range.refreshRange(f.min, f.max); });
  const fonts = h('div', { class: 'fonts' }, ...FONTS.map((f) => {
    const b = h('button', { type: 'button', class: 'font-card', onclick: () => set({ fontId: f.id }) },
      h('span', { class: 'aa', style: { fontFamily: `'${f.family}'` } }, 'Aa'), h('span', { class: 'nm' }, f.label));
    onRefresh((s) => b.setAttribute('aria-pressed', String(s.fontId === f.id)));
    return b;
  }));
  return [
    h('h1', {}, 'Text'),
    h('p', { class: 'lede' }, 'All fonts are open source (SIL Open Font License) and bundled, so they work offline.'),
    card('Preview', preview()),
    card('Font', h('div', { class: 'row stack' }, fonts)),
    card('Type',
      row('Size', null, slider('fontSize', { format: (v) => `${v}px` })),
      row('Weight', null, weight),
      row('Line spacing', null, slider('lineHeight', { format: (v) => v.toFixed(2) })),
      row('Letter spacing', null, slider('letterSpacing', { format: (v) => `${(v * 100).toFixed(1)}%` })),
      row('Alignment', null, seg('textAlign', [
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }]))),
  ];
}

const THEMES = [
  { name: 'Classic', bg: '#000000', text: '#ffffff', hl: '#ffd166' },
  { name: 'Studio', bg: '#000000', text: '#f2f2f2', hl: '#5ee2a0' },
  { name: 'Soft', bg: '#111114', text: '#e6e6ec', hl: '#8ab4ff' },
  { name: 'Contrast', bg: '#000000', text: '#ffffff', hl: '#00e5ff' },
  { name: 'Amber', bg: '#0b0905', text: '#ffcf8a', hl: '#ffffff' },
  { name: 'Paper', bg: '#f6f1e7', text: '#1d1d1f', hl: '#c2410c' },
];

function renderColors() {
  const themes = h('div', { class: 'themes' }, ...THEMES.map((t) => h('button', {
    type: 'button', class: 'theme', onclick: () => set({ backgroundColor: t.bg, textColor: t.text, highlightColor: t.hl }),
  }, h('span', { class: 'sw', style: { background: t.bg, color: t.hl } }, 'A'), t.name)));
  return [
    h('h1', {}, 'Colors'),
    h('p', { class: 'lede' }, 'A dark island with crisp light text is easiest to read and disappears into the bezel. Lower the opacity to see what is behind it.'),
    card('Preview', preview()),
    card('Themes', h('div', { class: 'row stack' }, themes)),
    card('Custom',
      row('Background', null, color('backgroundColor')),
      row('Text', null, color('textColor')),
      row('Reading highlight', 'The word you just said, the reading marker and progress.', color('highlightColor')),
      row('Background opacity', null, slider('backgroundOpacity', { format: (v) => `${Math.round(v * 100)}%` })),
      row('Text already read', 'How visible the lines you have finished stay.', slider('readTextOpacity', { format: (v) => `${Math.round(v * 100)}%` }))),
  ];
}

async function renderDisplay() {
  const displays = await api.displays();
  const select = h('select', { 'aria-label': 'Display' }, h('option', { value: '' }, 'Main display'),
    ...displays.map((d) => h('option', { value: d.id }, d.label)));
  select.addEventListener('change', () => set({ displayId: select.value, offsetX: 0 }));
  onRefresh((s) => { select.value = displays.some((d) => d.id === s.displayId) ? s.displayId : ''; });
  return [
    h('h1', {}, 'Display'),
    h('p', { class: 'lede' }, 'YALTI sits at the top center of your screen — close to the camera, so you keep eye contact. Drag the island sideways to move it, or drag its corner to resize.'),
    card('Size and place',
      row('Width', null, slider('width', { format: (v) => `${v}px` })),
      row('Height', null, slider('height', { format: (v) => `${v}px` })),
      row('Screen', displays.length > 1 ? 'Which monitor the prompter lives on.' : 'Only one display is connected.', select),
      row('Horizontal position', null, h('span', { class: 'control' },
        slider('offsetX', { min: -1200, max: 1200, format: (v) => (v === 0 ? 'Centered' : `${v > 0 ? '+' : ''}${v}px`) }),
        button('Recenter', () => set({ offsetX: 0 }), { cls: 'ghost' }))),
      row('Attach to', 'Use “Below the taskbar” if your taskbar is at the top.', seg('anchor', [
        { value: 'screen', label: 'Screen edge' }, { value: 'workarea', label: 'Below the taskbar' }])),
      row('Always on top', 'Stay above other windows, including full-screen slides.', toggle('alwaysOnTop'))),
    card('Top-edge effect',
      row('Style', 'Liquid flows out of the bezel; Flush meets it squarely; Floating hangs just below it.', seg('bezelStyle', [
        { value: 'liquid', label: 'Liquid' }, { value: 'flush', label: 'Flush' }, { value: 'floating', label: 'Floating' }])),
      row('Intensity', 'How strongly the surface flares and ripples.', slider('bezelIntensity', { format: (v) => `${Math.round(v * 100)}%` })),
      row('Corner roundness', null, slider('cornerRadius', { format: (v) => `${v}px` })),
      row('Soft shadow', null, toggle('shadow'))),
    card('Extras',
      row('Mirror text', 'For beam-splitter teleprompter glass.', toggle('mirror')),
      row('Show progress line', null, toggle('showProgress'))),
  ];
}

function renderReading() {
  return [
    h('h1', {}, 'Reading'),
    h('p', { class: 'lede' }, 'Voice tracking follows what you say. Auto-scroll moves at a steady pace. You can always scroll by hand with the mouse wheel, arrow keys or by dragging the text.'),
    card('Movement',
      row('Mode', null, seg('scrollMode', [{ value: 'voice', label: 'Follow my voice', icon: 'audio-lines' }, { value: 'auto', label: 'Auto-scroll', icon: 'chevrons-down' }])),
      row('Auto-scroll speed', 'Also adjustable while reading with [ and ].', slider('autoScrollSpeed', { format: (v) => `${v} px/s` })),
      row('Countdown before auto-scroll', null, slider('countdown', { format: (v) => (v ? `${v} s` : 'Off') })),
      row('Manual scrolling speed', 'How far each turn of the mouse wheel moves the text.', slider('wheelSpeed', { format: (v) => `${v.toFixed(2)}×` })),
      row('Scroll smoothness', 'Softer glides more gently between lines.', slider('scrollSmoothness', { format: (v) => (v < 0.3 ? 'Snappy' : v > 0.7 ? 'Soft' : 'Balanced') }))),
    card('What you see',
      row('Reading line', 'Higher shows more upcoming text below your current line.', slider('readingLine', { format: (v) => `${Math.round(v * 100)}% from top` })),
      row('Highlight spoken words', 'Tint the words you have said on the current line.', toggle('highlightSpoken')),
      row('Dim text already read', null, toggle('dimReadText')),
      row('Reading marker', 'A small bar beside the line to read.', toggle('showReadingMarker'))),
  ];
}

async function renderVoice() {
  const models = await api.models();
  const modelSelect = h('select', { 'aria-label': 'Speech model' }, ...(models.length ? models.map((m) => h('option', { value: m.id }, m.name)) : [h('option', { value: '' }, 'No model installed')]));
  modelSelect.addEventListener('change', () => set({ modelId: modelSelect.value }));
  onRefresh((s) => { modelSelect.value = models.some((m) => m.id === s.modelId) ? s.modelId : (models[0]?.id || ''); });

  const micSelect = h('select', { 'aria-label': 'Microphone' }, h('option', { value: '' }, 'System default'));
  const fillMics = async () => {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      micSelect.replaceChildren(h('option', { value: '' }, 'System default'), ...devices.map((d, i) => h('option', { value: d.deviceId }, d.label || `Microphone ${i + 1}`)));
      micSelect.value = devices.some((d) => d.deviceId === S.micDeviceId) ? S.micDeviceId : '';
    } catch { /* ignore */ }
  };
  fillMics();
  micSelect.addEventListener('change', () => set({ micDeviceId: micSelect.value }));

  const meter = h('div', { class: 'meter' }, h('div'));
  const testBtn = button('Test microphone', () => toggleMicTest(meter, testBtn, fillMics), { iconName: 'mic' });

  return [
    h('h1', {}, 'Voice'),
    h('p', { class: 'lede' }, 'Speech recognition runs entirely on this computer with an open-source model. Audio is processed in memory, never recorded, and never sent anywhere.'),
    card('Microphone',
      row('Input', null, micSelect),
      row('Level', 'Speak to see the meter move.', h('span', { class: 'control' }, meter, testBtn))),
    card('Following your voice',
      row('Sensitivity', 'Cautious waits for more words before moving; Responsive follows faster.', seg('speechSensitivity', [
        { value: 'cautious', label: 'Cautious' }, { value: 'balanced', label: 'Balanced' }, { value: 'responsive', label: 'Responsive' }])),
      row('Find my place anywhere', 'When you skip ahead or go back, jump to where you resumed. Off: only follow nearby text.', toggle('allowJumps')),
      row('Microphone indicator', 'A small live waveform in the corner of the prompter while YALTI listens. Click it to stop listening.', toggle('showMicIndicator'))),
    card('Engine',
      row('Speech model', models.length ? 'English is included. More sherpa-onnx streaming models can be added to the models folder.' : 'Voice tracking needs a model; manual and auto-scroll still work.', modelSelect),
      row('Processor threads', 'More threads can lower latency on slow machines; one is plenty for most.', slider('speechThreads', { format: (v) => String(v) })),
      h('div', { class: 'note' }, 'Models folder: ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openShell('models'); } }, 'open'), ' · Speech engine: sherpa-onnx (Apache-2.0) · Model: Zipformer streaming transducer (Apache-2.0)')),
  ];
}

async function toggleMicTest(meter, btn, refreshDevices) {
  if (micTest) { stopMicTest(); btn.lastChild.textContent = 'Test microphone'; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: S.micDeviceId ? { deviceId: { exact: S.micDeviceId } } : true });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const bar = meter.firstChild;
    const loop = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
      bar.style.width = `${Math.round(level * 100)}%`;
      micTest.raf = requestAnimationFrame(loop);
    };
    micTest = { stream, ctx, raf: requestAnimationFrame(loop), timer: setTimeout(() => { stopMicTest(); btn.lastChild.textContent = 'Test microphone'; }, 15000) };
    btn.lastChild.textContent = 'Stop test';
    refreshDevices();
  } catch (err) {
    meter.firstChild.style.width = '0';
    btn.lastChild.textContent = err.name === 'NotAllowedError' ? 'Blocked by Windows' : 'No microphone';
    if (err.name === 'NotAllowedError') api.openShell('mic-privacy');
  }
}

function stopMicTest() {
  if (!micTest) return;
  cancelAnimationFrame(micTest.raf);
  clearTimeout(micTest.timer);
  for (const t of micTest.stream.getTracks()) t.stop();
  micTest.ctx.close();
  micTest = null;
  const bar = document.querySelector('.meter div');
  if (bar) bar.style.width = '0';
}

let shortcutStatus = {};
function renderShortcuts() {
  const rows = initial.shortcuts.map((a) => {
    const dot = h('span', { class: 'status-dot' });
    const btn = h('button', { type: 'button', class: 'btn shortcut' });
    btn.addEventListener('click', () => recordShortcut(a.id, btn));
    onRefresh((s) => {
      btn.textContent = s.shortcuts[a.id] || 'Not set';
      const st = s.globalShortcuts ? (shortcutStatus[a.id] || 'ok') : 'off';
      dot.className = `status-dot ${st}`;
      dot.title = { ok: 'Active', taken: 'Another app already uses this shortcut', invalid: 'Not a valid shortcut', off: 'Off' }[st];
    });
    return row(a.label, null, h('span', { class: 'control' }, dot, btn));
  });
  const local = [['Start / pause', 'Space'], ['Voice tracking on / off', 'M'], ['Scroll a line / a page', '↑ ↓ · PgUp PgDn'], ['Back to the start / end', 'Home · End'], ['Jump back after a jump', 'Backspace'], ['Slower / faster', '[ ]'], ['Text size', 'Ctrl + / −'], ['Open · Paste · Edit · Reload', 'Ctrl+O · Ctrl+V · Ctrl+E · Ctrl+R'], ['Settings', 'Ctrl+,'], ['Collapse · Hide', 'Esc · H'], ['All shortcuts', '?']];
  return [
    h('h1', {}, 'Shortcuts'),
    h('p', { class: 'lede' }, 'Global shortcuts work even while another app — your slides or a video call — has focus. Click a shortcut to record a new one; press Backspace to clear it.'),
    card('Anywhere in Windows',
      row('Enable global shortcuts', null, toggle('globalShortcuts')),
      ...rows,
      h('div', { class: 'note' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.resetSettings(['shortcuts']); } }, 'Restore default shortcuts'))),
    card('When the prompter is focused', ...local.map(([l, k]) => row(l, null, h('kbd', {}, k)))),
  ];
}

function recordShortcut(id, btn) {
  btn.classList.add('recording');
  btn.textContent = 'Press keys…';
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    window.removeEventListener('keydown', onKey, true);
    btn.classList.remove('recording');
    if (e.key === 'Escape') { btn.textContent = S.shortcuts[id] || 'Not set'; return; }
    const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (bare && (e.key === 'Backspace' || e.key === 'Delete')) { set({ shortcuts: { ...S.shortcuts, [id]: '' } }); return; }
    const key = acceleratorKey(e);
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!key || (!mods.length && !/^F\d+$|^Media/.test(key))) { btn.textContent = 'Use a modifier (Ctrl, Alt…)'; setTimeout(() => { btn.textContent = S.shortcuts[id] || 'Not set'; }, 1600); return; }
    set({ shortcuts: { ...S.shortcuts, [id]: [...mods, key].join('+') } });
  };
  window.addEventListener('keydown', onKey, true);
}

function acceleratorKey(e) {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  const map = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End', Insert: 'Insert', Backspace: 'Backspace', Delete: 'Delete', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec', NumpadEnter: 'Enter', MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack',
    MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop',
  };
  return map[code] || null;
}

function renderGeneral() {
  return [
    h('h1', {}, 'General'),
    card('Startup',
      row('Start with Windows', 'Keep YALTI ready in the tray whenever you sign in.', toggle('launchAtLogin')),
      row('When started with Windows', null, seg('startState', [{ value: 'expanded', label: 'Open' }, { value: 'compact', label: 'Compact' }, { value: 'hidden', label: 'In the tray' }]))),
    card('Data',
      row('Settings folder', initial.info.portable ? 'Portable mode: settings are stored next to the app.' : 'Your settings, recent scripts and reading positions.', button('Open folder', () => api.openShell('data'), { iconName: 'folder-open' })),
      row('Reset everything', 'Restore all settings to their defaults.', button('Reset settings', async () => {
        if (window.confirm('Reset all settings to their defaults?')) await api.resetSettings();
      }, { cls: 'danger' }))),
    card(null, row('Quit YALTI Prompter', 'The prompter normally keeps running in the tray.', button('Quit', () => api.quit()))),
  ];
}

/** Release notes are Markdown; show them as calm plain text. */
function plainNotes(md) {
  return md
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const megabytes = (n) => `${Math.max(1, Math.round(n / 1e6))} MB`;

async function renderUpdates() {
  const info = h('div', { class: 'label' });
  const actions = h('span', { class: 'control' });
  const bar = h('div', { class: 'update-progress', hidden: true }, h('div'));
  const notes = h('div', { class: 'release-notes' });
  const notesCard = card('What’s new', notes);

  const paint = (s) => {
    const v = s.latest?.version;
    const newer = !!v && v !== s.current;
    const checked = s.checkedAt ? ` Checked at ${formatTime(s.checkedAt)}.` : '';
    const released = s.latest?.publishedAt ? ` (released ${formatDate(s.latest.publishedAt)})` : '';
    const check = (label = 'Check for updates', cls = '') => button(label, () => api.checkForUpdates(), { iconName: 'refresh-cw', cls });
    const page = () => button('Release page', () => api.openShell('release'), { iconName: 'external-link', cls: 'ghost' });
    let text = '';
    let error = false;
    let buttons = [];
    bar.hidden = true;
    switch (s.state) {
      case 'checking':
        text = 'Checking GitHub for a new version…';
        buttons = [h('button', { class: 'btn', type: 'button', disabled: true, html: icon('refresh-cw', 15) }, 'Checking…')];
        break;
      case 'up-to-date':
        text = `You have the latest version.${checked}`;
        buttons = [check()];
        break;
      case 'available':
        if (!s.canDownload) {
          text = `Version ${v} is available${released}. This is a development copy, so get it from the release page.`;
          buttons = [page(), check('Check again')];
        } else {
          text = `Version ${v} is available${released}.`;
          const label = { installer: 'Download and install', portable: 'Download', zip: 'Download zip' }[s.kind];
          buttons = [page(), button(label, () => api.downloadUpdate(), { iconName: 'download', cls: 'primary' })];
        }
        break;
      case 'downloading': {
        const { received = 0, total = 0 } = s.progress || {};
        const pct = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
        text = `Downloading version ${v}… ${total ? `${pct}% of ${megabytes(total)}` : megabytes(received)}`;
        bar.hidden = false;
        bar.firstChild.style.width = `${pct}%`;
        buttons = [button('Cancel', () => api.cancelUpdate(), { cls: 'ghost' })];
        break;
      }
      case 'downloaded':
        if (s.kind === 'installer') {
          text = `Version ${v} is ready. It installs when you quit YALTI — or install it now and YALTI restarts in a moment.`;
          buttons = [button('Restart and install', () => api.installUpdate(), { iconName: 'refresh-cw', cls: 'primary' })];
        } else if (s.kind === 'portable') {
          text = `Version ${v} was saved next to this copy of YALTI. Switch to it now; your settings come along.`;
          buttons = [button('Switch to the new version', () => api.installUpdate(), { iconName: 'refresh-cw', cls: 'primary' })];
        } else {
          text = `Version ${v} was saved to your Downloads folder. Unzip it in place of this folder to update.`;
          buttons = [button('Show in folder', () => api.installUpdate(), { iconName: 'folder-open' })];
        }
        if (s.error) { text = s.error; error = true; }
        break;
      case 'installing':
        text = 'Starting the update — YALTI will close and come back in a moment.';
        break;
      case 'error':
        text = s.error || 'Updating failed.';
        error = true;
        buttons = newer ? [page(), check('Try again')] : [check('Try again')];
        break;
      default:
        text = 'YALTI hasn’t checked for updates yet.';
        buttons = [check('Check for updates', 'primary')];
    }
    info.replaceChildren(h('strong', {}, `YALTI Prompter ${s.current}`), h('span', { class: error ? 'bad' : '' }, text));
    actions.replaceChildren(...buttons);
    notesCard.hidden = !(newer && s.latest.notes);
    notes.textContent = newer ? plainNotes(s.latest.notes || '') : '';
  };
  const status = await api.updateStatus();
  paint(status);
  cleanup.push(api.on('update:status', paint));

  const autoDesc = status.kind === 'installer'
    ? 'When YALTI starts, and once a day while it runs, check GitHub for a new version and download it in the background. It installs the next time you quit — never in the middle of a talk.'
    : 'When YALTI starts, and once a day while it runs, check GitHub for a new version and let you know. This copy updates only when you choose to.';

  return [
    h('h1', {}, 'Updates'),
    h('p', { class: 'lede' }, 'New versions of YALTI Prompter are published on GitHub. Check for one here, or let YALTI keep itself up to date.'),
    card(null, h('div', { class: 'row update-row' }, info, actions), bar),
    notesCard,
    card('Automatic updates',
      row('Update automatically', autoDesc, toggle('autoUpdate')),
      h('div', { class: 'note' }, 'Checking for updates is the only time YALTI goes online: it asks GitHub for the latest release and downloads it from there. Nothing about you or your scripts is sent, and every download is checked against the checksums published with the release before it is used.')),
  ];
}

function renderAbout() {
  const i = initial.info;
  const credit = (name, what, license) => h('div', {}, h('b', {}, name), ` — ${what} (${license})`);
  return [
    h('div', { class: 'about-head' },
      h('img', { src: '/assets/icons/icon.png', alt: '' }),
      h('div', {}, h('div', { class: 'name' }, 'YALTI Prompter'), h('div', { class: 'tag' }, 'Your words. Your voice.'),
        h('div', { class: 'faint' }, `Version ${i.version}${i.portable ? ' · portable' : ''} · Electron ${i.electron}`))),
    card('Privacy',
      h('div', { class: 'note', style: { borderTop: '0' } }, 'YALTI works fully offline. Your scripts and your voice never leave this computer: speech recognition runs locally, nothing is recorded, there are no accounts, no analytics and no cloud services.')),
    card('Open source',
      h('div', { class: 'note', style: { borderTop: '0' } }, 'YALTI Prompter is free software under the MIT License. It is built on these open-source projects:'),
      h('div', { class: 'credits' },
        credit('Electron', 'desktop runtime', 'MIT'),
        credit('Chromium', 'rendering', 'BSD-3-Clause and others'),
        credit('sherpa-onnx', 'speech recognition', 'Apache-2.0'),
        credit('ONNX Runtime', 'inference', 'MIT'),
        credit('Zipformer English model', 'k2-fsa / icefall', 'Apache-2.0'),
        credit('marked', 'Markdown parsing', 'MIT'),
        credit('Inter, Atkinson Hyperlegible Next, Lexend, Figtree, Manrope, Nunito, Literata, Source Serif 4, JetBrains Mono', 'fonts via Fontsource', 'OFL-1.1'),
        credit('Lucide', 'icons', 'ISC')),
      row('License texts', null, button('Open licenses', () => api.openShell('licenses'), { iconName: 'file-text' })),
      row('Project page', 'Source code, releases and issues on GitHub.', button('Open on GitHub', () => api.openShell('repo'), { iconName: 'external-link' }))),
  ];
}

/* ---------- drag and drop ---------- */

let flashTimer = null;
function flash(message, kind = 'info') {
  let el = document.getElementById('flash');
  if (!el) {
    el = h('div', { id: 'flash', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/** Dropping a script file or highlighted text anywhere in Settings opens it in the prompter. */
function setupDrop() {
  window.addEventListener('dragover', (e) => {
    if (!dropKind(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('drop-target');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('drop-target');
  });
  window.addEventListener('drop', async (e) => {
    document.body.classList.remove('drop-target');
    if (!dropKind(e.dataTransfer)) return;
    e.preventDefault();
    const res = await openDropped(api, e.dataTransfer);
    if (res.ok) {
      const script = await api.currentScript();
      flash(`Opened “${script?.title || 'your script'}” in the prompter`);
      if (current !== 'script') show('script');
    } else {
      flash(res.message || 'That couldn’t be opened as a script.', 'error');
    }
  });
}

/* ---------- navigation ---------- */

let cleanup = [];
async function show(id) {
  stopMicTest();
  for (const fn of cleanup) { try { fn(); } catch { /* ignore */ } }
  cleanup = [];
  updaters = [];
  current = SECTIONS.some((s) => s.id === id) ? id : 'text';
  for (const b of document.querySelectorAll('#nav button')) b.setAttribute('aria-current', b.dataset.id === current ? 'page' : 'false');
  const section = SECTIONS.find((s) => s.id === current);
  const content = document.getElementById('content');
  const nodes = await section.render();
  content.replaceChildren(...nodes);
  content.scrollTop = 0;
}

async function init() {
  initial = await api.initial();
  S = initial.settings;
  shortcutStatus = initial.shortcutStatus || {};
  const nav = document.getElementById('nav');
  for (const s of SECTIONS) {
    nav.append(h('button', { type: 'button', 'data-id': s.id, onclick: () => show(s.id), html: icon(s.icon, 17) }, s.label));
  }
  api.on('settings:changed', (s) => { S = s; for (const fn of updaters) fn(S); });
  api.on('shortcuts:status', (st) => { shortcutStatus = st; for (const fn of updaters) fn(S); });
  api.on('panel:section', (id) => show(id));
  setupDrop();
  await show(location.hash.slice(1) || 'text');
}

init();
