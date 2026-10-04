// Builds the README images in docs/images from the smoke-test captures
// (run `npm run test:app -- --fake-mic <wav>` first). The prompter captures
// have transparent backgrounds, so they are placed on a neutral backdrop.
// Run with: npx electron scripts/make-screenshots.mjs

import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'test-output', 'smoke');
const OUT = join(ROOT, 'docs', 'images');

const BACKDROP = `
  background:
    radial-gradient(1200px 500px at 20% 110%, #c9d6e8 0%, transparent 60%),
    radial-gradient(900px 500px at 90% 120%, #e8d9c9 0%, transparent 55%),
    linear-gradient(180deg, #eef0f4 0%, #dfe3ea 100%);`;

const pages = {
  'hero.png': { w: 1400, h: 330, html: (img) => `<div class="screen"><div class="bar"></div><img src="${img('07-voice.png', '06-tracking.png')}" style="position:absolute;left:50%;top:0;transform:translateX(-50%)"></div>` },
  'compact.png': { w: 1000, h: 110, html: (img) => `<div class="screen"><img src="${img('03-compact.png')}" style="position:absolute;left:50%;top:0;transform:translateX(-50%)"></div>` },
  'notification.png': { w: 1000, h: 110, html: (img) => `<div class="screen"><img src="${img('04-toast.png')}" style="position:absolute;left:50%;top:0;transform:translateX(-50%)"></div>` },
  'controls.png': { w: 1100, h: 320, html: (img) => `<div class="screen"><img src="${img('02-controls.png')}" style="position:absolute;left:50%;top:0;transform:translateX(-50%)"></div>` },
  'floating.png': { w: 1100, h: 320, html: (img) => `<div class="screen"><img src="${img('08-floating-literata.png')}" style="position:absolute;left:50%;top:0;transform:translateX(-50%)"></div>` },
  'settings.png': { w: 980, h: 760, html: (img) => `<div class="screen" style="display:grid;place-items:center"><img src="${img('09-settings.png')}" style="border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.35)"></div>` },
  'editor.png': { w: 1020, h: 780, html: (img) => `<div class="screen" style="display:grid;place-items:center"><img src="${img('09-editor.png')}" style="border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.35)"></div>` },
};

async function render(name, spec) {
  const pick = (...files) => {
    const f = files.find((x) => existsSync(join(SRC, x)));
    if (!f) throw new Error(`missing capture: ${files.join(' or ')}`);
    return f;
  };
  const html = `<!doctype html><html><body style="margin:0">
    <style>.screen{position:relative;width:${spec.w}px;height:${spec.h}px;overflow:hidden;${BACKDROP}}
    .bar{position:absolute;left:0;right:0;top:0;height:0}</style>${spec.html(pick)}</body></html>`;
  const page = join(SRC, `_compose-${name}.html`);
  writeFileSync(page, html);
  const win = new BrowserWindow({ width: spec.w, height: spec.h, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: spec.w, height: spec.h });
  writeFileSync(join(OUT, name), image.toPNG());
  win.destroy();
  rmSync(page, { force: true });
  console.log('wrote', name);
}

// Rendering windows come and go; keep the app alive between them.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  for (const [name, spec] of Object.entries(pages)) {
    try { await render(name, spec); } catch (err) { console.warn(`skipped ${name}: ${err.message}`); }
  }
  app.quit();
});
