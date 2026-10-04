// Speech-aware position tracking.
//
// The tracker keeps a short window of recently recognized words and aligns it
// against the whole script with a weighted local alignment (Smith-Waterman
// style) that tolerates misrecognized, skipped, inserted, merged and split
// words. Every alignment that ends on one of the most recent spoken words is a
// candidate for "where the speaker is now".
//
// Each candidate carries three kinds of evidence:
//   score   - the whole alignment, including older context (continuity)
//   tail    - evidence gathered since the last big gap (used for jumps)
//   recent  - exponentially decayed evidence of the last few words (used for
//             small moves), so an old alignment cannot "walk" forward on
//             unrelated speech.
//
// The decision step prefers continuing near the current position, jumps
// elsewhere only when recent evidence is strong, unambiguous and repeated, and
// holds still while the speaker is off-script. See docs/ARCHITECTURE.md.

import { normalizePhrase, phoneticKey, wordSimilarity, FILLERS } from './text.js';

export const SENSITIVITY = {
  // Moves later, needs more evidence. Good for noisy rooms or heavy ad-libbing.
  cautious: {
    localMin: 1.2, localMinMatches: 2, maxTrailingLocal: 1, denseMatches: 5,
    jumpMin: 4.2, jumpMinMatches: 5, jumpMargin: 1.4, ambiguityMargin: 1.0,
    confirmUpdates: 3, distanceFactor: 0.55, backwardExtra: 0.8, strongExtra: 3.0,
  },
  balanced: {
    localMin: 1.0, localMinMatches: 2, maxTrailingLocal: 2, denseMatches: 4,
    jumpMin: 3.2, jumpMinMatches: 4, jumpMargin: 1.0, ambiguityMargin: 0.8,
    confirmUpdates: 2, distanceFactor: 0.45, backwardExtra: 0.6, strongExtra: 2.5,
  },
  // Follows quickly. Good for clean audio and close reading.
  responsive: {
    localMin: 0.8, localMinMatches: 2, maxTrailingLocal: 2, denseMatches: 4,
    jumpMin: 2.6, jumpMinMatches: 3, jumpMargin: 0.7, ambiguityMargin: 0.6,
    confirmUpdates: 1, distanceFactor: 0.35, backwardExtra: 0.4, strongExtra: 2.0,
  },
};

const WINDOW = 14;          // spoken tokens considered per update
const SUB = 0.45;           // substitution penalty
const INS = 0.4;            // spoken word with no script counterpart
const DEL_BASE = 0.15;      // skipped script word (base)
const DEL_W = 0.25;         // skipped script word (scaled by its weight)
const DEL_GROW = 0.08;      // extra cost per consecutive skipped word
const BIG_GAP = 3;          // consecutive skips/insertions that end the "tail"
const DECAY = 0.65;         // per-word decay of the "recent" evidence
const MATCH_MIN = 0.5;      // minimum similarity that counts as a match
const LOCAL_BACK = 12;      // tokens behind the position that count as "local"
const LOCAL_AHEAD = 45;     // tokens ahead of the position that count as "local"
const FULL_SCAN_LIMIT = 20000;
const SEARCHING_AFTER = 4;  // unexplained recent words before we call it off-script
const NEAR = 8;             // forward moves up to this many tokens need only base evidence
const PER_TOKEN = 0.035;    // extra recent evidence per token beyond NEAR

const POPCOUNT = new Uint8Array(256);
for (let i = 1; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

export class SpeechTracker {
  /**
   * @param {{t: string, key?: string, w: number}[]} tokens script tokens
   * @param {{ sensitivity?: keyof SENSITIVITY, allowJumps?: boolean }} [options]
   */
  constructor(tokens = [], options = {}) {
    this.sensitivity = SENSITIVITY[options.sensitivity] ? options.sensitivity : 'balanced';
    this.allowJumps = options.allowJumps !== false;
    this.setTokens(tokens);
  }

  setOptions({ sensitivity, allowJumps } = {}) {
    if (sensitivity && SENSITIVITY[sensitivity]) this.sensitivity = sensitivity;
    if (typeof allowJumps === 'boolean') this.allowJumps = allowJumps;
  }

  get params() { return SENSITIVITY[this.sensitivity]; }

  setTokens(tokens) {
    this.tokens = tokens;
    const L = tokens.length;
    this.typeOf = new Int32Array(L);
    this.weights = new Float32Array(L);
    this.types = [];
    this.typeKeys = [];
    const typeIndex = new Map();
    for (let j = 0; j < L; j++) {
      const t = tokens[j].t;
      let id = typeIndex.get(t);
      if (id === undefined) {
        id = this.types.length;
        typeIndex.set(t, id);
        this.types.push(t);
        this.typeKeys.push(tokens[j].key ?? phoneticKey(t));
      }
      this.typeOf[j] = id;
      this.weights[j] = tokens[j].w ?? 1;
    }
    this.typeIndex = typeIndex;
    // Adjacent script pairs that a recognizer may merge into one word ("to day" -> "today").
    this.pairIndex = new Map();
    for (let j = 1; j < L; j++) {
      const joined = tokens[j - 1].t + tokens[j].t;
      let list = this.pairIndex.get(joined);
      if (!list) this.pairIndex.set(joined, (list = []));
      list.push(j);
    }
    this.simCache = new Map();
    this.reset(-1);
  }

  /** Forget everything heard and place the tracker at `position` (-1 = before the start). */
  reset(position = -1) {
    this.position = Math.max(-1, Math.min(position, this.tokens.length - 1));
    this.committed = [];
    this.partial = [];
    this.pending = null;
    this.state = 'idle';
    this.unexplained = 0;
    this.localMisses = 0;
    this.lastCandidates = [];
  }

  /** Manual override, e.g. the user scrolled. Clears heard words so they cannot pull back. */
  setPosition(position) {
    this.reset(position);
  }

  /**
   * Feed a recognizer result. `text` is the full text of the current segment so
   * far; `isFinal` marks the end of a segment (endpoint).
   * @returns {{ position: number, state: string, moved: boolean, jumped: boolean, confidence: number }}
   */
  pushResult(text, isFinal = false) {
    const words = normalizePhrase(text).filter((w) => !FILLERS.has(w));
    if (isFinal) {
      this.committed.push(...words);
      if (this.committed.length > 64) this.committed.splice(0, this.committed.length - 64);
      this.partial = [];
    } else {
      this.partial = words;
    }
    return this.update(!isFinal);
  }

  _spokenWindow(lastIsPartial) {
    const all = this.committed.concat(this.partial);
    const slice = all.slice(-WINDOW);
    const n = slice.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = slice[i];
      // The newest word of a partial result may still be incomplete ("minut").
      const incomplete = lastIsPartial && this.partial.length > 0 && i === n - 1;
      out.push({ t, c: incomplete ? 0.6 : 1, sims: this._sims(t, incomplete), split: this.pairIndex.get(t) || null, pairType: -1 });
    }
    for (let i = 1; i < n; i++) {
      const id = this.typeIndex.get(out[i - 1].t + out[i].t);
      if (id !== undefined) out[i].pairType = id;
    }
    return out;
  }

  /** Similarity of a spoken token against every distinct script word (cached). */
  _sims(t, prefixMode) {
    const cacheKey = prefixMode ? t + '\u0000p' : t;
    let sims = this.simCache.get(cacheKey);
    if (sims) return sims;
    const key = phoneticKey(t);
    const types = this.types;
    sims = new Float32Array(types.length);
    for (let k = 0; k < types.length; k++) {
      let s = wordSimilarity(t, types[k], key, this.typeKeys[k]);
      if (prefixMode && s < 0.7 && t.length >= 3 && types[k].startsWith(t)) s = 0.7;
      sims[k] = s;
    }
    if (this.simCache.size > 400) this.simCache.clear();
    this.simCache.set(cacheKey, sims);
    return sims;
  }

  /** Script ranges to align against. Short scripts are scanned in full. */
  _ranges(spoken) {
    const L = this.tokens.length;
    if (L <= FULL_SCAN_LIMIT) return [[0, L]];
    const ranges = [];
    const p = Math.max(0, this.position);
    ranges.push([Math.max(0, p - 200), Math.min(L, p + 600)]);
    // Seed windows around distinctive words that were just heard.
    for (const sp of spoken) {
      let hits = 0;
      for (let j = 0; j < L && hits < 40; j++) {
        if (sp.sims[this.typeOf[j]] >= 0.85 && this.weights[j] >= 0.8) {
          ranges.push([Math.max(0, j - 30), Math.min(L, j + 30)]);
          hits++;
        }
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return merged;
  }

  /**
   * Weighted local alignment of `spoken` against script[lo, hi). Adds one
   * candidate per script end position (the last matched script token) to `out`.
   */
  _align(spoken, lo, hi, out) {
    const n = spoken.length;
    const W = hi - lo;
    if (n === 0 || W <= 0) return;
    const size = W + 1;
    const rows = (make) => [make(), make(), make()];
    const score = rows(() => new Float32Array(size));
    const matches = rows(() => new Int16Array(size));
    const start = rows(() => new Int32Array(size).fill(-1));
    const lastI = rows(() => new Int16Array(size).fill(-1));
    const lastJ = rows(() => new Int32Array(size).fill(-1));
    const tail = rows(() => new Float32Array(size));
    const recent = rows(() => new Float32Array(size));
    const mask = rows(() => new Int32Array(size));
    const delRun = rows(() => new Int16Array(size));
    const insRun = rows(() => new Int16Array(size));
    const typeOf = this.typeOf;
    const weights = this.weights;

    for (let i = 1; i <= n; i++) {
      const C = i % 3, P = (i - 1) % 3, P2 = (i - 2 + 3) % 3;
      const sp = spoken[i - 1];
      const sims = sp.sims, cf = sp.c, pairType = sp.pairType, split = sp.split;
      const sC = score[C], sP = score[P], sP2 = score[P2];
      const mC = matches[C], mP = matches[P], mP2 = matches[P2];
      const stC = start[C], stP = start[P], stP2 = start[P2];
      const liC = lastI[C], liP = lastI[P];
      const ljC = lastJ[C], ljP = lastJ[P];
      const tC = tail[C], tP = tail[P], tP2 = tail[P2];
      const rC = recent[C], rP = recent[P], rP2 = recent[P2];
      const kC = mask[C], kP = mask[P], kP2 = mask[P2];
      const dC = delRun[C], dP = delRun[P];
      const iC = insRun[C], iP = insRun[P];
      sC[0] = 0; mC[0] = 0; stC[0] = -1; liC[0] = -1; ljC[0] = -1;
      tC[0] = 0; rC[0] = 0; kC[0] = 0; dC[0] = 0; iC[0] = 0;

      for (let c = 1; c <= W; c++) {
        const j = lo + c - 1;
        const tw = weights[j];
        // Default: a fresh alignment could start after this cell.
        let best = 0, bm = 0, bs = -1, bl = -1, bj = -1;
        let bt = 0, br = 0, bk = 0, bd = 0, bi = 0;

        // Match or substitution (consumes one spoken and one script word).
        const sim = sims[typeOf[j]];
        if (sim >= MATCH_MIN) {
          const g = tw * sim * cf;
          const v = sP[c - 1] + g;
          if (v > best) {
            best = v; bm = mP[c - 1] + 1; bs = mP[c - 1] === 0 ? j : stP[c - 1]; bl = i - 1; bj = j;
            bt = tP[c - 1] + g; br = rP[c - 1] * DECAY + g; bk = (kP[c - 1] << 1) | 1; bd = 0; bi = 0;
          }
        } else if (mP[c - 1] > 0) {
          const v = sP[c - 1] - SUB * cf;
          if (v > best) {
            best = v; bm = mP[c - 1]; bs = stP[c - 1]; bl = liP[c - 1]; bj = ljP[c - 1];
            bt = tP[c - 1] - SUB * cf; br = rP[c - 1] * DECAY - SUB * cf; bk = kP[c - 1] << 1; bd = 0; bi = 0;
          }
        }
        // Spoken word with no script counterpart (ad-lib, filler, recognizer noise).
        if (mP[c] > 0) {
          const v = sP[c] - INS * cf;
          if (v > best) {
            best = v; bm = mP[c]; bs = stP[c]; bl = liP[c]; bj = ljP[c];
            bi = iP[c] + 1; bd = dP[c];
            br = rP[c] * DECAY - INS * cf;
            if (bi >= BIG_GAP) { bt = 0; bk = 0; } else { bt = tP[c] - INS * cf; bk = kP[c] << 1; }
          }
        }
        // Script word skipped (not said, or dropped by the recognizer). Long
        // skips get progressively more expensive and end the tail.
        if (mC[c - 1] > 0) {
          const cost = DEL_BASE + DEL_W * tw + DEL_GROW * Math.min(dC[c - 1], 10);
          const v = sC[c - 1] - cost;
          if (v > best) {
            best = v; bm = mC[c - 1]; bs = stC[c - 1]; bl = liC[c - 1]; bj = ljC[c - 1];
            bd = dC[c - 1] + 1; bi = iC[c - 1];
            if (bd >= BIG_GAP) { bt = 0; br = 0; bk = 0; } else { bt = tC[c - 1] - cost; br = rC[c - 1] - cost; bk = kC[c - 1]; }
          }
        }
        // Two spoken words make one script word ("on boarding" -> "onboarding").
        if (i >= 2 && pairType >= 0 && pairType === typeOf[j]) {
          const g = tw * cf;
          const v = sP2[c - 1] + g;
          if (v > best) {
            best = v; bm = mP2[c - 1] + 1; bs = mP2[c - 1] === 0 ? j : stP2[c - 1]; bl = i - 1; bj = j;
            bt = tP2[c - 1] + g; br = rP2[c - 1] * DECAY * DECAY + g; bk = (kP2[c - 1] << 2) | 3; bd = 0; bi = 0;
          }
        }
        // One spoken word covers two script words ("today" -> "to day").
        if (split !== null && c >= 2 && split.includes(j)) {
          const g = (weights[j - 1] + tw) * 0.9 * cf;
          const v = sP[c - 2] + g;
          if (v > best) {
            best = v; bm = mP[c - 2] + 2; bs = mP[c - 2] === 0 ? j - 1 : stP[c - 2]; bl = i - 1; bj = j;
            bt = tP[c - 2] + g; br = rP[c - 2] * DECAY + g; bk = (kP[c - 2] << 1) | 1; bd = 0; bi = 0;
          }
        }

        sC[c] = best; mC[c] = bm; stC[c] = bs; liC[c] = bl; ljC[c] = bj;
        tC[c] = bt; rC[c] = br; kC[c] = bk & 0xffff; dC[c] = bd; iC[c] = bi;
      }
    }

    const F = n % 3;
    const sF = score[F], mF = matches[F], stF = start[F], liF = lastI[F], ljF = lastJ[F];
    const tF = tail[F], rF = recent[F], kF = mask[F];
    for (let c = 1; c <= W; c++) {
      if (sF[c] <= 0 || mF[c] === 0) continue;
      const end = ljF[c];
      const existing = out.get(end);
      if (!existing || existing.score < sF[c]) {
        out.set(end, {
          end,
          score: sF[c],
          matches: mF[c],
          start: stF[c],
          trailing: n - 1 - liF[c],
          tail: tF[c],
          tailMatches: POPCOUNT[kF[c] & 0xff],
          recent: rF[c],
          recentMatches: POPCOUNT[kF[c] & 0x3f],
        });
      }
    }
  }

  /** Recompute the position from the current spoken window. */
  update(lastIsPartial = false) {
    const prevPosition = this.position;
    const L = this.tokens.length;
    const result = { position: this.position, state: this.state, moved: false, jumped: false, confidence: 0 };
    if (L === 0) return result;
    const spoken = this._spokenWindow(lastIsPartial);
    if (spoken.length === 0) return result;

    const candidates = new Map();
    for (const [lo, hi] of this._ranges(spoken)) this._align(spoken, lo, hi, candidates);
    const all = [...candidates.values()];
    this.lastCandidates = all;

    const P = this.params;
    const pos = this.position;
    const acquiring = pos < 0;
    const localLo = acquiring ? 0 : pos - LOCAL_BACK;
    const localHi = acquiring ? 40 : pos + LOCAL_AHEAD;

    // Local: continuing near the current position. Ranked by the full score
    // (continuity counts) but it must be backed by recent evidence.
    let local = null;
    // Global: anywhere else. Ranked by evidence since the last big gap.
    let global = null;
    let bestTrailing = Infinity;
    for (const cand of all) {
      if (cand.trailing < bestTrailing) bestTrailing = cand.trailing;
      const inLocal = cand.end >= localLo && cand.end <= localHi;
      if (inLocal) {
        // Small advances are cheap; longer leaps ahead need more evidence.
        const ahead = acquiring ? 0 : Math.max(0, cand.end - pos - NEAR);
        const needRecent = P.localMin + PER_TOKEN * ahead;
        const needMatches = P.localMinMatches + (ahead > 0 ? 1 : 0);
        const strong = cand.recentMatches >= needMatches && cand.recent >= needRecent;
        // Runs of common words ("thank you to everyone who...") weigh little,
        // so many in-order recent matches also justify a small advance.
        const dense = ahead === 0 && cand.recentMatches >= P.denseMatches && cand.recent >= 0.3;
        if (cand.trailing <= P.maxTrailingLocal && (strong || dense) && (!local || cand.score > local.score)) local = cand;
      } else if (cand.trailing <= 1 && (!global || cand.tail > global.tail)) {
        global = cand;
      }
    }

    // A runner-up far from the global best means the jump target is ambiguous.
    let runnerUp = 0;
    if (global) {
      for (const cand of all) {
        if (cand.trailing > 1 || Math.abs(cand.end - global.end) < 15) continue;
        if (cand.tail > runnerUp) runnerUp = cand.tail;
      }
    }

    let decision = null;
    if (local) {
      if (local.end >= pos || acquiring) {
        decision = { pos: local.end, jump: false, evidence: local.recent };
      } else {
        // Moving backwards: only for a clear re-read, never for jitter.
        const back = pos - local.end;
        const clear = back >= 2 && local.recent >= P.localMin + 1.0 && local.recentMatches >= 3;
        decision = { pos: clear ? local.end : pos, jump: false, evidence: local.recent };
      }
    }

    // When nothing nearby explains the latest words, the old position is a weak
    // prior and distance should matter less.
    this.localMisses = local ? 0 : this.localMisses + 1;
    const lost = this.state === 'searching' || this.localMisses >= 2;

    const minMatches = acquiring ? Math.min(3, P.jumpMinMatches) : P.jumpMinMatches;
    if (global && (this.allowJumps || acquiring) && global.tailMatches >= minMatches) {
      const dist = global.end - Math.max(pos, 0);
      let need;
      if (acquiring) need = Math.min(P.jumpMin, 2.4);
      else if (lost) need = P.jumpMin + (dist < 0 ? P.backwardExtra * 0.5 : 0);
      else need = P.jumpMin + P.distanceFactor * Math.log2(1 + Math.abs(dist) / 60) + (dist < 0 ? P.backwardExtra : 0);
      const beatsLocal = global.tail >= (local ? local.tail : 0) + P.jumpMargin;
      const unambiguous = global.tail >= runnerUp + P.ambiguityMargin;
      if (global.tail >= need && beatsLocal && unambiguous) {
        const p = this.pending;
        if (p && global.end >= p.end - 2 && global.end <= p.end + 10) {
          p.count++;
          p.end = global.end;
        } else {
          this.pending = { end: global.end, count: 1 };
        }
        const confirmed = this.pending.count >= (acquiring ? 1 : P.confirmUpdates) || global.tail >= need + P.strongExtra;
        if (confirmed) {
          decision = { pos: global.end, jump: true, evidence: global.tail };
          this.pending = null;
        }
      } else if (this.pending && !local) {
        // Keep a pending jump alive briefly while more words arrive.
        this.pending.count = Math.max(0, this.pending.count - 0.5);
        if (this.pending.count <= 0) this.pending = null;
      }
    } else if (local) {
      this.pending = null;
    }

    if (decision) {
      this.position = decision.pos;
      this.unexplained = 0;
      this.state = 'tracking';
      result.confidence = Math.min(1, decision.evidence / 2.5);
      result.jumped = decision.jump && decision.pos !== prevPosition;
    } else {
      this.unexplained = Number.isFinite(bestTrailing) ? bestTrailing : spoken.length;
      if (this.unexplained >= SEARCHING_AFTER || (!local && !global && spoken.length >= SEARCHING_AFTER)) {
        this.state = 'searching';
      }
    }

    result.position = this.position;
    result.state = this.state;
    result.moved = this.position !== prevPosition;
    return result;
  }
}
