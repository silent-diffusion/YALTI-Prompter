// A deterministic "noisy recognizer" for exercising the tracker without audio.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OFF_SCRIPT = `so anyway before I go on let me tell you a quick story about my dog who once
ate an entire birthday cake while we were at the beach and honestly it was the funniest thing I have
ever seen he looked so proud of himself and my sister could not stop laughing for the rest of the
afternoon which reminds me that I should call her this weekend about the holiday plans`.split(/\s+/);

const VOWELS = 'aeiou';

/** Corrupt a word the way a recognizer might. */
function mutate(word, r) {
  if (word.length > 4 && r() < 0.5) {
    const i = 1 + Math.floor(r() * (word.length - 2));
    if (VOWELS.includes(word[i])) {
      return word.slice(0, i) + VOWELS[Math.floor(r() * 5)] + word.slice(i + 1);
    }
  }
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return OFF_SCRIPT[Math.floor(r() * OFF_SCRIPT.length)];
}

/**
 * Build a spoken stream from a plan.
 * plan items: { from, to } read script tokens [from, to); { off: n } speak n off-script words;
 * { words: [...] } speak given words with no truth.
 */
export function speak(tokens, plan, { seed = 7, sub = 0.08, del = 0.05, ins = 0.03 } = {}) {
  const r = rng(seed);
  const out = [];
  for (const step of plan) {
    if (step.off) {
      const start = Math.floor(r() * OFF_SCRIPT.length);
      for (let k = 0; k < step.off; k++) out.push({ w: OFF_SCRIPT[(start + k) % OFF_SCRIPT.length], truth: -1 });
      continue;
    }
    if (step.words) {
      for (const w of step.words) out.push({ w, truth: -1 });
      continue;
    }
    for (let j = step.from; j < step.to; j++) {
      const t = tokens[j].t;
      const x = r();
      if (step.clean) out.push({ w: t, truth: j });
      else if (x < del) continue;
      else if (x < del + sub) out.push({ w: mutate(t, r), truth: j });
      else out.push({ w: t, truth: j });
      if (!step.clean && r() < ins) out.push({ w: OFF_SCRIPT[Math.floor(r() * OFF_SCRIPT.length)], truth: -2 });
    }
  }
  return out;
}

/**
 * Feed a spoken stream to a tracker word by word, the way streaming partial
 * results arrive, finalizing a segment every `segment` words.
 * Returns per-word trace entries { truth, lastTruth, position, state }.
 */
export function feed(tracker, stream, { segment = 9 } = {}) {
  const trace = [];
  let seg = [];
  let lastTruth = -1;
  stream.forEach((item, idx) => {
    seg.push(item.w);
    if (item.truth >= 0) lastTruth = item.truth;
    const final = seg.length >= segment || idx === stream.length - 1;
    const res = tracker.pushResult(seg.join(' ').toUpperCase(), final);
    if (final) seg = [];
    trace.push({ i: idx, word: item.w, truth: item.truth, lastTruth, position: res.position, state: res.state, jumped: res.jumped });
  });
  return trace;
}
