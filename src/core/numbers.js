// Converts digits in a script into the words a speech recognizer will emit,
// so that "2024" in the script can match "twenty twenty four" in speech.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

const ORDINAL_IRREGULAR = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

function underHundred(n) {
  if (n < 20) return [ONES[n]];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? [TENS[t]] : [TENS[t], ONES[o]];
}

function underThousand(n) {
  const out = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) out.push(ONES[h], 'hundred');
  if (rest > 0) out.push(...underHundred(rest));
  return out;
}

/** Cardinal words for a non-negative integer. */
export function cardinal(n) {
  if (!Number.isFinite(n) || n < 0) return [];
  n = Math.floor(n);
  if (n === 0) return ['zero'];
  if (n >= 1e15) return String(n).split('').map((d) => ONES[Number(d)]);
  const out = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      out.push(...underThousand(Math.floor(rest / value)), name);
      rest %= value;
    }
  }
  if (rest > 0) out.push(...underThousand(rest));
  return out;
}

/** Year-style reading: 1999 -> nineteen ninety nine, 2024 -> twenty twenty four. */
export function yearWords(n) {
  if (n >= 2000 && n <= 2009) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return [...underHundred(hi), 'hundred'];
  if (lo < 10) return [...underHundred(hi), 'oh', ONES[lo]];
  return [...underHundred(hi), ...underHundred(lo)];
}

export function ordinal(n) {
  const words = cardinal(n);
  const last = words[words.length - 1];
  let ord;
  if (ORDINAL_IRREGULAR[last]) ord = ORDINAL_IRREGULAR[last];
  else if (last.endsWith('y')) ord = last.slice(0, -1) + 'ieth';
  else ord = last + 'th';
  words[words.length - 1] = ord;
  return words;
}

function pluralize(words) {
  const last = words[words.length - 1];
  words[words.length - 1] = last.endsWith('y') ? last.slice(0, -1) + 'ies' : last + 's';
  return words;
}

const NUMERIC = /^(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|st|nd|rd|th|s|k|m|bn)?$/i;

/**
 * Expand a single numeric token (already lower-cased, punctuation trimmed) into
 * spoken words. Returns null if the token is not numeric.
 */
export function numberToWords(token) {
  const m = NUMERIC.exec(token);
  if (!m) return null;
  const [, currency, intPart, frac, suffixRaw] = m;
  const suffix = (suffixRaw || '').toLowerCase();
  const digits = intPart.replace(/,/g, '');
  const n = Number(digits);
  let words;

  if (suffix === 'st' || suffix === 'nd' || suffix === 'rd' || suffix === 'th') {
    words = ordinal(n);
  } else if (suffix === 's' && !frac && digits.length === 4) {
    // 1990s -> nineteen nineties
    words = pluralize(yearWords(n));
  } else if (!currency && !frac && !suffix && digits.length === 4 && !intPart.includes(',') && n >= 1100 && n <= 2099) {
    words = yearWords(n);
  } else if (digits.length > 1 && digits.startsWith('0')) {
    // Codes such as 007 are read digit by digit.
    words = digits.split('').map((d) => (d === '0' ? 'oh' : ONES[Number(d)]));
  } else {
    words = cardinal(n);
  }

  if (frac) {
    words.push('point', ...frac.split('').map((d) => ONES[Number(d)]));
  }
  if (suffix === '%') words.push('percent');
  else if (suffix === 'k') words.push('thousand');
  else if (suffix === 'm') words.push('million');
  else if (suffix === 'bn') words.push('billion');
  if (currency === '$') words.push(n === 1 && !frac ? 'dollar' : 'dollars');
  else if (currency === '€') words.push('euros');
  else if (currency === '£') words.push(n === 1 && !frac ? 'pound' : 'pounds');
  return words;
}
