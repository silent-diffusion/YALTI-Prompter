// The microphone indicator: a small circle in the corner of the island with a
// live waveform, so you can see at a glance that YALTI hears you. It reads the
// microphone's frequency bands only while it is on screen.

import { icon } from '../shared/icons.js';

// Bars left to right, as voice bands (low to high), so the middle moves most.
const ORDER = [3, 1, 0, 2, 4];
const FRAME_MS = 33; // about 30 fps is plenty for a 30 px meter
const MIN_H = 3;
const MAX_H = 15;

export class MicMeter {
  /**
   * @param {HTMLElement} el
   * @param {{ bands: (out: Float32Array) => Float32Array }} source
   */
  constructor(el, source) {
    this.el = el;
    this.source = source;
    this.bands = new Float32Array(5);
    this.levels = new Float32Array(ORDER.length);
    this.bars = ORDER.map(() => {
      const bar = document.createElement('span');
      bar.className = 'bar';
      return bar;
    });
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.innerHTML = icon('mic', 15);
    el.replaceChildren(...this.bars, glyph);
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.levels.fill(0);
    for (const bar of this.bars) bar.style.height = `${MIN_H}px`;
    this.el.style.setProperty('--lvl', '0');
  }

  frame(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (t - this.last < FRAME_MS) return;
    this.last = t;
    this.source.bands(this.bands);
    const still = this.reduceMotion.matches;
    let peak = 0;
    for (let i = 0; i < ORDER.length; i++) {
      const target = Math.min(1, Math.pow(this.bands[ORDER[i]], 0.8) * 1.5);
      const prev = this.levels[i];
      // Quick to rise, slower to fall: reads as a voice, not as flicker.
      const v = target > prev ? prev + (target - prev) * 0.7 : prev + (target - prev) * 0.2;
      this.levels[i] = v;
      if (v > peak) peak = v;
      if (!still) this.bars[i].style.height = `${(MIN_H + (MAX_H - MIN_H) * v).toFixed(1)}px`;
    }
    this.el.style.setProperty('--lvl', peak.toFixed(3));
  }
}
