// The prompter window: ties the island, the script view, voice tracking and
// the controls together.

import { Island } from './island.js';
import { ScriptView } from './script-view.js';
import { VoiceInput } from './voice.js';
import { MicMeter } from './mic-meter.js';
import { buildModel } from '../../core/document.js';
import { SpeechTracker } from '../../core/tracker.js';
import { fontById } from '../../core/settings-schema.js';
import { describeDuration, SPEAKING_WPM } from '../../core/text.js';
import { Animator } from '../../core/spring.js';
import { cornerGrip } from '../../core/island-shape.js';
import { icon } from '../shared/icons.js';
import { dropKind, openDropped } from '../shared/drop.js';

const api = window.yalti;
const $ = (sel) => document.querySelector(sel);
const body = document.body;

const view = new ScriptView({ viewport: $('#viewport'), column: $('#column'), marker: $('#reading-marker') });
const tracker = new SpeechTracker([]);

const app = {
  settings: null,
  script: null,
  model: null,
  visibility: 'hidden',
  lastVisible: 'expanded',
  playing: false,
  voiceState: 'off',
  trackState: 'idle',
  speechStatus: { state: 'stopped' },
  models: [],
  shortcuts: [],
  shortcutStatus: {},
  firstScript: true,
  searchingSince: 0,
  hintTimer: null,
  controlsTimer: null,
  saveTimer: null,
  countdownTimer: null,
};

const island = new Island({
  path: $('#island-path'),
  sheen: $('#island-sheen'),
  expanded: $('#expanded'),
  compact: $('#compact'),
  toast: $('#toast'),
  drop: $('#drop-overlay'),
  onIgnoreMouse: (ignore) => api.setIgnoreMouse(ignore),
  onSettled: (mode) => {
    if (mode === 'hidden') api.hideWindow();
  },
});

const scroller = new Animator((dt) => {
  const moving = view.frame(dt);
  if (app.playing && app.settings.scrollMode === 'auto') {
    view.markReadingLine();
    updateProgress();
    if (view.atEnd) stopAuto();
  }
  return moving || (app.playing && app.settings.scrollMode === 'auto');
});

const voice = new VoiceInput({
  onResult: onSpeechResult,
  onLevel: (rms) => {
    const s = Math.min(1.8, 1 + rms * 9);
    $('#compact-dot').style.transform = `scale(${s.toFixed(2)})`;
  },
  onStatus: onVoiceStatus,
});

const micMeter = new MicMeter($('#mic-meter'), voice);

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const TYPO_KEYS = ['fontId', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'width', 'height'];

function applySettings(s, changed = null) {
  const all = !changed;
  const has = (...keys) => all || keys.some((k) => changed.includes(k));
  app.settings = s;
  const root = document.documentElement.style;
  const font = fontById(s.fontId);
  root.setProperty('--bg', s.backgroundColor);
  root.setProperty('--bg-opacity', String(s.backgroundOpacity));
  root.setProperty('--text', s.textColor);
  root.setProperty('--hl', s.highlightColor);
  root.setProperty('--font', `'${font.family}', system-ui, sans-serif`);
  root.setProperty('--size', `${s.fontSize}px`);
  root.setProperty('--weight', String(Math.max(font.min, Math.min(font.max, s.fontWeight))));
  root.setProperty('--lh', String(s.lineHeight));
  root.setProperty('--ls', `${s.letterSpacing}em`);
  root.setProperty('--align', s.textAlign);
  root.setProperty('--read-opacity', String(s.readTextOpacity));
  root.setProperty('--pad-x', `${Math.round(Math.max(28, Math.min(64, s.width * 0.05)))}px`);
  root.setProperty('--corner', `${s.cornerRadius}px`);

  body.classList.toggle('shadow', s.shadow);
  body.classList.toggle('mirror', s.mirror);
  body.classList.toggle('dim-read', s.dimReadText);
  body.classList.toggle('hl-spoken', s.highlightSpoken);
  body.classList.toggle('marker', s.showReadingMarker);
  body.classList.toggle('show-progress', s.showProgress);
  body.classList.toggle('style-floating', s.bezelStyle === 'floating');

  island.setLook({ style: s.bezelStyle, intensity: s.bezelIntensity, radius: s.cornerRadius });
  if (has('cornerRadius')) shapeGrips(s.cornerRadius);
  view.setSmoothness(s.scrollSmoothness);
  if (has('readingLine')) view.setReadingLine(s.readingLine);
  if (has('mirror')) view.setMirror(s.mirror);
  tracker.setOptions({ sensitivity: s.speechSensitivity, allowJumps: s.allowJumps });

  if (has(...TYPO_KEYS)) relayoutWhenFontsReady();
  if (has('autoScrollSpeed') && app.playing && s.scrollMode === 'auto') view.autoSpeed = s.autoScrollSpeed;
  if (has('scrollMode') && !all) {
    if (s.scrollMode !== 'voice' && voice.running) stopVoice();
    if (s.scrollMode !== 'auto' && app.playing && !voice.running) stopAuto();
  }
  if (has('micDeviceId') && !all && voice.running) {
    voice.stop();
    startVoice();
  }
  if (has('highlightSpoken', 'dimReadText', 'scrollMode') && !all) refreshMarks();
  if (has('showMicIndicator') && !all) updateMicMeter();
  renderControls();
  updateProgress();
}

/** Fit the corner resize grips to the island's corner radius. */
function shapeGrips(radius) {
  const { size, clip, grip } = cornerGrip({ r: radius });
  for (const el of document.querySelectorAll('.resize-grip, .grip-mark')) {
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }
  for (const el of document.querySelectorAll('.resize-grip')) el.style.clipPath = `path('${clip}')`;
  for (const el of document.querySelectorAll('.grip-mark')) {
    el.setAttribute('viewBox', `0 0 ${size} ${size}`);
    el.querySelector('path').setAttribute('d', grip);
  }
}

let relayoutQueued = false;
function relayoutWhenFontsReady() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  const s = app.settings;
  const font = fontById(s.fontId);
  const spec = `${s.fontWeight} ${s.fontSize}px "${font.family}"`;
  Promise.all([document.fonts.load(spec), document.fonts.load(`italic ${spec}`)]).catch(() => {}).finally(() => {
    requestAnimationFrame(() => {
      relayoutQueued = false;
      view.relayout();
      refreshMarks();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Script                                                              */
/* ------------------------------------------------------------------ */

function loadScript(script) {
  const prevWord = view.anchorWord;
  const prevModel = app.model;
  app.script = script;
  app.model = script ? buildModel(script.blocks || []) : null;
  const model = app.model;
  view.setModel(model || { blocks: [], words: [] });
  tracker.setTokens(model ? model.tokens : []);
  const empty = !model || model.words.length === 0;
  $('#empty-state').hidden = !empty;

  let word = 0;
  if (script?.keepPosition && prevModel) word = mapWord(prevModel, model, prevWord);
  else if (script?.restoreWord) word = Math.min(script.restoreWord, Math.max(0, view.wordCount - 1));
  view.jumpToWord(word, { instant: true });
  syncTrackerToView();
  if (voice.running) voice.reset(); // words heard for the old script mean nothing now
  refreshMarks();
  updateProgress();
  updateCompactLabel();
  if (!app.firstScript && script && !script.unsaved) {
    toast(script.reloaded ? `Updated “${script.title}”` : `Loaded “${script.title}”`);
  }
  app.firstScript = false;
}

/** Find the same place in an edited script by matching nearby words. */
function mapWord(oldModel, newModel, oldIndex) {
  const oldWords = oldModel.words.map((w) => w.text);
  const newWords = newModel.words.map((w) => w.text);
  if (!newWords.length) return 0;
  const probe = oldWords.slice(oldIndex, oldIndex + 6).join(' ');
  if (probe) {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < newWords.length; i++) {
      if (newWords[i] !== oldWords[oldIndex]) continue;
      if (newWords.slice(i, i + 6).join(' ') === probe && Math.abs(i - oldIndex) < bestDist) {
        best = i;
        bestDist = Math.abs(i - oldIndex);
      }
    }
    if (best >= 0) return best;
  }
  return Math.min(newWords.length - 1, Math.round((oldIndex / Math.max(1, oldWords.length)) * newWords.length));
}

/** Last token before a word (the tracker counts spoken tokens). */
function tokenBeforeWord(word) {
  const m = app.model;
  if (!m || !m.words.length) return -1;
  const w = m.words[Math.max(0, Math.min(word, m.words.length - 1))];
  return w.tokenStart - 1;
}

function syncTrackerToView() {
  tracker.setPosition(tokenBeforeWord(view.anchorWord));
}

function refreshMarks() {
  if (!app.model || !view.wordCount) return;
  if (app.settings.scrollMode === 'voice' && tracker.position >= 0 && voice.running) {
    const word = app.model.tokens[tracker.position]?.word ?? 0;
    view.markSpoken(word);
  } else if (app.settings.dimReadText) {
    view.markReadingLine();
  } else {
    view.clearMarks();
  }
}

function rememberPositionSoon() {
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(() => {
    if (app.script?.key) api.rememberPosition(app.script.key, view.anchorWord);
  }, 1200);
}

/* ------------------------------------------------------------------ */
/* Voice tracking                                                      */
/* ------------------------------------------------------------------ */

function onSpeechResult(type, text) {
  if (!app.model) return;
  const res = tracker.pushResult(text, type === 'final');
  setTrackState(res.state);
  if (res.moved && res.position >= 0) {
    const word = app.model.tokens[res.position].word;
    if (app.settings.highlightSpoken || app.settings.dimReadText) view.markSpoken(word);
    // Keep the next word to read on the reading line.
    const next = nextReadableWord(word);
    view.jumpToWord(next);
    scroller.kick();
    updateProgress();
    rememberPositionSoon();
  }
}

function nextReadableWord(word) {
  const words = app.model.words;
  let i = word + 1;
  while (i < words.length && words[i].tokenEnd === words[i].tokenStart) i++;
  return Math.min(i, words.length - 1);
}

function setTrackState(state) {
  if (state === app.trackState) return;
  app.trackState = state;
  if (state === 'searching') {
    app.searchingSince = performance.now();
    setTimeout(() => {
      if (app.trackState === 'searching' && voice.running && performance.now() - app.searchingSince >= 2400) {
        hint('Listening for your script…', { ms: 3000 });
      }
    }, 2500);
  }
  updateVoiceClasses();
}

function onVoiceStatus(state, message, detail) {
  app.voiceState = state;
  if (state === 'listening') {
    app.playing = true;
    if (app.trackState === 'idle') hint('Listening — start reading', { ms: 2200 });
  } else if (state === 'loading') {
    hint('Loading speech model…', { ms: 4000 });
  } else if (state === 'connecting' && message) {
    hint(message, { ms: 2500 });
  } else if (state === 'error') {
    app.playing = false;
    voice.stop();
    api.speechRelease();
    app.voiceState = 'error';
    const action = detail?.kind === 'privacy' ? () => api.openShell('mic-privacy') : null;
    hint(message || 'Voice tracking stopped.', { error: true, ms: 7000, action });
    if (app.visibility !== 'expanded') toast(message, 'error');
  } else if (state === 'off') {
    app.playing = false;
  }
  updateVoiceClasses();
  renderControls();
  reportState();
}

function updateVoiceClasses() {
  const listening = voice.running && app.voiceState === 'listening';
  body.classList.toggle('voice-listening', listening && app.trackState !== 'searching');
  body.classList.toggle('voice-searching', listening && app.trackState === 'searching');
  body.classList.toggle('voice-error', app.voiceState === 'error');
  updateCompactLabel();
  updateMicMeter();
}

/** The live microphone indicator: shown (and animated) only while listening in the expanded island. */
function updateMicMeter() {
  const el = $('#mic-meter');
  const on = voice.running && !!app.settings?.showMicIndicator;
  el.hidden = !on;
  el.dataset.state = app.voiceState !== 'listening' ? 'loading' : app.trackState === 'searching' ? 'searching' : 'listening';
  el.title = el.dataset.state === 'searching' ? 'Listening — waiting for words from your script. Click to stop.'
    : el.dataset.state === 'loading' ? 'Starting the microphone… Click to stop.' : 'Listening — click to stop';
  if (on && app.visibility === 'expanded') micMeter.start();
  else micMeter.stop();
}

async function startVoice() {
  if (!app.model?.tokens.length) { toast('Open a script first'); return; }
  if (app.settings.scrollMode !== 'voice') await api.updateSettings({ scrollMode: 'voice' });
  stopAutoOnly();
  syncTrackerToView();
  app.trackState = 'idle';
  app.playing = true;
  renderControls();
  await voice.start(app.settings.micDeviceId);
  refreshMarks();
  reportState();
}

function stopVoice() {
  if (voice.running) voice.stop();
  api.speechRelease();
  app.playing = false;
  app.trackState = 'idle';
  updateVoiceClasses();
  renderControls();
  refreshMarks();
  reportState();
}

/* ------------------------------------------------------------------ */
/* Auto-scroll                                                         */
/* ------------------------------------------------------------------ */

function startAuto() {
  if (!view.wordCount) return;
  if (view.atEnd) view.jumpToWord(0, { instant: true });
  const n = app.settings.countdown;
  app.playing = true;
  renderControls();
  reportState();
  if (n > 0) {
    let k = n;
    const el = $('#countdown');
    const tick = () => {
      if (!app.playing) return;
      if (k === 0) { el.classList.remove('show'); beginAuto(); return; }
      el.textContent = String(k);
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      k--;
      app.countdownTimer = setTimeout(tick, 900);
    };
    tick();
  } else {
    beginAuto();
  }
}

function beginAuto() {
  view.autoSpeed = app.settings.autoScrollSpeed;
  body.classList.add('auto-playing');
  scroller.kick();
}

function stopAutoOnly() {
  clearTimeout(app.countdownTimer);
  view.autoSpeed = 0;
  body.classList.remove('auto-playing');
}

function stopAuto() {
  stopAutoOnly();
  app.playing = false;
  renderControls();
  reportState();
  rememberPositionSoon();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function togglePlay() {
  if (app.settings.scrollMode === 'voice') {
    if (voice.running) stopVoice(); else startVoice();
  } else if (app.playing) {
    stopAuto();
  } else {
    startAuto();
  }
}

/** Voice tracking on = listening. Turning it off switches Space to auto-scroll. */
async function toggleVoiceMode() {
  if (voice.running) {
    stopVoice();
    await api.updateSettings({ scrollMode: 'auto' });
    hint('Voice tracking off — Space scrolls automatically', { ms: 2400 });
  } else {
    stopAuto();
    await startVoice();
  }
}

function manualMove(fn) {
  fn();
  scroller.kick();
  if (voice.running) {
    // The reader moved by hand: follow from the new place.
    tracker.setPosition(tokenBeforeWord(view.anchorWord));
    voice.reset();
  }
  requestAnimationFrame(() => refreshMarksForManual());
  updateProgress();
  rememberPositionSoon();
}

function refreshMarksForManual() {
  if (app.settings.dimReadText) view.setMarks(view.anchorWord, -1, -1);
  else view.clearMarks();
}

function restart() {
  manualMove(() => view.jumpToWord(0));
  tracker.setPosition(-1);
  view.clearMarks();
}

function changeSpeed(factor) {
  const s = Math.round(Math.max(5, Math.min(400, app.settings.autoScrollSpeed * factor)));
  api.updateSettings({ autoScrollSpeed: s });
  hint(`Scroll speed ${s}`, { ms: 1200 });
}

function changeFontSize(delta) {
  const size = Math.max(14, Math.min(120, app.settings.fontSize + delta));
  api.updateSettings({ fontSize: size });
  hint(`Text size ${size}`, { ms: 1000 });
}

function setVisibility(mode) {
  if (mode === app.visibility) return;
  // Coming back from hidden: make sure the window is shown even if a hide
  // request is still on its way to the main process.
  if (app.visibility === 'hidden' && mode !== 'hidden') api.showWindow();
  if (mode !== 'hidden') app.lastVisible = mode;
  app.visibility = mode;
  if (mode !== 'expanded') { body.classList.remove('controls-visible'); $('#help').hidden = true; }
  island.setMode(mode);
  updateCompactLabel();
  updateMicMeter();
  reportState();
}

const actions = {
  play: togglePlay,
  'toggle-voice': toggleVoiceMode,
  restart,
  faster: () => changeSpeed(1.12),
  slower: () => changeSpeed(1 / 1.12),
  open: () => api.openScriptDialog(),
  paste: () => api.pasteScript(),
  edit: () => api.openPanel('editor'),
  settings: () => api.openPanel('settings'),
  collapse: () => setVisibility('compact'),
  expand: () => setVisibility('expanded'),
};

function command(name, arg) {
  switch (name) {
    case 'show': api.geometry().then((g) => island.setGeometry(g)); setVisibility(app.lastVisible || 'expanded'); break;
    case 'hide': setVisibility('hidden'); break;
    case 'toggleExpanded': setVisibility(app.visibility === 'expanded' ? 'compact' : 'expanded'); break;
    case 'expand': setVisibility('expanded'); break;
    case 'collapse': setVisibility('compact'); break;
    case 'playPause': togglePlay(); break;
    case 'toggleVoice': toggleVoiceMode(); break;
    case 'setMode':
      if (arg === 'auto') { if (voice.running) stopVoice(); api.updateSettings({ scrollMode: 'auto' }); }
      else if (arg === 'voice' && app.settings.scrollMode !== 'voice') {
        // Choosing the mode doesn't open the microphone; Space starts listening.
        api.updateSettings({ scrollMode: 'voice' });
        hint('Voice tracking selected — press Space to start listening', { ms: 2400 });
      }
      break;
    case 'lineBack': manualMove(() => view.nudgeLines(-1)); break;
    case 'lineForward': manualMove(() => view.nudgeLines(1)); break;
    case 'faster': changeSpeed(1.12); break;
    case 'slower': changeSpeed(1 / 1.12); break;
    case 'restart': restart(); break;
    default:
  }
}

/* ------------------------------------------------------------------ */
/* Controls, progress, hints                                           */
/* ------------------------------------------------------------------ */

function renderControls() {
  const s = app.settings;
  if (!s) return;
  const voiceMode = s.scrollMode === 'voice';
  const btn = (action) => document.querySelector(`[data-action="${action}"].ctl`);
  const listening = voice.running;
  const play = btn('play');
  if (voiceMode) {
    play.innerHTML = icon(listening ? 'pause' : 'mic', 18);
    play.title = listening ? 'Stop listening (Space)' : 'Start listening (Space)';
  } else {
    play.innerHTML = icon(app.playing ? 'pause' : 'play', 18);
    play.title = app.playing ? 'Pause (Space)' : 'Start scrolling (Space)';
  }
  const mode = btn('toggle-voice');
  mode.innerHTML = icon(voiceMode ? 'audio-lines' : 'chevrons-down', 18);
  mode.title = listening ? 'Voice tracking is on — turn off to auto-scroll (M)'
    : voiceMode ? 'Voice tracking (M) — press to start listening' : 'Auto-scroll — press for voice tracking (M)';
  mode.classList.toggle('on', listening);
  mode.classList.toggle('listening', listening);
  btn('faster').hidden = voiceMode;
  btn('slower').hidden = voiceMode;
  btn('restart').innerHTML = icon('rotate-ccw', 17);
  btn('faster').innerHTML = icon('plus', 17);
  btn('slower').innerHTML = icon('minus', 17);
  btn('open').innerHTML = icon('folder-open', 17);
  btn('edit').innerHTML = icon('square-pen', 17);
  btn('settings').innerHTML = icon('settings-2', 17);
  btn('collapse').innerHTML = icon('chevron-up', 18);
}

function updateProgress() {
  const n = view.wordCount;
  if (!n || !app.settings) return;
  let word = view.anchorWord;
  if (voice.running && tracker.position >= 0 && app.model) word = app.model.tokens[tracker.position].word;
  const p = n <= 1 ? 1 : Math.min(1, word / (n - 1));
  $('#progress-fill').style.transform = `scaleX(${p.toFixed(4)})`;
  $('#compact-progress .value').style.strokeDashoffset = String((47.12 * (1 - p)).toFixed(2));
  let minutes;
  if (app.settings.scrollMode === 'auto' && app.settings.autoScrollSpeed > 0) {
    minutes = (view.maxOffset - view.offset.value) / app.settings.autoScrollSpeed / 60;
  } else {
    minutes = Math.max(0, n - word) / SPEAKING_WPM;
  }
  $('#progress-text').textContent = `${Math.round(p * 100)}% · ${describeDuration(minutes)} left`;
}

function updateCompactLabel() {
  let label = app.script?.title || 'YALTI Prompter';
  if (voice.running) {
    if (app.voiceState === 'loading' || app.voiceState === 'connecting') label = 'Starting voice…';
    else if (app.trackState === 'searching') label = 'Waiting for script';
    else label = 'Listening';
  } else if (app.playing) {
    label = 'Scrolling';
  }
  const el = $('#compact-label');
  if (el.textContent !== label) {
    el.textContent = label;
    const ctx = (updateCompactLabel.ctx ||= document.createElement('canvas').getContext('2d'));
    ctx.font = "600 12.5px 'Inter Variable', system-ui, sans-serif";
    island.setCompactWidth(Math.ceil(ctx.measureText(label).width) + 8 + 9 + 16 + 9 + 34);
  }
}

function hint(text, { ms = 2500, error = false, action = null } = {}) {
  const el = $('#hint');
  if (app.visibility !== 'expanded') {
    if (error) toast(text, 'error');
    return;
  }
  el.textContent = text;
  el.classList.toggle('error', error);
  el.onclick = action;
  el.classList.add('show');
  clearTimeout(app.hintTimer);
  app.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function toast(message, kind = 'info') {
  if (app.visibility === 'expanded') hint(message, { error: kind === 'error', ms: 3200 });
  else if (app.visibility === 'compact') island.showToast(message, { kind });
}

function showControls() {
  if (app.visibility !== 'expanded') return;
  body.classList.add('controls-visible');
  clearTimeout(app.controlsTimer);
  app.controlsTimer = setTimeout(() => {
    if (!$('#controls').matches(':hover')) body.classList.remove('controls-visible');
  }, 2200);
}

let lastReported = '';
function reportState() {
  const state = { visibility: app.visibility, playing: app.playing, voiceState: app.voiceState, listening: voice.running };
  const key = JSON.stringify(state);
  if (key !== lastReported) {
    lastReported = key;
    api.reportState(state);
  }
}

function buildHelp() {
  const rows = [
    ['Start / pause', 'Space'], ['Voice tracking on / off', 'M'], ['Scroll a line', '↑ ↓'], ['Scroll a page', 'PgUp PgDn'],
    ['Back to the start / end', 'Home End'], ['Slower / faster', '[ ]'], ['Text size', 'Ctrl + / −'], ['Open script', 'Ctrl+O'],
    ['Paste script', 'Ctrl+V'], ['Edit script', 'Ctrl+E'], ['Reload script', 'Ctrl+R'], ['Settings', 'Ctrl+,'],
    ['Collapse', 'Esc'], ['Hide', 'H'], ['This help', '?'],
  ];
  const global = app.settings.globalShortcuts
    ? app.shortcuts.filter((a) => app.settings.shortcuts[a.id]).map((a) => [
      `${a.label} (anywhere)${app.shortcutStatus[a.id] === 'taken' ? ' — used by another app' : ''}`,
      app.settings.shortcuts[a.id]])
    : [];
  const grid = $('.help-grid');
  grid.replaceChildren(...rows.concat(global).map(([label, key]) => {
    const d = document.createElement('div');
    const l = document.createElement('span');
    l.textContent = label;
    const k = document.createElement('kbd');
    k.textContent = key;
    d.append(l, k);
    return d;
  }));
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function onKey(e) {
  if (e.target.closest?.('input, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if (!$('#help').hidden && (k === 'Escape' || k === '?' || k === 'F1')) { $('#help').hidden = true; return done(); }
  if (ctrl) {
    switch (k.toLowerCase()) {
      case 'o': api.openScriptDialog(); return done();
      case 'v': api.pasteScript(); return done();
      case 'e': api.openPanel('editor'); return done();
      case 'r': api.reloadScript(); return done();
      case ',': api.openPanel('settings'); return done();
      case '=': case '+': changeFontSize(2); return done();
      case '-': changeFontSize(-2); return done();
      default: return;
    }
  }
  switch (k) {
    case ' ': togglePlay(); return done();
    case 'm': case 'M': toggleVoiceMode(); return done();
    case 'ArrowDown': manualMove(() => view.nudgeLines(1)); return done();
    case 'ArrowUp': manualMove(() => view.nudgeLines(-1)); return done();
    case 'PageDown': manualMove(() => view.pageBy(1)); return done();
    case 'PageUp': manualMove(() => view.pageBy(-1)); return done();
    case 'Home': restart(); return done();
    case 'End': manualMove(() => view.jumpToWord(view.wordCount - 1)); return done();
    case ']': changeSpeed(1.12); return done();
    case '[': changeSpeed(1 / 1.12); return done();
    case 'Escape': setVisibility(app.visibility === 'expanded' ? 'compact' : app.visibility); return done();
    case 'Enter': setVisibility('expanded'); return done();
    case 'h': case 'H': setVisibility('hidden'); return done();
    case 'F5': api.reloadScript(); return done();
    case '?': case 'F1': buildHelp(); $('#help').hidden = false; setVisibility('expanded'); return done();
    default:
  }
}

function setupPointer() {
  document.addEventListener('mousemove', (e) => {
    island.pointer(e.clientX, e.clientY);
    if (island.inside) showControls();
  });
  document.addEventListener('mouseleave', () => island.pointerLeft());
  window.addEventListener('blur', () => island.pointerLeft());

  $('#compact').addEventListener('click', () => setVisibility('expanded'));
  $('#toast').addEventListener('click', () => { island.hideToast(); setVisibility('expanded'); });

  for (const btn of document.querySelectorAll('[data-action]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      actions[btn.dataset.action]?.();
    });
  }

  $('#viewport').addEventListener('wheel', (e) => {
    e.preventDefault();
    const lineH = view.lines[0]?.height || 40;
    const dy = e.deltaMode === 1 ? e.deltaY * lineH : e.deltaMode === 2 ? e.deltaY * view.viewportHeight : e.deltaY;
    manualMove(() => view.scrollByPixels(dy * 0.9 * app.settings.wheelSpeed));
  }, { passive: false });

  // Drag: vertical scrolls the script, horizontal slides the island along the edge.
  const vp = $('#viewport');
  let drag = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sx: e.screenX, axis: null, startOffset: view.offset.target };
    vp.setPointerCapture(e.pointerId);
    island.capture(true);
  });
  vp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.axis && Math.hypot(dx, dy) > 6) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') { api.drag('start', drag.sx); body.classList.add('dragging'); }
    }
    if (drag.axis === 'x') api.drag('move', e.screenX);
    else if (drag.axis === 'y') manualMove(() => view.scrollByPixels(drag.startOffset - dy - view.offset.target));
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (drag.axis === 'x') api.drag('end', e.screenX);
    body.classList.remove('dragging');
    drag = null;
    island.capture(false);
    island.pointer(e.clientX, e.clientY);
  };
  vp.addEventListener('pointerup', endDrag);
  vp.addEventListener('pointercancel', endDrag);
  vp.addEventListener('dblclick', () => setVisibility('compact'));

  // Resize from either bottom corner. The island stays centered, so the width
  // changes by twice the horizontal drag.
  let rs = null;
  for (const grip of document.querySelectorAll('.resize-grip')) {
    const sign = grip.dataset.corner === 'left' ? -1 : 1;
    const mark = document.querySelector(`.grip-mark[data-corner="${grip.dataset.corner}"]`);
    grip.addEventListener('pointerenter', () => mark.classList.add('hot'));
    grip.addEventListener('pointerleave', () => { if (rs?.grip !== grip) mark.classList.remove('hot'); });
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      island.capture(true);
      rs = { grip, sx: e.screenX, sy: e.screenY, w: island.size.w, h: island.size.h };
      api.setResizing(true);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!rs || rs.grip !== grip) return;
      const g = island.geo;
      const w = Math.round(Math.max(360, Math.min(g.maxWidth || 2400, rs.w + 2 * sign * (e.screenX - rs.sx))));
      const h = Math.round(Math.max(120, Math.min(g.maxHeight || 1400, rs.h + (e.screenY - rs.sy))));
      if (w === rs.nw && h === rs.nh) return;
      rs.nw = w; rs.nh = h;
      island.setExpandedSize(w, h);
      hint(`${w} × ${h}`, { ms: 900 });
    });
    const endResize = async () => {
      if (!rs || rs.grip !== grip) return;
      const { nw, nh } = rs;
      rs = null;
      if (!grip.matches(':hover')) mark.classList.remove('hot');
      island.capture(false);
      if (nw && nh) await api.updateSettings({ width: nw, height: nh });
      api.setResizing(false);
    };
    grip.addEventListener('pointerup', endResize);
    grip.addEventListener('pointercancel', endResize);
  }

  // Drop a file, or text highlighted in another app, anywhere on the island.
  document.addEventListener('dragover', (e) => {
    const kind = dropKind(e.dataTransfer);
    if (!kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!body.classList.contains('drop-target')) {
      $('#drop-overlay').textContent = kind === 'file' ? 'Drop to open this script' : 'Drop to use this text as your script';
      body.classList.add('drop-target');
    }
    if (app.visibility === 'compact') setVisibility('expanded');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) body.classList.remove('drop-target');
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    body.classList.remove('drop-target');
    const res = await openDropped(api, e.dataTransfer);
    if (res.message && !res.notified) toast(res.message, 'error');
  });

  $('#mic-meter').addEventListener('click', (e) => {
    e.stopPropagation();
    if (voice.running) stopVoice();
  });

  $('#empty-state').addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a) actions[a.dataset.action]?.();
  });
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  const initial = await api.initial();
  app.models = initial.models;
  app.shortcuts = initial.shortcuts;
  app.shortcutStatus = initial.shortcutStatus;
  app.speechStatus = initial.speech;
  applySettings(initial.settings);
  island.setGeometry(await api.geometry());
  island.setMode('hidden', { instant: true });
  setupPointer();
  window.addEventListener('keydown', onKey, true);

  new ResizeObserver(() => {
    view.relayout();
    refreshMarks();
  }).observe($('#viewport'));
  window.addEventListener('resize', () => island.render());
  document.fonts.addEventListener('loadingdone', () => relayoutWhenFontsReady());

  api.on('settings:changed', (s, changed) => applySettings(s, changed));
  api.on('script:loaded', (script) => loadScript(script));
  api.on('command', (name, arg) => command(name, arg));
  api.on('toast', ({ message, kind }) => toast(message, kind));
  api.on('window:geometry', (g) => island.setGeometry(g));
  api.on('shortcuts:status', (status) => { app.shortcutStatus = status; });
  api.on('speech:status', (status) => {
    app.speechStatus = status;
    if (status.state === 'error' && voice.running) onVoiceStatus('error', status.message, { kind: 'engine' });
  });
  api.on('speech:crashed', () => {
    if (voice.running) {
      hint('Restarting the speech engine…', { ms: 2500 });
      voice.reconnect();
    }
  });

  loadScript(initial.script);
  renderControls();

  // Emerge from the top edge.
  const start = initial.background && initial.settings.startState !== 'expanded'
    ? initial.settings.startState
    : (initial.settings.startState === 'compact' ? 'compact' : 'expanded');
  if (start !== 'hidden') {
    requestAnimationFrame(() => setTimeout(() => setVisibility(start), 120));
  }
  if (initial.firstRun) setTimeout(() => hint('Hover here for controls · press ? for shortcuts', { ms: 5000 }), 1600);
  window.__yalti = { app, view, tracker, island, voice, command, onSpeechResult, setVisibility };
}

init().catch((err) => {
  console.error(err);
  document.body.textContent = `YALTI Prompter failed to start: ${err.message}`;
});
