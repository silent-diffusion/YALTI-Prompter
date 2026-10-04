// Updates from GitHub Releases: check for a newer version, download the right
// file for this kind of install, verify it against the release's published
// checksums, and install it.
//
// This is the only network access in YALTI, and it happens only when the user
// checks for updates or has turned on automatic updates (Settings → Updates).
// Nothing about the user or their scripts is sent: just a request for the
// latest release, and the download.
//
// The Electron parts (fetch, file locations, launching, quitting) are passed
// in, so the logic can be tested in plain Node.

import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions } from '../core/version.js';
import { checksumFromLatestYml, checksumFromSums, latestReleaseApi, pickAsset, releaseInfo } from '../core/updates.js';

const PROGRESS_EVERY_MS = 150;

class UpdateError extends Error {}

/**
 * @typedef {'installer'|'portable'|'zip'|'dev'} InstallKind
 * @typedef {{
 *   currentVersion: string, kind: InstallKind, repo: string,
 *   fetch: typeof fetch,
 *   downloadDir: (kind: InstallKind) => string,
 *   launch: (file: string, args: string[]) => (void|Promise<void>),
 *   quit: () => void,
 *   beforeRelaunch?: () => void,
 *   reveal?: (file: string) => void,
 *   now?: () => number,
 * }} UpdaterDeps
 */
export class Updater extends EventEmitter {
  /** @param {UpdaterDeps} deps */
  constructor(deps) {
    super();
    this.deps = { now: Date.now, reveal: () => {}, beforeRelaunch: () => {}, ...deps };
    this.state = 'idle'; // idle | checking | up-to-date | available | downloading | downloaded | installing | error
    this.latest = null;
    this.checkedAt = null;
    this.progress = null;
    this.error = null;
    this.file = null;
    this.abort = null;
    this.installed = false;
  }

  /** What windows may see (no file system paths). */
  get status() {
    const { kind, currentVersion } = this.deps;
    const l = this.latest;
    return {
      state: this.state,
      current: currentVersion,
      kind,
      canDownload: kind !== 'dev',
      checkedAt: this.checkedAt,
      latest: l && { version: l.version, name: l.name, notes: l.notes, url: l.url, publishedAt: l.publishedAt },
      progress: this.progress,
      error: this.error,
    };
  }

  _set(patch) {
    Object.assign(this, patch);
    this.emit('status', this.status);
  }

  async _get(url, accept) {
    let res;
    try {
      res = await this.deps.fetch(url, {
        headers: { Accept: accept, 'User-Agent': `YALTI-Prompter/${this.deps.currentVersion}` },
        signal: this.abort?.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new UpdateError('Couldn’t reach GitHub. Check your internet connection and try again.');
    }
    if (res.status === 403 || res.status === 429) throw new UpdateError('GitHub is limiting update checks right now. Try again in a little while.');
    if (res.status === 404) throw new UpdateError('No published release was found on GitHub.');
    if (!res.ok) throw new UpdateError(`GitHub answered with an error (${res.status}). Try again later.`);
    return res;
  }

  /** Ask GitHub for the latest release. Resolves to the new status. */
  async check() {
    if (['checking', 'downloading', 'installing'].includes(this.state)) return this.status;
    if (this.state === 'downloaded') return this.status; // already have the newest
    this._set({ state: 'checking', error: null });
    try {
      const res = await this._get(latestReleaseApi(this.deps.repo), 'application/vnd.github+json');
      const info = releaseInfo(await res.json(), this.deps.repo);
      if (!info) throw new UpdateError('The latest release on GitHub isn’t a YALTI Prompter release YALTI can read.');
      const newer = compareVersions(info.version, this.deps.currentVersion) > 0;
      this._set({ state: newer ? 'available' : 'up-to-date', latest: info, checkedAt: this.deps.now() });
    } catch (err) {
      this._set({ state: 'error', error: messageOf(err), checkedAt: this.deps.now() });
    }
    return this.status;
  }

  /** Download the update for this install and verify it. Resolves to the new status. */
  async download() {
    const info = this.latest;
    const { kind } = this.deps;
    if (!info || this.state === 'downloading' || this.state === 'downloaded' || kind === 'dev') return this.status;
    if (compareVersions(info.version, this.deps.currentVersion) <= 0) return this.status;
    this.abort = new AbortController();
    this._set({ state: 'downloading', error: null, progress: { received: 0, total: 0 } });
    let part = null;
    try {
      const asset = pickAsset(info.assets, kind);
      if (!asset) throw new UpdateError('This release has no download for your copy of YALTI. Get it from the release page instead.');
      const expected = await this._expectedChecksum(info, asset.name);
      if (!expected) throw new UpdateError('This release has no checksums, so YALTI can’t verify the download. Get it from the release page instead.');

      const dir = this.deps.downloadDir(kind);
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, asset.name);
      if (existsSync(dest) && await fileDigest(dest, expected) === expected.digest) {
        this._done(dest);
        return this.status;
      }

      part = `${dest}.part`;
      const res = await this._get(asset.url, 'application/octet-stream');
      const total = Number(res.headers.get('content-length')) || asset.size || 0;
      const hash = createHash(expected.algorithm);
      const out = createWriteStream(part);
      let received = 0;
      let lastEmit = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          received += value.length;
          if (!out.write(value)) await once(out, 'drain');
          const t = this.deps.now();
          if (t - lastEmit >= PROGRESS_EVERY_MS) {
            lastEmit = t;
            this._set({ progress: { received, total } });
          }
        }
      } finally {
        out.end();
        await once(out, 'close');
      }
      if (hash.digest(expected.encoding) !== expected.digest) {
        throw new UpdateError('The download didn’t match its published checksum, so it was discarded. Please try again.');
      }
      renameSync(part, dest);
      part = null;
      this._done(dest);
    } catch (err) {
      if (part) rmSync(part, { force: true });
      // Cancelled: whatever error the aborted request surfaced, go back to "available".
      if (this.abort?.signal.aborted || err?.name === 'AbortError') this._set({ state: 'available', progress: null });
      else this._set({ state: 'error', error: messageOf(err), progress: null });
    } finally {
      this.abort = null;
    }
    return this.status;
  }

  _done(file) {
    this._set({ state: 'downloaded', file, progress: null });
    if (this.deps.kind === 'zip') this.deps.reveal(file);
  }

  async _expectedChecksum(info, name) {
    const sums = info.assets.find((a) => a.name === 'SHA256SUMS.txt');
    if (sums) {
      const found = checksumFromSums(await (await this._get(sums.url, 'text/plain')).text(), name);
      if (found) return found;
    }
    const yml = info.assets.find((a) => a.name === 'latest.yml');
    if (yml) return checksumFromLatestYml(await (await this._get(yml.url, 'text/plain')).text(), name);
    return null;
  }

  cancel() {
    this.abort?.abort();
  }

  /**
   * Install the downloaded update now: the installer runs silently and starts
   * the new version; a portable copy starts the new file. YALTI quits once the
   * new process is running (and stays if it could not be started).
   */
  async install() {
    if (this.state !== 'downloaded' || !this.file || this.installed) return false;
    const { kind } = this.deps;
    if (kind === 'zip') { this.deps.reveal(this.file); return false; }
    this.installed = true;
    this._set({ state: 'installing', error: null });
    try {
      if (kind === 'installer') {
        await this.deps.launch(this.file, ['--updated', '/S', '--force-run']);
      } else {
        this.deps.beforeRelaunch(); // let the new copy take over as the running instance
        await this.deps.launch(this.file, []);
      }
    } catch (err) {
      this.installed = false;
      this._set({ state: 'downloaded', error: `The update couldn’t be started: ${err?.message || err}` });
      return false;
    }
    this.deps.quit();
    return true;
  }

  /** YALTI is quitting: a downloaded installer update installs silently now. */
  installOnQuit() {
    if (this.state !== 'downloaded' || !this.file || this.installed || this.deps.kind !== 'installer') return false;
    this.installed = true;
    // The app is exiting; if the installer can't start, the update simply waits for next time.
    Promise.resolve(this.deps.launch(this.file, ['--updated', '/S'])).catch(() => {});
    return true;
  }
}

function messageOf(err) {
  return err instanceof UpdateError ? err.message : `Updating failed: ${err?.message || err}`;
}

function fileDigest(file, { algorithm, encoding }) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest(encoding)));
  });
}
