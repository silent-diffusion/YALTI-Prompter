import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferJumpBack, jumpSnippet } from '../../src/core/jump-back.js';

const VIEW = 250; // px, the default island height
const base = { fromWord: 100, viewportHeight: VIEW, jumped: false };

test('ordinary reading never offers a jump back', () => {
  // Next word, next line, or a short hop within the same couple of lines.
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 101, lineDelta: 0, fromY: 75 }), false);
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 108, lineDelta: 1, fromY: 27 }), false);
  // Even a tracker relocation of a single line is not worth undoing.
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 109, lineDelta: 1, fromY: 27, jumped: true }), false);
  // Two lines down a list of very short lines is still only a few words.
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 104, lineDelta: 2, fromY: -20, jumped: true }), false);
});

test('a short skip is offered only once the old place has left the screen', () => {
  // Big island: two lines up is still visible.
  assert.equal(shouldOfferJumpBack({ ...base, viewportHeight: 600, toWord: 118, lineDelta: 2, fromY: 90 }), false);
  // Default island: two lines up has scrolled into the top fade.
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 118, lineDelta: 2, fromY: -21 }), true);
  // Going back two lines pushes the old place below the bottom edge.
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 82, lineDelta: -2, fromY: 245 }), true);
});

test('tracker relocations and long moves are always offered', () => {
  assert.equal(shouldOfferJumpBack({ ...base, viewportHeight: 900, toWord: 120, lineDelta: 2, fromY: 200, jumped: true }), true);
  assert.equal(shouldOfferJumpBack({ ...base, viewportHeight: 900, toWord: 140, lineDelta: 4, fromY: 120 }), true);
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 2600, lineDelta: 310, fromY: -14000, jumped: true }), true);
  assert.equal(shouldOfferJumpBack({ ...base, toWord: 3, lineDelta: -12, fromY: 650, jumped: true }), true);
});

test('nothing to go back to before the first position', () => {
  assert.equal(shouldOfferJumpBack({ ...base, fromWord: -1, toWord: 400, lineDelta: 40, fromY: -900, jumped: true }), false);
});

test('jump snippet shows the first words of the place, without cues', () => {
  const words = 'Thank you all [smile] for being here today, everyone.'.split(' ').map((text) => ({ text, cue: text.startsWith('[') }));
  assert.equal(jumpSnippet(words, 0), 'Thank you all for being…');
  assert.equal(jumpSnippet(words, 6), 'here today, everyone');
  assert.equal(jumpSnippet(words, 7, { maxWords: 1 }), 'today…');
  assert.equal(jumpSnippet(words, 99), '');
  const long = [{ text: 'Supercalifragilisticexpialidocious-ly' }, { text: 'speaking' }];
  assert.equal(jumpSnippet(long, 0), 'Supercalifragilisticexpialidocious-ly…');
});
