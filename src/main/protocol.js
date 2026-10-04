// Serves the interface from a private app:// scheme instead of file://.
// Only the renderer code, shared core modules, bundled fonts and app icons are
// reachable, so a page can never read arbitrary files from disk.

import { net, protocol } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ROOT } from './paths.js';

export const APP_ORIGIN = 'app://yalti';

const ALLOWED = [
  join(APP_ROOT, 'src', 'renderer'),
  join(APP_ROOT, 'src', 'core'),
  join(APP_ROOT, 'node_modules', '@fontsource-variable'),
  join(APP_ROOT, 'assets', 'icons'),
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Must run before the app is ready. */
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

export function handleProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'yalti') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const full = normalize(join(APP_ROOT, rel));
    if (!ALLOWED.some((dir) => full === dir || full.startsWith(dir + sep))) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const res = await net.fetch(pathToFileURL(full).toString());
      if (!res.ok) return new Response('Not found', { status: 404 });
      const ext = full.slice(full.lastIndexOf('.')).toLowerCase();
      const headers = new Headers(res.headers);
      if (MIME[ext]) headers.set('Content-Type', MIME[ext]);
      headers.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export function pageUrl(name) {
  return `${APP_ORIGIN}/src/renderer/${name}/index.html`;
}
