// Speech worker: runs in an Electron utility process so recognition can never
// block or crash the interface. Audio arrives from the prompter window over a
// MessagePort; results go back the same way. Nothing leaves this computer.

'use strict';

const { SpeechEngine } = require('./engine.cjs');

/** @type {SpeechEngine|null} */
let engine = null;
/** @type {Electron.MessagePortMain|null} */
let port = null;
let initError = null;

function send(msg) {
  if (port) {
    try { port.postMessage(msg); } catch { /* window gone */ }
  }
}

function toParent(msg) {
  try { process.parentPort.postMessage(msg); } catch { /* parent gone */ }
}

function handleAudio(data) {
  if (!engine) return;
  let samples = data.pcm;
  if (!(samples instanceof Float32Array)) samples = new Float32Array(samples);
  try {
    for (const ev of engine.accept(samples)) send(ev);
  } catch (err) {
    send({ type: 'error', message: `Recognition failed: ${err.message}` });
  }
}

function attach(newPort) {
  if (port) {
    try { port.close(); } catch { /* ignore */ }
  }
  port = newPort;
  port.on('message', (e) => {
    const msg = e.data || {};
    if (msg.type === 'audio') handleAudio(msg);
    else if (msg.type === 'reset' && engine) engine.reset();
    else if (msg.type === 'flush' && engine) for (const ev of engine.flush()) send(ev);
  });
  port.on('close', () => { if (port === newPort) port = null; });
  port.start();
  if (engine) send({ type: 'ready', model: engine.manifest.name, loadMs: engine.loadMs });
  else if (initError) send({ type: 'error', message: initError });
}

process.parentPort.on('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    try {
      engine = new SpeechEngine(msg.modelDir, { numThreads: msg.numThreads });
      toParent({ type: 'ready', model: engine.manifest.name, loadMs: engine.loadMs });
      send({ type: 'ready', model: engine.manifest.name, loadMs: engine.loadMs });
    } catch (err) {
      initError = `Could not load the speech model: ${err.message}`;
      toParent({ type: 'error', message: initError });
      send({ type: 'error', message: initError });
    }
  } else if (msg.type === 'attach' && e.ports && e.ports[0]) {
    attach(e.ports[0]);
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});
