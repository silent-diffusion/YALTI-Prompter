// Streaming speech recognition on the local CPU with sherpa-onnx.
// Used by the speech worker process and by the speech integration tests.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

let sherpa = null;
function loadSherpa() {
  if (!sherpa) sherpa = require('sherpa-onnx-node');
  return sherpa;
}

const SAMPLE_RATE = 16000;

/**
 * Windows limits classic file paths to 260 characters, which a deep install
 * folder can exceed. The extended-length form (\\?\C:\...) has no such limit.
 */
const EXTENDED = '\\\\?\\';

function longPathSafe(p) {
  if (process.platform !== 'win32' || p.length < 200 || p.startsWith(EXTENDED)) return p;
  const abs = path.resolve(p);
  return abs.startsWith('\\\\') ? `${EXTENDED}UNC\\${abs.slice(2)}` : `${EXTENDED}${abs}`;
}

/** Read and validate a model folder's model.json. */
function readModel(modelDir) {
  const manifestPath = path.join(modelDir, 'model.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = {};
  for (const role of ['encoder', 'decoder', 'joiner', 'tokens']) {
    const name = manifest.files && manifest.files[role];
    if (!name) throw new Error(`model.json is missing files.${role}`);
    const full = path.join(modelDir, name);
    if (!fs.existsSync(full)) throw new Error(`Model file not found: ${name}`);
    files[role] = longPathSafe(full);
  }
  return { manifest, files };
}

/**
 * Read a model's files once, so the operating system has them cached before the
 * recognizer loads them. On a cold start this disk read is most of the loading
 * time, and unlike the recognizer's own (blocking) load, its progress can be
 * measured: onProgress(loaded, total) is called after every chunk.
 */
async function warmModel(modelDir, onProgress = () => {}) {
  const { files } = readModel(modelDir);
  const list = Object.values(files);
  const total = list.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
  let loaded = 0;
  for (const file of list) {
    const fh = await fs.promises.open(file, 'r');
    try {
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, null);
        if (!bytesRead) break;
        loaded += bytesRead;
        onProgress(loaded, total);
      }
    } finally {
      await fh.close();
    }
  }
  return total;
}

/** List model folders (each containing a model.json) under the given roots. */
function listModels(roots) {
  const out = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      try {
        const { manifest } = readModel(dir);
        out.push({ id: manifest.id || entry.name, name: manifest.name || entry.name, language: manifest.language || '', dir });
      } catch {
        // Not a usable model folder; ignore.
      }
    }
  }
  return out;
}

class SpeechEngine {
  /**
   * @param {string} modelDir folder with model.json
   * @param {{ numThreads?: number }} [options]
   */
  constructor(modelDir, options = {}) {
    const { manifest, files } = readModel(modelDir);
    this.manifest = manifest;
    const t0 = Date.now();
    const { OnlineRecognizer } = loadSherpa();
    this.recognizer = new OnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner },
        tokens: files.tokens,
        numThreads: Math.max(1, Math.min(4, options.numThreads || 1)),
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      // A segment ends after 1.2 s of silence following speech, or 2.4 s of
      // silence with nothing recognized, or 20 s of continuous speech.
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    });
    this.loadMs = Date.now() - t0;
    this.stream = this.recognizer.createStream();
    this.segment = 0;
    this.lastText = '';
  }

  /**
   * Feed 16 kHz mono float samples. Returns the recognition events produced.
   * @param {Float32Array} samples
   * @returns {{ type: 'partial'|'final', text: string, segment: number }[]}
   */
  accept(samples) {
    const events = [];
    if (!samples || samples.length === 0) return events;
    this.stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
    const text = (this.recognizer.getResult(this.stream).text || '').trim();
    if (text !== this.lastText) {
      this.lastText = text;
      if (text) events.push({ type: 'partial', text, segment: this.segment });
    }
    if (this.recognizer.isEndpoint(this.stream)) {
      if (text) events.push({ type: 'final', text, segment: this.segment });
      this.recognizer.reset(this.stream);
      this.lastText = '';
      if (text) this.segment++;
    }
    return events;
  }

  /** Finish the current segment (e.g. when listening stops). */
  flush() {
    const events = [];
    const tail = new Float32Array(SAMPLE_RATE * 0.6);
    this.stream.acceptWaveform({ samples: tail, sampleRate: SAMPLE_RATE });
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
    const text = (this.recognizer.getResult(this.stream).text || '').trim();
    if (text) events.push({ type: 'final', text, segment: this.segment++ });
    this.recognizer.reset(this.stream);
    this.lastText = '';
    return events;
  }

  /** Drop any partially heard audio. */
  reset() {
    this.recognizer.reset(this.stream);
    this.lastText = '';
    this.segment++;
  }
}

module.exports = { SpeechEngine, readModel, warmModel, listModels, longPathSafe, SAMPLE_RATE };
