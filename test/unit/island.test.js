import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandPath, hitIsland } from '../../src/core/island-shape.js';
import { Spring } from '../../src/core/spring.js';
import { applyPatch, sanitize, DEFAULTS, cleanValue } from '../../src/core/settings-schema.js';

test('island path is empty when retracted', () => {
  assert.equal(islandPath({ cx: 100, w: 120, h: 0, r: 20 }), '');
  assert.equal(islandPath({ cx: 100, w: 0, h: 50, r: 20 }), '');
});

test('liquid island has shoulders that flare into the top edge', () => {
  const d = islandPath({ cx: 400, top: 0, w: 600, h: 200, r: 28, s: 16, style: 'liquid' });
  assert.ok(d.startsWith('M84,-2'), d.slice(0, 20)); // xl - s = 100 - 16
  assert.ok(d.includes('716,-2'), 'right shoulder reaches past the body');
  assert.ok(!/NaN/.test(d));
});

test('flush and floating styles', () => {
  const flush = islandPath({ cx: 400, w: 600, h: 200, r: 28, s: 16, style: 'flush' });
  assert.ok(flush.startsWith('M100,-2'));
  const floating = islandPath({ cx: 400, top: 10, w: 600, h: 200, r: 28, style: 'floating' });
  assert.ok(floating.startsWith('M'));
  assert.ok(floating.endsWith('Z'));
  assert.ok(!floating.includes('-2'), 'floating island does not touch the edge');
});

test('bulges add curves without NaN', () => {
  const d = islandPath({ cx: 400, w: 600, h: 200, r: 28, s: 16, bulgeX: 4, bulgeY: -6 });
  assert.ok(!/NaN/.test(d));
  assert.ok((d.match(/C/g) || []).length >= 7);
});

test('tiny heights stay valid (pill emerging from the edge)', () => {
  for (const h of [1, 3, 8, 20]) {
    const d = islandPath({ cx: 100, w: 160, h, r: 18, s: 14 });
    assert.ok(d && !/NaN/.test(d), `h=${h}`);
  }
});

test('hit testing', () => {
  const g = { cx: 400, top: 0, w: 600, h: 200 };
  assert.ok(hitIsland(g, 400, 100));
  assert.ok(!hitIsland(g, 50, 100));
  assert.ok(!hitIsland(g, 400, 260));
  assert.ok(hitIsland(g, 705, 100, 8));
});

test('springs settle on their target', () => {
  const s = new Spring(0, { stiffness: 220, damping: 26 });
  s.setTarget(100);
  let t = 0;
  while (!s.done && t < 5) { s.step(1 / 60); t += 1 / 60; }
  assert.ok(s.done, 'settles');
  assert.ok(t < 1.5, `settled in ${t.toFixed(2)}s`);
  assert.equal(s.value, 100);
});

test('settings are validated and clamped', () => {
  const s = sanitize({ fontSize: 999, textColor: 'red', textAlign: 'center', bogus: 1, alwaysOnTop: 'yes' });
  assert.equal(s.fontSize, 120);
  assert.equal(s.textColor, DEFAULTS.textColor);
  assert.equal(s.textAlign, 'center');
  assert.equal(s.alwaysOnTop, DEFAULTS.alwaysOnTop);
  assert.ok(!('bogus' in s));
  const { changed } = applyPatch(s, { fontSize: 40, lineHeight: 1.42 });
  assert.deepEqual(changed, ['fontSize']);
  assert.equal(cleanValue('highlightColor', '#ABCDEF'), '#abcdef');
  assert.equal(sanitize(null).fontId, 'inter');
  assert.equal(sanitize({ shortcuts: { playPause: 'F9' } }).shortcuts.playPause, 'F9');
  assert.equal(sanitize({ shortcuts: { playPause: 'F9' } }).shortcuts.toggleVisible, 'Ctrl+Alt+Y');
});
