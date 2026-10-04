import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, DARK_INK, inkFor, LIGHT_INK, luminance, STATUS } from '../../src/core/contrast.js';

test('luminance and contrast follow WCAG', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.01);
});

test('dark islands get light controls, light islands dark ones', () => {
  // The built-in themes (Settings → Colors).
  for (const bg of ['#000000', '#111114', '#0b0905']) assert.equal(inkFor(bg), 'light', bg);
  assert.equal(inkFor('#f6f1e7'), 'dark', 'Paper');
  // Custom colors.
  assert.equal(inkFor('#ffffff'), 'dark');
  assert.equal(inkFor('#ffd166'), 'dark', 'yellow');
  assert.equal(inkFor('#8ab4ff'), 'dark', 'light blue');
  assert.equal(inkFor('#1e3a8a'), 'light', 'navy');
  assert.equal(inkFor('#767676'), 'light', 'mid grey');
});

test('the controls and status colors stand out on both kinds of island', () => {
  // Paper (light) and Classic (dark): text-level contrast for the controls,
  // at least 3:1 (WCAG non-text contrast) for the status dots and meter.
  assert.ok(contrastRatio(DARK_INK, '#f6f1e7') >= 7);
  assert.ok(contrastRatio(LIGHT_INK, '#000000') >= 7);
  for (const c of Object.values(STATUS.dark)) assert.ok(contrastRatio(c, '#f6f1e7') >= 4.5, `${c} on Paper`);
  for (const c of Object.values(STATUS.light)) assert.ok(contrastRatio(c, '#000000') >= 4.5, `${c} on black`);
  // The lightest island that still gets dark ink is white; the darkest light-ink island is black.
  for (const c of Object.values(STATUS.dark)) assert.ok(contrastRatio(c, '#ffffff') >= 4.5, `${c} on white`);
});
