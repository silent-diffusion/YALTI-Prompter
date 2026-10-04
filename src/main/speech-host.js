// Runs the speech recognizer in a separate utility process and connects it to
// the prompter window with a direct MessagePort. The process starts only when
// voice tracking is first used and is shut down after a while unused.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { MessageChannelMain, utilityProcess } from 'electron';
import { paths } from './paths.js';

const require = createRequire(import.meta.url);
const { listModels } = require('../speech/engine.cjs');

const IDLE_UNLOAD_MS = 3 * 60 * 1000;

export class SpeechHost extends EventEmitter {
  /** @param {() => import('../core/settings-schema.js').DEFAULTS} getSettings */
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.child = null;
    this.modelKey = null;
    this.status = { state: 'stopped', message: '' };
    this.idleTimer = null;
    this.stopping = false;
  }

  models() {
    return listModels([paths.bundledModels(), paths.userModels()]);
  }

  /** The model chosen in settings, or the first available one. */
  pickModel() {
    const models = this.models();
    const wanted = this.getSettings().modelId;
    return models.find((m) => m.id === wanted) || models[0] || null;
  }

  _setStatus(state, message = '') {
    this.status = { state, message };
    this.emit('status', this.status);
  }

  _start() {
    const model = this.pickModel();
    if (!model) {
      this._setStatus('error', 'No speech model is installed, so voice tracking is unavailable. Manual and auto-scroll still work.');
      return false;
    }
    const threads = this.getSettings().speechThreads;
    const key = `${model.dir}|${threads}`;
    if (this.child && this.modelKey === key) return true;
    this.stop();

    this.modelKey = key;
    this.stopping = false;
    this._setStatus('loading', model.name);
    const child = utilityProcess.fork(paths.speechWorker(), [], { serviceName: 'YALTI Speech', stdio: 'pipe' });
    this.child = child;
    child.stdout?.on('data', (d) => console.log('[speech]', String(d).trim()));
    child.stderr?.on('data', (d) => console.warn('[speech]', String(d).trim()));
    child.on('message', (msg) => {
      if (child !== this.child) return;
      if (msg?.type === 'ready') this._setStatus('ready', msg.model);
      else if (msg?.type === 'error') this._setStatus('error', msg.message);
    });
    child.on('exit', (code) => {
      if (child !== this.child) return;
      this.child = null;
      this.modelKey = null;
      if (!this.stopping) {
        this._setStatus('error', `The speech engine stopped unexpectedly (code ${code}).`);
        this.emit('crashed');
      } else {
        this._setStatus('stopped');
      }
    });
    child.postMessage({ type: 'init', modelDir: model.dir, numThreads: threads });
    return true;
  }

  /** Connect the recognizer to a window. Starts the engine if needed. */
  connect(webContents) {
    clearTimeout(this.idleTimer);
    if (!this._start()) return false;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ type: 'attach' }, [port2]);
    webContents.postMessage('speech:port', null, [port1]);
    return true;
  }

  /** Voice tracking was turned off: unload after a while to free memory. */
  release() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_UNLOAD_MS);
  }

  stop() {
    clearTimeout(this.idleTimer);
    if (this.child) {
      this.stopping = true;
      const child = this.child;
      try { child.postMessage({ type: 'shutdown' }); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 1500);
      this.child = null;
      this.modelKey = null;
      this._setStatus('stopped');
    }
  }
}
