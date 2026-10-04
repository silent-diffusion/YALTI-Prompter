// When to offer "jump back" after voice tracking moves the reading position.
//
// Ordinary reading moves a word or a line at a time and never needs undoing;
// a hop to the next line is visible anyway. A bigger move might be a mistake
// (or the reader may want to return after a digression), so it is offered
// when the tracker relocated on its own, when the move was long, or when the
// old place has left the screen and can't simply be found again by eye.

/** Moves shorter than this (in lines or words) are never offered. */
export const MIN_LINES = 2;
export const MIN_WORDS = 6;
/** Moves at least this many lines are always offered. */
export const ALWAYS_LINES = 4;
/** The part of the viewport where text still counts as "on screen" (the rest fades out). */
const VISIBLE_TOP = 0.12;
const VISIBLE_BOTTOM = 0.88;

/**
 * @param {object} m
 * @param {number} m.fromWord        word on the reading line before the move
 * @param {number} m.toWord          word on the reading line after the move
 * @param {number} m.lineDelta       lines moved (negative = backwards)
 * @param {number} m.fromY           where the old reading line is after the move, px from the viewport top
 * @param {number} m.viewportHeight  px
 * @param {boolean} [m.jumped]       the tracker relocated rather than following nearby speech
 */
export function shouldOfferJumpBack({ fromWord, toWord, lineDelta, fromY, viewportHeight, jumped = false }) {
  const lines = Math.abs(lineDelta);
  if (!(fromWord >= 0) || lines < MIN_LINES || Math.abs(toWord - fromWord) < MIN_WORDS) return false;
  if (jumped || lines >= ALWAYS_LINES) return true;
  const onScreen = fromY >= viewportHeight * VISIBLE_TOP && fromY <= viewportHeight * VISIBLE_BOTTOM;
  return !onScreen;
}

/** A few words of the place to go back to, for the button label. */
export function jumpSnippet(words, from, { maxWords = 5, maxChars = 34 } = {}) {
  const out = [];
  let chars = 0;
  let i = Math.max(0, from);
  for (; i < words.length && out.length < maxWords; i++) {
    if (words[i].cue) continue;
    const w = words[i].text;
    if (out.length && chars + 1 + w.length > maxChars) break;
    out.push(w);
    chars += (out.length > 1 ? 1 : 0) + w.length;
  }
  const text = out.join(' ').replace(/[\s,;:.!?–—-]+$/u, '');
  return text ? `${text}${i < words.length ? '…' : ''}` : '';
}
