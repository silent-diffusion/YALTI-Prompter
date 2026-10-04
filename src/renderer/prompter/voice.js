// Microphone capture and the link to the local speech engine. Audio goes from
// an AudioWorklet straight to the recognizer process over a MessagePort; it is
// never stored and never leaves the computer.

const PORT_TIMEOUT_MS = 30000;

export class VoiceInput {
  /**
   * @param {{ onResult: (type: string, text: string) => void, onLevel?: (rms: number) => void,
   *           onStatus: (state: string, message?: string, detail?: object) => void }} handlers
   */
  constructor(handlers) {
    this.h = handlers;
    this.port = null;
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.active = false;
    this.engineReady = false;
    this.deviceId = '';
    this.restarts = 0;
    this.restartTimer = null;
    // Diagnostics (visible in the smoke test and dev tools).
    this.stats = { chunks: 0, sent: 0, results: 0, peak: 0, ctxState: '' };
  }

  get running() { return this.active; }

  async start(deviceId = '') {
    this.deviceId = deviceId;
    this.active = true;
    this.restarts = 0;
    this.h.onStatus('connecting');
    try {
      await this._connectEngine();
      if (!this.active) return;
      await this._openMic();
      if (!this.active) { this._closeMic(); return; }
      this.h.onStatus(this.engineReady ? 'listening' : 'loading');
    } catch (err) {
      const msg = describeError(err);
      this.active = false;
      this._closeMic();
      this.h.onStatus('error', msg.message, msg);
    }
  }

  stop() {
    this.active = false;
    clearTimeout(this.restartTimer);
    this._closeMic();
    if (this.port) {
      try { this.port.postMessage({ type: 'flush' }); } catch { /* ignore */ }
    }
    this.h.onStatus('off');
  }

  /** Forget partially heard words (after a manual jump). */
  reset() {
    if (this.port) {
      try { this.port.postMessage({ type: 'reset' }); } catch { /* ignore */ }
    }
  }

  /** The engine process restarted: get a fresh port and keep listening. */
  async reconnect() {
    if (!this.active) return;
    this.engineReady = false;
    this.port = null;
    try {
      await this._connectEngine();
      this.h.onStatus(this.engineReady ? 'listening' : 'loading');
    } catch (err) {
      const msg = describeError(err);
      this.stop();
      this.h.onStatus('error', msg.message, msg);
    }
  }

  async _connectEngine() {
    if (this.port) return;
    const portPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(Object.assign(new Error('The speech engine did not start in time.'), { name: 'EngineTimeout' }));
      }, PORT_TIMEOUT_MS);
      const onMessage = (e) => {
        if (e.source !== window || e.data?.yalti !== 'speech-port' || !e.ports?.[0]) return;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(e.ports[0]);
      };
      window.addEventListener('message', onMessage);
    });
    const ok = await window.yalti.speechConnect();
    if (!ok) throw Object.assign(new Error('Voice tracking is unavailable because no speech model is installed.'), { name: 'NoModel' });
    const port = await portPromise;
    this.port = port;
    port.onmessage = (e) => this._onEngine(e.data || {});
    port.start();
  }

  _onEngine(msg) {
    switch (msg.type) {
      case 'ready':
        this.engineReady = true;
        if (this.active && this.stream) this.h.onStatus('listening');
        break;
      case 'partial':
      case 'final':
        this.stats.results++;
        if (this.active) this.h.onResult(msg.type, msg.text);
        break;
      case 'error':
        this.h.onStatus('error', msg.message, { kind: 'engine' });
        break;
      default:
    }
  }

  async _openMic() {
    const constraints = (id) => ({
      audio: {
        ...(id ? { deviceId: { exact: id } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(this.deviceId));
    } catch (err) {
      if (this.deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia(constraints(''));
      } else {
        throw err;
      }
    }
    this.stream = stream;
    const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'yalti-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    this.node = node;
    node.port.onmessage = (e) => {
      const { pcm, rms } = e.data;
      this.stats.chunks++;
      if (rms > this.stats.peak) this.stats.peak = rms;
      this.h.onLevel?.(rms);
      if (this.port && this.active) {
        // Copied, not transferred: Electron's port bridge drops transferred buffers.
        try { this.port.postMessage({ type: 'audio', pcm }); this.stats.sent++; } catch { /* engine gone */ }
      }
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () => this._micLost();
    }
    if (ctx.state === 'suspended') await ctx.resume();
    this.stats.ctxState = ctx.state;
  }

  _closeMic() {
    if (this.node) {
      this.node.port.onmessage = null;
      try { this.node.disconnect(); } catch { /* ignore */ }
      this.node = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) { t.onended = null; t.stop(); }
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  /** The microphone vanished (unplugged, disabled): try to recover. */
  _micLost() {
    this._closeMic();
    if (!this.active) return;
    if (this.restarts >= 3) {
      this.stop();
      this.h.onStatus('error', 'The microphone stopped working. Check that it is connected, then try again.', { kind: 'mic' });
      return;
    }
    this.restarts++;
    this.h.onStatus('connecting', 'Reconnecting microphone…');
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(async () => {
      try {
        await this._openMic();
        this.h.onStatus(this.engineReady ? 'listening' : 'loading');
      } catch {
        this._micLost();
      }
    }, 1500);
  }
}

function describeError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'privacy', message: 'Microphone access is blocked. Allow desktop apps to use the microphone in Windows Settings.' };
    case 'NotFoundError':
      return { kind: 'mic', message: 'No microphone was found. Connect one, then try again.' };
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'mic', message: 'The microphone is busy or unavailable. Close other apps using it, then try again.' };
    case 'NoModel':
    case 'EngineTimeout':
      return { kind: 'engine', message: err.message };
    default:
      return { kind: 'unknown', message: `Voice tracking could not start: ${err?.message || err}` };
  }
}
