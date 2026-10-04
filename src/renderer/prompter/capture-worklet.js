// Audio worklet: collects microphone samples (already resampled to 16 kHz by
// the AudioContext) into 100 ms chunks and posts them with their loudness.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) this.flush();
      }
    }
    return true;
  }

  flush() {
    let sum = 0;
    for (let i = 0; i < this.size; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.size);
    this.port.postMessage({ pcm: this.buf, rms }, [this.buf.buffer]);
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
}

registerProcessor('yalti-capture', CaptureProcessor);
