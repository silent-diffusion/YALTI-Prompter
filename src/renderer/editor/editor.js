// Script editor. Changes flow to the prompter as you type (keeping your place);
// Save writes the file. Pasted or new scripts live inside YALTI until saved.

import { icon } from '../shared/icons.js';
import { countWords, describeDuration, SPEAKING_WPM } from '../../core/text.js';

const api = window.yalti;
const $ = (id) => document.getElementById(id);
const text = $('text');
let script = null;
let savedText = '';
let live = true;
let applyTimer = null;
let applying = false;

function setButton(id, iconName, label) {
  $(id).innerHTML = icon(iconName, 15);
  $(id).append(label);
}

function stats() {
  const words = countWords(text.value);
  $('stats').textContent = `${words.toLocaleString()} words · ${describeDuration(words / SPEAKING_WPM)} to read aloud`;
}

function dirty() {
  return text.value !== savedText;
}

function paintTitle() {
  $('doc-title').textContent = script?.fileName || script?.title || 'New script';
  const state = $('doc-state');
  if (!script || script.kind !== 'file') {
    state.textContent = script?.kind === 'sample' ? 'Built-in welcome script — Save as to keep a copy' : 'Not saved to a file yet';
    state.classList.toggle('dirty', false);
  } else {
    state.textContent = dirty() ? '● Unsaved changes' : script.path;
    state.classList.toggle('dirty', dirty());
  }
}

function load(s, { force = false } = {}) {
  if (!force && dirty() && script && s && s.path === script.path) return; // keep the user's edits
  script = s;
  savedText = s?.text ?? '';
  text.value = savedText;
  stats();
  paintTitle();
}

function scheduleApply() {
  stats();
  paintTitle();
  if (!live) return;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    applying = true;
    try { await api.applyScript(text.value); } finally { applying = false; }
  }, 450);
}

async function save(saveAs = false) {
  const forceAs = saveAs || !script || script.kind !== 'file';
  const result = await api.saveScript(text.value, forceAs);
  if (result) {
    script = result;
    savedText = text.value;
    paintTitle();
  }
}

async function init() {
  setButton('btn-new', 'file-plus', 'New');
  setButton('btn-open', 'folder-open', 'Open');
  setButton('btn-save', 'save', 'Save');
  setButton('btn-saveas', 'save', 'Save as');
  load(await api.currentScript(), { force: true });

  text.addEventListener('input', scheduleApply);
  $('btn-new').addEventListener('click', () => {
    if (dirty() && !window.confirm('Discard unsaved changes and start a new script?')) return;
    script = { kind: 'scratch', title: 'New script' };
    savedText = '';
    text.value = '';
    stats();
    paintTitle();
    text.focus();
  });
  $('btn-open').addEventListener('click', () => api.openScriptDialog());
  $('btn-save').addEventListener('click', () => save(false));
  $('btn-saveas').addEventListener('click', () => save(true));
  $('live').addEventListener('click', () => {
    live = !live;
    $('live').setAttribute('aria-checked', String(live));
    if (live) scheduleApply();
  });

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); api.openScriptDialog(); }
    else if (k === 'n') { e.preventDefault(); $('btn-new').click(); }
  });

  // Another script was opened (or the file changed on disk).
  api.on('script:loaded', (s) => {
    if (applying || s.unsaved) return;
    if (script && s.kind === 'scratch' && script.kind !== 'file') { script = s; paintTitle(); return; }
    load(s);
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty() && script?.kind === 'file') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  text.setSelectionRange(0, 0);
  text.focus();
  text.scrollTop = 0;
}

init();
