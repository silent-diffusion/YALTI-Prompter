import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, parseVersion } from '../../src/core/version.js';
import { checksumFromLatestYml, checksumFromSums, pickAsset, releaseInfo, repoFromUrl } from '../../src/core/updates.js';
import { Updater } from '../../src/main/updater.js';

const REPO = 'silent-diffusion/YALTI-Prompter';
const DL = `https://github.com/${REPO}/releases/download`;

test('versions compare the semver way', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.equal(parseVersion('1.2'), null);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.1.0-beta.2', '1.1.0'), -1);
  assert.equal(compareVersions('1.1.0-beta.10', '1.1.0-beta.2'), 1);
  assert.equal(compareVersions('1.1.0-alpha', '1.1.0-beta'), -1);
  assert.throws(() => compareVersions('one', '1.0.0'));
});

test('reads the repository from package.json', () => {
  assert.equal(repoFromUrl('https://github.com/silent-diffusion/YALTI-Prompter.git'), REPO);
  assert.equal(repoFromUrl('git@github.com:someone/fork.git'), 'someone/fork');
  assert.equal(repoFromUrl(''), REPO);
});

test('release info keeps only this repository’s files and skips drafts', () => {
  const json = {
    tag_name: 'v1.1.0', name: 'YALTI Prompter 1.1.0', body: 'Notes\r\nmore', html_url: `https://github.com/${REPO}/releases/tag/v1.1.0`, published_at: '2026-11-01T10:00:00Z',
    assets: [
      { name: 'YALTI-Prompter-Setup-1.1.0.exe', size: 10, browser_download_url: `${DL}/v1.1.0/YALTI-Prompter-Setup-1.1.0.exe` },
      { name: 'YALTI-Prompter-Portable-1.1.0.exe', size: 10, browser_download_url: 'https://evil.example/YALTI-Prompter-Portable-1.1.0.exe' },
    ],
  };
  const info = releaseInfo(json, REPO);
  assert.equal(info.version, '1.1.0');
  assert.equal(info.notes, 'Notes\nmore');
  assert.deepEqual(info.assets.map((a) => a.name), ['YALTI-Prompter-Setup-1.1.0.exe']);
  assert.equal(pickAsset(info.assets, 'installer').name, 'YALTI-Prompter-Setup-1.1.0.exe');
  assert.equal(pickAsset(info.assets, 'portable'), null);
  assert.equal(releaseInfo({ ...json, draft: true }, REPO), null);
  assert.equal(releaseInfo({ ...json, prerelease: true }, REPO), null);
  assert.equal(releaseInfo({ ...json, tag_name: 'nightly' }, REPO), null);
  assert.equal(releaseInfo({ ...json, html_url: 'https://evil.example/' }, REPO).url, `https://github.com/${REPO}/releases`);
});

test('reads published checksums (SHA256SUMS.txt as the release workflow writes it, and latest.yml)', () => {
  // Byte-for-byte the v1.0.0 file, plus a BOM and CRLF as Windows PowerShell may write them.
  const sums = '﻿b63cea9dc003958b2c8ef1e4699a8e0cba709badc7fcf78fdd796f43ca67cafc  YALTI-Prompter-1.0.0-win-x64.zip\r\n'
    + 'a66e7566fb8eacf49d3595eead3f58ccab85c1777453269dab6437d9031d5235  YALTI-Prompter-Portable-1.0.0.exe\r\n'
    + '2a25f02bc812d99b5670b863ed2af6422a02471deffba535e890c036852b0830  YALTI-Prompter-Setup-1.0.0.exe\r\n';
  assert.deepEqual(checksumFromSums(sums, 'YALTI-Prompter-1.0.0-win-x64.zip'),
    { algorithm: 'sha256', encoding: 'hex', digest: 'b63cea9dc003958b2c8ef1e4699a8e0cba709badc7fcf78fdd796f43ca67cafc' });
  assert.equal(checksumFromSums(sums, 'YALTI-Prompter-Setup-1.0.0.exe').digest.slice(0, 8), '2a25f02b');
  assert.equal(checksumFromSums(sums, 'other.exe'), null);
  const yml = 'version: 1.1.0\nfiles:\n  - url: YALTI-Prompter-Setup-1.1.0.exe\n    sha512: AbC+/9==\n    size: 10\npath: YALTI-Prompter-Setup-1.1.0.exe\nsha512: AbC+/9==\n';
  assert.deepEqual(checksumFromLatestYml(yml, 'YALTI-Prompter-Setup-1.1.0.exe'), { algorithm: 'sha512', encoding: 'base64', digest: 'AbC+/9==' });
  assert.equal(checksumFromLatestYml(yml, 'YALTI-Prompter-Portable-1.1.0.exe'), null);
});

/** A fake GitHub serving one release. */
function fakeGitHub({ version = '1.1.0', files = {}, sums = true, fail = null } = {}) {
  const calls = [];
  const assets = Object.keys(files).map((name) => ({ name, size: files[name].length, browser_download_url: `${DL}/v${version}/${name}` }));
  if (sums) {
    const text = Object.entries(files).map(([n, body]) => `${createHash('sha256').update(body).digest('hex')}  ${n}`).join('\n');
    files = { ...files, 'SHA256SUMS.txt': typeof sums === 'string' ? sums : text };
    assets.push({ name: 'SHA256SUMS.txt', size: 1, browser_download_url: `${DL}/v${version}/SHA256SUMS.txt` });
  }
  const fetch = async (url, init) => {
    calls.push(url);
    if (fail) throw new TypeError('fetch failed');
    if (url.endsWith('/releases/latest')) {
      return Response.json({ tag_name: `v${version}`, name: `YALTI Prompter ${version}`, body: 'What changed', html_url: `https://github.com/${REPO}/releases/tag/v${version}`, published_at: '2026-11-01T10:00:00Z', assets });
    }
    const name = url.split('/').pop();
    if (!(name in files)) return new Response('missing', { status: 404 });
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return new Response(files[name], { headers: { 'content-length': String(Buffer.byteLength(files[name])) } });
  };
  return { fetch, calls };
}

function makeUpdater(gh, kind = 'installer', currentVersion = '1.0.0') {
  const dir = mkdtempSync(join(tmpdir(), 'yalti-update-'));
  const log = [];
  const u = new Updater({
    currentVersion, kind, repo: REPO, fetch: gh.fetch,
    downloadDir: () => dir,
    launch: (file, args) => log.push(['launch', file.split(/[\\/]/).pop(), args]),
    quit: () => log.push(['quit']),
    beforeRelaunch: () => log.push(['release-lock']),
    reveal: (file) => log.push(['reveal', file.split(/[\\/]/).pop()]),
  });
  return { u, dir, log, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('up to date when the latest release is this version', async () => {
  const { u, cleanup } = makeUpdater(fakeGitHub({ version: '1.0.0' }));
  const s = await u.check();
  assert.equal(s.state, 'up-to-date');
  assert.equal(s.latest.version, '1.0.0');
  assert.ok(s.checkedAt > 0);
  cleanup();
});

test('installer: check, download, verify, then install silently and quit', async () => {
  const body = 'MZ-installer-bytes'.repeat(1000);
  const gh = fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': body, 'YALTI-Prompter-Portable-1.1.0.exe': 'other' } });
  const { u, dir, log, cleanup } = makeUpdater(gh);
  const states = [];
  u.on('status', (s) => states.push(s.state));
  assert.equal((await u.check()).state, 'available');
  const s = await u.download();
  assert.equal(s.state, 'downloaded', s.error);
  assert.ok(!('file' in s), 'paths are not exposed to windows');
  assert.deepEqual(readdirSync(dir), ['YALTI-Prompter-Setup-1.1.0.exe']);
  assert.ok(states.includes('downloading'));
  assert.equal(await u.install(), true);
  assert.deepEqual(log, [['launch', 'YALTI-Prompter-Setup-1.1.0.exe', ['--updated', '/S', '--force-run']], ['quit']]);
  assert.equal(u.installOnQuit(), false, 'never runs the installer twice');
  cleanup();
});

test('installer: a downloaded update installs on quit when not installed earlier', async () => {
  const gh = fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'abc' } });
  const { u, log, cleanup } = makeUpdater(gh);
  await u.check();
  await u.download();
  assert.equal(u.installOnQuit(), true);
  assert.deepEqual(log, [['launch', 'YALTI-Prompter-Setup-1.1.0.exe', ['--updated', '/S']]]);
  assert.equal(u.installOnQuit(), false);
  cleanup();
});

test('a download that doesn’t match its checksum is discarded', async () => {
  const sums = `${'0'.repeat(64)}  YALTI-Prompter-Setup-1.1.0.exe\n`;
  const { u, dir, cleanup } = makeUpdater(fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'tampered' }, sums }));
  await u.check();
  const s = await u.download();
  assert.equal(s.state, 'error');
  assert.match(s.error, /checksum/);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(await u.install(), false);
  cleanup();
});

test('refuses releases without checksums', async () => {
  const { u, cleanup } = makeUpdater(fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'abc' }, sums: false }));
  await u.check();
  const s = await u.download();
  assert.equal(s.state, 'error');
  assert.match(s.error, /no checksums/);
  cleanup();
});

test('reuses an update that was already downloaded and verified', async () => {
  const gh = fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'abc' } });
  const { u, dir, cleanup } = makeUpdater(gh);
  writeFileSync(join(dir, 'YALTI-Prompter-Setup-1.1.0.exe'), 'abc');
  await u.check();
  assert.equal((await u.download()).state, 'downloaded');
  assert.ok(!gh.calls.some((c) => c.endsWith('.exe')), 'no second download');
  cleanup();
});

test('portable copies start the new file; zip copies are revealed; development builds only check', async () => {
  const files = { 'YALTI-Prompter-Portable-1.1.0.exe': 'p', 'YALTI-Prompter-1.1.0-win-x64.zip': 'z', 'YALTI-Prompter-Setup-1.1.0.exe': 's' };
  const p = makeUpdater(fakeGitHub({ files }), 'portable');
  await p.u.check();
  await p.u.download();
  assert.equal(await p.u.install(), true);
  assert.deepEqual(p.log, [['release-lock'], ['launch', 'YALTI-Prompter-Portable-1.1.0.exe', []], ['quit']]);
  assert.equal(p.u.installOnQuit(), false);
  p.cleanup();

  const z = makeUpdater(fakeGitHub({ files }), 'zip');
  await z.u.check();
  await z.u.download();
  assert.deepEqual(z.log, [['reveal', 'YALTI-Prompter-1.1.0-win-x64.zip']]);
  assert.equal(await z.u.install(), false);
  z.cleanup();

  const d = makeUpdater(fakeGitHub({ files }), 'dev');
  assert.equal((await d.u.check()).state, 'available');
  assert.equal(d.u.status.canDownload, false);
  assert.equal((await d.u.download()).state, 'available');
  assert.ok(!existsSync(join(d.dir, 'YALTI-Prompter-Setup-1.1.0.exe')));
  d.cleanup();
});

test('stays open and says so when the update can’t be started', async () => {
  const gh = fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'abc' } });
  const { u, log, cleanup } = makeUpdater(gh);
  u.deps.launch = async () => { throw new Error('blocked by policy'); };
  await u.check();
  await u.download();
  assert.equal(await u.install(), false);
  assert.equal(u.status.state, 'downloaded');
  assert.match(u.status.error, /blocked by policy/);
  assert.ok(!log.some((l) => l[0] === 'quit'));
  cleanup();
});

test('cancelling a download goes back to "available" and leaves nothing behind', async () => {
  const gh = fakeGitHub({ files: { 'YALTI-Prompter-Setup-1.1.0.exe': 'abc' } });
  const slow = gh.fetch;
  gh.fetch = async (url, init) => {
    if (!url.endsWith('.exe')) return slow(url, init);
    // A download that sends one chunk, then stalls until it is cancelled (and fails oddly).
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(1024));
        init.signal.addEventListener('abort', () => c.error(new Error('net::ERR_ABORTED')));
      },
    });
    return new Response(body, { headers: { 'content-length': '999999' } });
  };
  const { u, dir, cleanup } = makeUpdater(gh);
  await u.check();
  const done = u.download();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(u.status.state, 'downloading');
  u.cancel();
  const s = await done;
  assert.equal(s.state, 'available', s.error);
  assert.deepEqual(readdirSync(dir), []);
  cleanup();
});

test('explains network problems in plain words', async () => {
  const { u, cleanup } = makeUpdater(fakeGitHub({ fail: true }));
  const s = await u.check();
  assert.equal(s.state, 'error');
  assert.match(s.error, /Couldn’t reach GitHub/);
  cleanup();
});
