// The script document model: blocks of styled runs are split into display words,
// and each display word is mapped to zero or more normalized tracking tokens.

import { normalizeChunk, phoneticKey, STOPWORDS } from './text.js';

/**
 * @typedef {{ text: string, bold?: boolean, italic?: boolean, code?: boolean, strike?: boolean, cue?: boolean, br?: boolean }} Run
 * @typedef {{ type: 'heading'|'paragraph'|'list-item'|'quote'|'code'|'rule', level?: number, ordered?: boolean, number?: number, depth?: number, runs?: Run[] }} Block
 * @typedef {{ text: string, block: number, run: number, cue: boolean, tokenStart: number, tokenEnd: number, spaceBefore: boolean, br: boolean }} Word
 * @typedef {{ t: string, key: string, word: number, w: number }} Token
 */

const CUE_RE = /\[[^\]\n]{1,80}\]/g;

/**
 * Split runs so that [bracketed stage directions] become separate cue runs.
 * Cues are shown, muted, but never tracked against speech.
 * @param {Run[]} runs
 */
export function splitCues(runs) {
  const out = [];
  for (const run of runs) {
    if (run.br || run.cue || run.code || !run.text.includes('[')) { out.push(run); continue; }
    let last = 0;
    for (const m of run.text.matchAll(CUE_RE)) {
      if (m.index > last) out.push({ ...run, text: run.text.slice(last, m.index) });
      out.push({ ...run, text: m[0], cue: true });
      last = m.index + m[0].length;
    }
    if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) });
  }
  return out;
}

/**
 * Build the word/token model from parsed blocks.
 * @param {Block[]} blocks
 */
export function buildModel(blocks) {
  /** @type {Word[]} */
  const words = [];
  /** @type {Token[]} */
  const tokens = [];
  const blockRanges = [];
  blocks = blocks.map((b) => (b.runs && b.type !== 'code' ? { ...b, runs: splitCues(b.runs) } : b));

  blocks.forEach((block, bi) => {
    const firstWord = words.length;
    if (block.type !== 'rule') {
      const runs = block.runs || [];
      let pendingSpace = false;
      runs.forEach((run, ri) => {
        if (run.br) {
          if (words.length > firstWord) words[words.length - 1].br = true;
          pendingSpace = false;
          return;
        }
        const parts = run.text.split(/(\s+)/);
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { pendingSpace = true; continue; }
          const wi = words.length;
          const tokenStart = tokens.length;
          if (!run.cue) {
            for (const t of normalizeChunk(part)) {
              tokens.push({ t, key: phoneticKey(t), word: wi, w: 1 });
            }
          }
          words.push({
            text: part,
            block: bi,
            run: ri,
            cue: !!run.cue,
            tokenStart,
            tokenEnd: tokens.length,
            spaceBefore: pendingSpace && wi > firstWord,
            br: false,
          });
          pendingSpace = false;
        }
      });
    }
    blockRanges.push({ firstWord, lastWord: words.length - 1 });
  });

  assignWeights(tokens);
  return { blocks, words, tokens, blockRanges };
}

/**
 * Weight tokens by how informative they are: function words count less, and
 * words that repeat throughout the script say less about where the reader is.
 * @param {Token[]} tokens
 */
export function assignWeights(tokens) {
  const df = new Map();
  for (const tok of tokens) df.set(tok.t, (df.get(tok.t) || 0) + 1);
  for (const tok of tokens) {
    if (STOPWORDS.has(tok.t) || tok.t.length <= 1) {
      tok.w = 0.3;
    } else {
      const n = df.get(tok.t);
      tok.w = Math.max(0.5, 1 / (1 + 0.12 * (n - 1)));
    }
  }
}

/** Plain text of the model, useful for stats and tests. */
export function modelText(model) {
  return model.words.map((w) => w.text).join(' ');
}
