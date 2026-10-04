// Renders the script and moves it. Words are individual spans so the reading
// position can be highlighted precisely; scrolling is a GPU transform driven by
// a critically damped spring (or a constant speed in auto-scroll).

import { Spring } from '../../core/spring.js';

const NORMAL = 0, READ = 1, SPOKEN = 2, NOW = 3;
const CLASS = ['w', 'w read', 'w spoken', 'w now'];

export class ScriptView {
  constructor({ viewport, column, marker }) {
    this.viewport = viewport;
    this.column = column;
    this.marker = marker;
    this.model = null;
    this.wordEls = [];
    this.baseClass = [];
    this.states = new Uint8Array(0);
    this.lines = [];
    this.wordLine = new Int32Array(0);
    this.readingLine = 0.3;
    this.mirror = false;
    this.offset = new Spring(0, { stiffness: 150, damping: 24.5, precision: 0.2 });
    this.autoSpeed = 0; // px per second while auto-scrolling
    this.marks = { readBefore: 0, spokenFrom: -1, now: -1 };
    this.anchorWord = 0; // word the view is anchored to across relayouts
    this.viewportHeight = 0;
    this.lastTransform = '';
  }

  get wordCount() { return this.wordEls.length; }

  setSmoothness(s) {
    const k = 280 - 220 * s;
    this.offset.stiffness = k;
    this.offset.damping = 2 * Math.sqrt(k);
  }

  /** Build the DOM for a script model (see core/document.js). */
  setModel(model) {
    this.model = model;
    const frag = document.createDocumentFragment();
    const els = new Array(model.words.length);
    const base = new Array(model.words.length);
    let w = 0;
    model.blocks.forEach((block, bi) => {
      const div = document.createElement('div');
      div.className = `blk ${blockClass(block)}`;
      if (block.type === 'list-item') {
        div.dataset.marker = block.ordered ? `${block.number}.` : '•';
        div.classList.add(`depth-${Math.min(2, block.depth || 0)}`);
      }
      while (w < model.words.length && model.words[w].block === bi) {
        const word = model.words[w];
        const run = block.runs[word.run] || {};
        if (word.spaceBefore) div.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        let cls = '';
        if (run.bold) cls += ' b';
        if (run.italic) cls += ' i';
        if (run.strike) cls += ' s';
        if (run.code) cls += ' c';
        if (word.cue) cls += ' cue';
        span.className = 'w' + cls;
        span.textContent = word.text;
        div.appendChild(span);
        if (word.br) div.appendChild(document.createElement('br'));
        els[w] = span;
        base[w] = cls;
        w++;
      }
      frag.appendChild(div);
    });
    this.column.replaceChildren(frag);
    this.wordEls = els;
    this.baseClass = base;
    this.states = new Uint8Array(els.length);
    this.marks = { readBefore: 0, spokenFrom: -1, now: -1 };
    this.anchorWord = 0;
    this.relayout();
  }

  /** Measure line positions. Call after any change of font, size or width. */
  relayout() {
    this.viewportHeight = this.viewport.clientHeight;
    const els = this.wordEls;
    const n = els.length;
    const lines = [];
    const wordLine = new Int32Array(n);
    let cur = null;
    for (let i = 0; i < n; i++) {
      const el = els[i];
      const top = el.offsetTop;
      const h = el.offsetHeight;
      if (!cur || top > cur.top + cur.height * 0.5) {
        cur = { top, height: h, first: i, last: i };
        lines.push(cur);
      } else {
        cur.last = i;
        if (h > cur.height) cur.height = h;
      }
      wordLine[i] = lines.length - 1;
    }
    for (const l of lines) l.center = l.top + l.height / 2;
    this.lines = lines;
    this.wordLine = wordLine;
    this._placeMarker();
    // Keep the same word under the reading line after reflow.
    this.jumpToWord(this.anchorWord, { instant: true });
  }

  setReadingLine(fraction) {
    this.readingLine = fraction;
    this.viewport.style.setProperty('--fade-top', `${Math.round(fraction * 45)}%`);
    this._placeMarker();
    this.render();
  }

  setMirror(on) {
    this.mirror = on;
    this.lastTransform = '';
    this.render();
  }

  _placeMarker() {
    this.marker.style.top = `${this.readingY}px`;
  }

  get readingY() {
    return Math.round((this.viewportHeight || this.viewport.clientHeight) * this.readingLine);
  }

  get minOffset() { return this.lines.length ? this.lines[0].center : 0; }
  get maxOffset() { return this.lines.length ? this.lines[this.lines.length - 1].center : 0; }

  lineOfWord(i) {
    if (!this.lines.length) return null;
    return this.lines[this.wordLine[Math.max(0, Math.min(this.wordCount - 1, i))]];
  }

  /** Index of the word on the line currently under the reading line. */
  wordAtReadingLine() {
    const lines = this.lines;
    if (!lines.length) return 0;
    const y = this.offset.value;
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].top <= y) lo = mid; else hi = mid - 1;
    }
    return lines[lo].first;
  }

  /** Put the line containing word `i` on the reading line. */
  jumpToWord(i, { instant = false } = {}) {
    const line = this.lineOfWord(i);
    this.anchorWord = Math.max(0, Math.min(this.wordCount - 1, i));
    if (!line) return;
    if (instant) this.offset.snap(line.center);
    else this.offset.setTarget(line.center);
    this.render();
  }

  scrollByPixels(dy) {
    const t = clamp(this.offset.target + dy, this.minOffset, this.maxOffset);
    this.offset.setTarget(t);
    this.anchorWord = this.wordAtTarget();
  }

  wordAtTarget() {
    const save = this.offset.value;
    this.offset.value = this.offset.target;
    const w = this.wordAtReadingLine();
    this.offset.value = save;
    return w;
  }

  /** Move by whole lines (positive = forward). */
  nudgeLines(n) {
    if (!this.lines.length) return;
    const li = this.wordLine[this.wordAtTarget()];
    const next = clamp(li + n, 0, this.lines.length - 1);
    this.anchorWord = this.lines[next].first;
    this.offset.setTarget(this.lines[next].center);
  }

  pageBy(n) {
    const lineH = this.lines[0]?.height || 40;
    const perPage = Math.max(1, Math.floor((this.viewportHeight * (1 - this.readingLine)) / (lineH * 1.2)) - 1);
    this.nudgeLines(n * perPage);
  }

  /** Advance one animation frame. Returns true while still moving. */
  frame(dt) {
    let moving = false;
    if (this.autoSpeed > 0) {
      const next = Math.min(this.maxOffset, this.offset.value + this.autoSpeed * dt);
      this.offset.snap(next);
      this.anchorWord = this.wordAtReadingLine();
      moving = next < this.maxOffset;
    } else {
      this.offset.step(dt);
      moving = !this.offset.done;
    }
    this.render();
    return moving;
  }

  render() {
    const y = Math.round((this.readingY - this.offset.value) * 2) / 2;
    const t = `translate3d(0, ${y}px, 0)${this.mirror ? ' scaleX(-1)' : ''}`;
    if (t !== this.lastTransform) {
      this.column.style.transform = t;
      this.lastTransform = t;
    }
  }

  get atEnd() {
    return this.offset.value >= this.maxOffset - 0.5;
  }

  /**
   * Set reading marks. Words before `readBefore` are read (dimmed), words in
   * [spokenFrom, now) are spoken, `now` is the word just said.
   */
  setMarks(readBefore, spokenFrom = -1, now = -1) {
    const prev = this.marks;
    const n = this.wordCount;
    if (!n) return;
    const lo = Math.max(0, Math.min(prev.readBefore, readBefore, prev.spokenFrom < 0 ? n : prev.spokenFrom, spokenFrom < 0 ? n : spokenFrom));
    const hi = Math.min(n - 1, Math.max(prev.readBefore, readBefore, prev.now, now));
    for (let i = lo; i <= hi; i++) {
      let s = NORMAL;
      if (i === now) s = NOW;
      else if (spokenFrom >= 0 && i >= spokenFrom && i < now) s = SPOKEN;
      else if (i < readBefore) s = READ;
      if (this.states[i] !== s) {
        this.states[i] = s;
        this.wordEls[i].className = CLASS[s] + this.baseClass[i];
      }
    }
    this.marks = { readBefore, spokenFrom, now };
  }

  /** Marks for "the reader is at word i" in voice mode. */
  markSpoken(i) {
    const line = this.lineOfWord(i);
    if (!line) return;
    this.setMarks(line.first, line.first, i);
  }

  /** Marks for auto/manual mode: everything above the reading line is read. */
  markReadingLine() {
    const i = this.wordAtReadingLine();
    this.setMarks(i, -1, -1);
  }

  clearMarks() {
    this.setMarks(0, -1, -1);
  }
}

function blockClass(b) {
  switch (b.type) {
    case 'heading': return `h${Math.min(6, b.level || 1)}`;
    case 'list-item': return 'li';
    case 'quote': return 'quote';
    case 'code': return 'code';
    case 'rule': return 'rule';
    default: return 'p';
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
