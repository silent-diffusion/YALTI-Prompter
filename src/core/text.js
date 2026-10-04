// Text normalization shared by the script view and the speech tracker.
// Script words and recognized words are reduced to the same canonical form so
// they can be compared: lower case, no accents, no punctuation, digits spelled out.

import { numberToWords } from './numbers.js';

const SYMBOL_WORDS = { '&': 'and', '+': 'plus', '@': 'at', '=': 'equals', '%': 'percent' };

// Very common words carry little information about *where* in a script someone is.
export const STOPWORDS = new Set(`a an the and or but nor so yet of to in on at by for from with
as into onto about over under than then that this these those there here it its it's is are was
were be been being am do does did done have has had having i me my mine we us our ours you your
yours he him his she her hers they them their theirs what which who whom whose when where why how
not no yes if will would can could shall should may might must just also too very really
oh um uh ah er hmm mm okay ok well like`.split(/\s+/).map((w) => w.replace(/'/g, '')));

// Words a speaker inserts that never appear in a script.
export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm', 'eh']);

/**
 * Normalize one whitespace-delimited chunk of text into zero or more tokens.
 * "Don't" -> ["dont"], "well-known" -> ["well", "known"], "2024" -> ["twenty", "twenty", "four"].
 * @param {string} raw
 * @returns {string[]}
 */
export function normalizeChunk(raw) {
  if (!raw) return [];
  let s = raw.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  s = s.replace(/[‘’ʼ`´]/g, "'").replace(/[–—―]/g, ' ');

  const out = [];
  // Split on anything that is not a letter, digit, apostrophe or number punctuation.
  for (let part of s.split(/[^\p{L}\p{N}'$€£%.,&+@=]+/u)) {
    if (!part) continue;
    // Trim punctuation at the edges but keep inner number punctuation (1,000.50).
    part = part.replace(/^[',.]+|[',.]+$/g, '');
    if (!part) continue;
    if (SYMBOL_WORDS[part]) { out.push(SYMBOL_WORDS[part]); continue; }

    const num = numberToWords(part);
    if (num) { out.push(...num); continue; }

    // Mixed alphanumerics such as "mp3" or "covid-19" are split into runs.
    for (const piece of part.split(/[.,&+@=%$€£]+/)) {
      if (!piece) continue;
      const runs = piece.match(/\p{L}[\p{L}']*|\p{N}+/gu) || [];
      for (const run of runs) {
        if (/^\p{N}+$/u.test(run)) {
          out.push(...(numberToWords(run) || []));
        } else {
          const w = run.replace(/'/g, '');
          if (w) out.push(w);
        }
      }
    }
  }
  return out;
}

/** Normalize a whole phrase (e.g. a recognizer result) into tokens. */
export function normalizePhrase(text) {
  if (!text) return [];
  const out = [];
  for (const chunk of text.split(/\s+/)) {
    for (const t of normalizeChunk(chunk)) out.push(t);
  }
  return out;
}

/**
 * A compact "sounds-like" key, loosely based on Metaphone. Two words with the
 * same key are likely confusions for a speech recognizer (their/there, invoice/envoice).
 */
export function phoneticKey(word) {
  if (!word) return '';
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return word;
  w = w
    .replace(/^kn|^gn|^pn|^wr|^ps/, (m) => m[1])
    .replace(/^x/, 's')
    .replace(/^wh/, 'w')
    .replace(/mb$/, 'm')
    .replace(/tch/g, 'ch')
    .replace(/sch/g, 'sk')
    .replace(/ph/g, 'f')
    .replace(/gh(?=[^aeiou]|$)/g, '')
    .replace(/ck/g, 'k')
    .replace(/dg(?=[eiy])/g, 'j')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'f')
    .replace(/th/g, '0')
    .replace(/sh/g, 'x')
    .replace(/ch/g, 'x')
    .replace(/(?<=.)[aeiouyw]+/g, '')
    .replace(/^[aeiouyw]+/, 'a')
    .replace(/(.)\1+/g, '$1');
  // Plural / tense endings are frequently dropped or added by recognizers.
  if (w.length > 3) w = w.replace(/s$/, '');
  return w;
}

/** Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/**
 * Similarity between a recognized word and a script word in [0, 1].
 * @param {string} spoken normalized spoken token
 * @param {string} script normalized script token
 * @param {string} [spokenKey] phonetic key of spoken (optional cache)
 * @param {string} [scriptKey] phonetic key of script (optional cache)
 */
export function wordSimilarity(spoken, script, spokenKey, scriptKey) {
  if (spoken === script) return 1;
  const ls = spoken.length;
  const lt = script.length;
  const sk = spokenKey ?? phoneticKey(spoken);
  const tk = scriptKey ?? phoneticKey(script);
  if (sk && sk === tk && Math.min(ls, lt) >= 2) {
    return sk.length >= 3 ? 0.85 : 0.7;
  }
  const maxLen = Math.max(ls, lt);
  if (maxLen >= 4) {
    const d = editDistance(spoken, script, Math.floor(maxLen * 0.4));
    const ratio = 1 - d / maxLen;
    if (ratio >= 0.7) return 0.75 * ratio;
  }
  // Plural/possessive or tense variants: "team" vs "teams", "move" vs "moved".
  const minLen = Math.min(ls, lt);
  if (minLen >= 4 && (script.startsWith(spoken) || spoken.startsWith(script)) && maxLen - minLen <= 3) {
    return 0.6;
  }
  return 0;
}

/** Natural speaking rate used for time estimates (words per minute). */
export const SPEAKING_WPM = 140;

/** A friendly duration for time estimates: "under a minute", "about 4 min", "about 1 h 15 min". */
export function describeDuration(minutes) {
  if (!(minutes >= 1)) return 'under a minute';
  const total = Math.round(minutes);
  if (total < 60) return `about ${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `about ${h} h${m ? ` ${m} min` : ''}`;
}

export function countWords(text) {
  if (!text) return 0;
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
