// End-to-end check of real speech recognition + tracking.
// Windows voices speak parts of a script (with skips, asides and returns), the
// bundled recognizer transcribes it in 100 ms chunks, and the tracker follows.
// Skipped automatically when not on Windows or when the model is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from '../../src/main/script-parser.js';
import { buildModel } from '../../src/core/document.js';
import { SpeechTracker } from '../../src/core/tracker.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODEL_DIR = join(ROOT, 'resources', 'models', 'en-us');
const TTS = fileURLToPath(new URL('./tts.ps1', import.meta.url));
const CACHE = join(tmpdir(), 'yalti-speech-test');

const skip = process.platform !== 'win32' ? 'requires Windows speech voices'
  : !existsSync(join(MODEL_DIR, 'model.json')) ? 'model missing (npm run fetch-model)' : false;

const model = buildModel(parseScript(readFileSync(new URL('../fixtures/keynote.md', import.meta.url), 'utf8'), 'markdown'));
const T = model.tokens;
const paragraphs = model.blocks.map((b, i) => [b, i]).filter(([b]) => b.type === 'paragraph').map(([, i]) => {
  const r = model.blockRanges[i];
  const words = model.words.slice(r.firstWord, r.lastWord + 1);
  return { start: words[0].tokenStart, end: words[words.length - 1].tokenEnd, text: words.map((w) => w.text).join(' ') };
});
const sentencesOf = (p) => paragraphs[p].text.match(/[^.!?]+[.!?]+/g).map((s) => s.trim());
const tokenEndOf = (text, from) => {
  // Token index of the last word of `text` when it occurs at or after `from`.
  const words = buildModel(parseScript(text, 'text')).tokens.map((t) => t.t);
  for (let j = from; j + words.length <= T.length; j++) {
    if (words.every((w, k) => T[j + k].t === w)) return j + words.length - 1;
  }
  throw new Error('text not found in script: ' + text);
};

function synth(text, voice) {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash('sha1').update(voice + '|' + text).digest('hex').slice(0, 16);
  const out = join(CACHE, `${key}.wav`);
  if (!existsSync(out)) {
    const txt = join(CACHE, `${key}.txt`);
    writeFileSync(txt, text, 'utf8');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TTS, '-TextFile', txt, '-Out', out, '-Voice', voice], { encoding: 'utf8' });
    if (r.status !== 0 || !existsSync(out)) throw new Error('TTS failed: ' + (r.stderr || r.stdout));
  }
  return readWav16k(out);
}

function readWav16k(file) {
  const buf = readFileSync(file);
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

const silence = (sec) => new Float32Array(Math.round(16000 * sec));

/**
 * Speak a list of segments through recognizer + tracker. Returns the tracker
 * state after each segment and the full transcript.
 */
function run(engine, tracker, segments) {
  const after = [];
  const transcript = [];
  for (const seg of segments) {
    const audio = seg.silence ? silence(seg.silence) : synth(seg.text, seg.voice || 'Microsoft David Desktop');
    for (let i = 0; i < audio.length; i += 1600) {
      for (const ev of engine.accept(audio.subarray(i, i + 1600))) {
        tracker.pushResult(ev.text, ev.type === 'final');
        if (ev.type === 'final') transcript.push(ev.text);
      }
    }
    if (!seg.silence) {
      // A natural breath between segments lets the last words arrive.
      for (let i = 0; i < 16000 * 0.5; i += 1600) {
        for (const ev of engine.accept(silence(0.1))) {
          tracker.pushResult(ev.text, ev.type === 'final');
          if (ev.type === 'final') transcript.push(ev.text);
        }
      }
    }
    after.push({ label: seg.label, position: tracker.position, state: tracker.state });
  }
  for (const ev of engine.flush()) { tracker.pushResult(ev.text, true); transcript.push(ev.text); }
  return { after, transcript: transcript.join(' | ') };
}

let engine = null;
function getEngine() {
  if (!engine) {
    const { SpeechEngine } = require('../../src/speech/engine.cjs');
    engine = new SpeechEngine(MODEL_DIR, { numThreads: 1 });
  }
  engine.reset();
  return engine;
}

test('recognizer transcribes clear speech', { skip }, () => {
  const e = getEngine();
  const audio = synth('Good morning everyone, and thank you for joining us today.', 'Microsoft Zira Desktop');
  const events = [];
  for (let i = 0; i < audio.length; i += 1600) events.push(...e.accept(audio.subarray(i, i + 1600)));
  events.push(...e.flush());
  const text = events.filter((x) => x.type === 'final').map((x) => x.text).join(' ').toLowerCase();
  assert.match(text, /good morning everyone/);
  assert.match(text, /thank you for joining us/);
});

test('follows a straight read of two paragraphs', { skip }, () => {
  const tracker = new SpeechTracker(T);
  const { after, transcript } = run(getEngine(), tracker, [
    { label: 'p0', text: paragraphs[0].text },
    { label: 'p1', text: paragraphs[1].text, voice: 'Microsoft Zira Desktop' },
  ]);
  assert.ok(after[0].position >= paragraphs[0].end - 3, `after p0: ${after[0].position} (end ${paragraphs[0].end}) ${transcript}`);
  assert.ok(after[1].position >= paragraphs[1].end - 3, `after p1: ${after[1].position} (end ${paragraphs[1].end})`);
});

test('holds during an aside, then follows a jump ahead', { skip }, () => {
  const tracker = new SpeechTracker(T);
  const [first] = sentencesOf(0);
  const firstEnd = tokenEndOf(first, paragraphs[0].start);
  const [e1, e2] = sentencesOf(5);
  const { after, transcript } = run(getEngine(), tracker, [
    { label: 'start', text: first },
    { label: 'aside', text: 'By the way, I had a wonderful bowl of soup at a little place down by the river yesterday, and I still think about it.', voice: 'Microsoft Zira Desktop' },
    { silence: 1.5, label: 'pause' },
    { label: 'resume', text: `${e1} ${e2}` },
  ]);
  assert.ok(Math.abs(after[0].position - firstEnd) <= 2, `after first sentence: ${after[0].position} vs ${firstEnd}`);
  assert.ok(after[1].position <= firstEnd + 2, `aside moved the prompter to ${after[1].position}`);
  assert.equal(after[1].state, 'searching');
  const target = tokenEndOf(e2, paragraphs[5].start);
  assert.ok(Math.abs(after[3].position - target) <= 3, `after resume: ${after[3].position} vs ${target} — ${transcript}`);
});

test('returns to an earlier section', { skip }, () => {
  const tracker = new SpeechTracker(T);
  tracker.setPosition(paragraphs[6].start - 1);
  const [r1] = sentencesOf(6);
  const [, b2] = sentencesOf(2);
  const { after, transcript } = run(getEngine(), tracker, [
    { label: 'results', text: r1 },
    { label: 'aside', text: 'Actually, let me go back for a second, because I skipped something important.', voice: 'Microsoft Zira Desktop' },
    { label: 'earlier', text: b2 },
  ]);
  const r1End = tokenEndOf(r1, paragraphs[6].start);
  assert.ok(Math.abs(after[0].position - r1End) <= 2, `after results sentence: ${after[0].position} vs ${r1End}`);
  const target = tokenEndOf(b2, paragraphs[2].start);
  assert.ok(Math.abs(after[2].position - target) <= 3, `after going back: ${after[2].position} vs ${target} — ${transcript}`);
});

test('follows a paraphrase', { skip }, () => {
  const tracker = new SpeechTracker(T);
  tracker.setPosition(paragraphs[6].start - 1);
  const { after, transcript } = run(getEngine(), tracker, [
    { label: 'paraphrase', text: 'About six months later, the typical time to the first invoice fell from nineteen days to less than two hours. Activation rose by thirty one percent.' },
  ]);
  const target = tokenEndOf('Activation went up by thirty one percent', paragraphs[6].start);
  assert.ok(after[0].position >= target - 3, `after paraphrase: ${after[0].position} vs ${target} — ${transcript}`);
});
