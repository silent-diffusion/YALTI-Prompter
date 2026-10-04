import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScript } from '../../src/main/script-parser.js';
import { buildModel } from '../../src/core/document.js';
import { SpeechTracker } from '../../src/core/tracker.js';
import { speak, feed } from '../helpers/simulate.js';

const source = readFileSync(new URL('../fixtures/keynote.md', import.meta.url), 'utf8');
const model = buildModel(parseScript(source, 'markdown'));
const T = model.tokens;

/** Token range [start, end) of the n-th paragraph block (0-based, headings excluded). */
function para(n) {
  const paras = model.blocks.map((b, i) => [b, i]).filter(([b]) => b.type === 'paragraph');
  const bi = paras[n][1];
  const r = model.blockRanges[bi];
  return [model.words[r.firstWord].tokenStart, model.words[r.lastWord].tokenEnd];
}

function lagStats(trace) {
  const lags = trace.filter((e) => e.truth >= 0).map((e) => e.lastTruth - e.position);
  lags.sort((a, b) => a - b);
  return { median: lags[Math.floor(lags.length / 2)], p90: lags[Math.floor(lags.length * 0.9)], minLag: lags[0] };
}

test('fixture has the expected shape', () => {
  assert.ok(T.length > 350, `tokens: ${T.length}`);
  assert.equal(model.blocks.filter((b) => b.type === 'paragraph').length, 8);
});

for (const seed of [1, 2, 3]) {
  test(`follows a straight read with recognizer noise (seed ${seed})`, () => {
    const tracker = new SpeechTracker(T);
    const trace = feed(tracker, speak(T, [{ from: 0, to: T.length }], { seed }));
    const { median, p90, minLag } = lagStats(trace);
    const final = trace[trace.length - 1].position;
    assert.ok(final >= T.length - 4, `final ${final} of ${T.length}`);
    assert.ok(median <= 2, `median lag ${median}`);
    assert.ok(p90 <= 6, `p90 lag ${p90}`);
    assert.ok(minLag >= -2, `ran ahead of the speaker by ${-minLag}`);
    assert.ok(!trace.some((e) => e.jumped && Math.abs(e.position - e.lastTruth) > 4), 'no wild jumps');
  });
}

/** Token ranges of the sentences in paragraph n. */
function sentences(n) {
  const [s, e] = para(n);
  const out = [];
  let start = s;
  for (let j = s; j < e; j++) {
    const word = model.words[T[j].word];
    const lastTokenOfWord = j === word.tokenEnd - 1;
    if (lastTokenOfWord && /[.!?]["”']?$/.test(word.text)) {
      out.push([start, j + 1]);
      start = j + 1;
    }
  }
  if (start < e) out.push([start, e]);
  return out;
}

test('skips a sentence and keeps following', () => {
  const [s1, s2, s3] = sentences(2);
  const tracker = new SpeechTracker(T);
  tracker.setPosition(s1[0] - 1);
  const trace = feed(tracker, speak(T, [{ from: s1[0], to: s1[1] }, { from: s3[0], to: s3[1] }], { seed: 4 }));
  const k = trace.findIndex((e) => e.truth >= s3[0]);
  const caught = trace.slice(k).find((e) => e.position >= s3[0]);
  assert.ok(s2[1] - s2[0] >= 10, 'skipped sentence is substantial');
  assert.ok(caught && caught.i - k <= 5, `caught up after ${caught ? caught.i - k : 'never'} words`);
  assert.ok(trace[trace.length - 1].position >= s3[1] - 3);
});

test('jumps far ahead after a confident match', () => {
  const [, p1e] = para(1);
  const [p7s, p7e] = para(6);
  const tracker = new SpeechTracker(T);
  const trace = feed(tracker, speak(T, [{ from: 0, to: p1e }, { from: p7s, to: p7e }], { seed: 5 }));
  const k = trace.findIndex((e) => e.truth >= p7s);
  const settled = trace.slice(k).find((e) => e.position >= p7s);
  assert.ok(settled, 'should reach the new paragraph');
  const wordsNeeded = settled.i - k;
  assert.ok(wordsNeeded <= 9, `took ${wordsNeeded} words to jump`);
});

test('holds still while off-script, then resumes', () => {
  const [p2s, p2e] = para(2);
  const leave = p2s + 25;
  const tracker = new SpeechTracker(T);
  const trace = feed(tracker, speak(T, [{ from: p2s, to: leave }, { off: 40 }, { from: leave, to: p2e }], { seed: 6 }));
  const firstOff = trace.findIndex((e) => e.truth === -1);
  const atLeave = trace[firstOff - 1].position;
  const offPart = trace.filter((e) => e.truth === -1);
  const maxDrift = Math.max(...offPart.map((e) => Math.abs(e.position - atLeave)));
  assert.ok(maxDrift <= 3, `drifted ${maxDrift} tokens while off-script`);
  assert.ok(offPart.some((e) => e.state === 'searching'), 'reports searching while off-script');
  const k = trace.findIndex((e, i) => i > firstOff && e.truth >= leave);
  const resumed = trace.slice(k).find((e) => e.position >= leave + 2 && e.state === 'tracking');
  assert.ok(resumed && resumed.i - k <= 6, `resumed after ${resumed ? resumed.i - k : 'never'} words`);
});

test('returns to an earlier section after going off-script', () => {
  const [p6s, p6e] = para(6);
  const [p2s] = para(2);
  const tracker = new SpeechTracker(T);
  tracker.setPosition(p6s - 1);
  const trace = feed(tracker, speak(T, [{ from: p6s, to: p6e }, { off: 25 }, { from: p2s, to: p2s + 30 }], { seed: 8 }));
  const k = trace.findIndex((e) => e.truth >= p2s && e.truth < p2s + 30);
  const settled = trace.slice(k).find((e) => Math.abs(e.position - e.lastTruth) <= 3);
  assert.ok(settled, 'should find the earlier section');
  assert.ok(settled.i - k <= 10, `took ${settled.i - k} words to go back`);
});

test('repeating a phrase does not run ahead', () => {
  const [p3s, p3e] = para(3);
  const a = p3s + 30;
  const tracker = new SpeechTracker(T);
  tracker.setPosition(p3s - 1);
  const trace = feed(tracker, speak(T, [{ from: p3s, to: a }, { from: a - 8, to: a }, { from: a - 5, to: p3e }], { seed: 9 }));
  for (const e of trace) {
    if (e.truth < 0) continue;
    const furthest = Math.max(...trace.slice(0, e.i + 1).map((x) => x.truth));
    assert.ok(e.position <= furthest + 2, `ran ahead at word ${e.i}: ${e.position} > ${furthest}`);
  }
  assert.ok(trace[trace.length - 1].position >= p3e - 3);
});

test('follows a paraphrased passage', () => {
  // "Six months later, the median time to first invoice dropped from nineteen days to under two hours."
  const tracker = new SpeechTracker(T);
  const [p8s] = para(6);
  tracker.setPosition(p8s - 1);
  const words = 'about six months later the typical time to the first invoice fell from nineteen days to less than two hours activation went up by thirty one percent'.split(' ');
  const trace = feed(tracker, words.map((w) => ({ w, truth: -1 })));
  const target = T.findIndex((t, j) => j > p8s && t.t === 'percent');
  assert.ok(trace[trace.length - 1].position >= target - 2, `position ${trace[trace.length - 1].position}, expected near ${target}`);
});

test('on-topic chatter does not drag the prompter around', () => {
  const [p4s] = para(4);
  const tracker = new SpeechTracker(T);
  tracker.setPosition(p4s + 10);
  const chatter = 'you know honestly customers really love the product and the team worked so hard on this and I think that is great for everyone'.split(' ');
  const trace = feed(tracker, chatter.map((w) => ({ w, truth: -1 })));
  const maxMove = Math.max(...trace.map((e) => Math.abs(e.position - (p4s + 10))));
  assert.ok(maxMove <= 12, `moved ${maxMove} tokens on unrelated chatter`);
  assert.ok(!trace.some((e) => e.jumped), 'never jumps on chatter');
});

test('starting mid-script is found quickly', () => {
  const [p5s, p5e] = para(5);
  const tracker = new SpeechTracker(T);
  const trace = feed(tracker, speak(T, [{ from: p5s, to: p5e }], { seed: 10 }));
  const settled = trace.find((e) => e.position >= p5s);
  assert.ok(settled && settled.i <= 6, `found after ${settled ? settled.i : 'never'} words`);
});

test('identical phrases elsewhere do not cause a jump', () => {
  // "thank you" appears at the start and twice at the end of the script.
  const tracker = new SpeechTracker(T);
  const trace = feed(tracker, speak(T, [{ from: 0, to: 20, clean: true }, { words: ['thank', 'you'] }]));
  assert.ok(trace[trace.length - 1].position < 30, `position ${trace[trace.length - 1].position}`);
});

test('a long pause changes nothing', () => {
  const tracker = new SpeechTracker(T);
  feed(tracker, speak(T, [{ from: 0, to: 30, clean: true }]));
  const before = tracker.position;
  const res = tracker.update(false);
  assert.equal(res.position, before);
});

test('cautious and responsive presets behave sensibly', () => {
  for (const sensitivity of ['cautious', 'responsive']) {
    const tracker = new SpeechTracker(T, { sensitivity });
    const trace = feed(tracker, speak(T, [{ from: 0, to: 200 }], { seed: 11 }));
    assert.ok(trace[trace.length - 1].position >= 190, `${sensitivity}: ${trace[trace.length - 1].position}`);
  }
});

test('jumps can be disabled', () => {
  const [, p1e] = para(1);
  const [p7s, p7e] = para(6);
  const tracker = new SpeechTracker(T, { allowJumps: false });
  const trace = feed(tracker, speak(T, [{ from: 0, to: p1e, clean: true }, { from: p7s, to: p7e, clean: true }]));
  assert.ok(trace[trace.length - 1].position < p7s, 'stays put when jumps are disabled');
});

test('scales to long scripts', () => {
  const longTokens = [];
  for (let k = 0; k < 40; k++) for (const t of T) longTokens.push({ ...t });
  const tracker = new SpeechTracker(longTokens);
  const start = longTokens.length - T.length + 100;
  tracker.setPosition(start - 1);
  const t0 = performance.now();
  const trace = feed(tracker, speak(longTokens, [{ from: start, to: start + 120 }], { seed: 12 }));
  const per = (performance.now() - t0) / trace.length;
  assert.ok(trace[trace.length - 1].position >= start + 110, `position ${trace[trace.length - 1].position}`);
  assert.ok(per < 25, `${per.toFixed(1)} ms per update`);
});
