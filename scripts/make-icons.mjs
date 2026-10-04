// Renders assets/icons/icon.svg to PNG and ICO files using Electron itself,
// so no image tools are needed. Run with: npm run icons

import { app, BrowserWindow, nativeImage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'assets', 'icons');
const BUILD = join(ROOT, 'build');

/** Pack PNG images into a .ico file (PNG-compressed entries, Vista+). */
function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 250));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return img;
}

app.whenReady().then(async () => {
  mkdirSync(BUILD, { recursive: true });
  const svg = readFileSync(join(ICONS, 'icon.svg'), 'utf8');
  const big = await render(svg, 1024);
  const sized = (s) => nativeImage.createFromBuffer(big.toPNG()).resize({ width: s, height: s, quality: 'best' }).toPNG();

  writeFileSync(join(ICONS, 'icon.png'), sized(512));
  writeFileSync(join(BUILD, 'icon.png'), sized(1024 > 512 ? 512 : 1024));
  const appIco = makeIco([16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, data: sized(size) })));
  writeFileSync(join(BUILD, 'icon.ico'), appIco);
  writeFileSync(join(ICONS, 'icon.ico'), appIco);
  writeFileSync(join(ICONS, 'tray.ico'), makeIco([16, 20, 24, 32, 40, 48].map((size) => ({ size, data: sized(size) }))));
  console.log('Icons written to assets/icons and build/.');
  app.quit();
});
