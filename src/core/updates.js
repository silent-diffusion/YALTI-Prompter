// Reading a GitHub release for the updater: which version it is, which file
// to download for this kind of install, and the checksum that file must match.
// Pure functions; the network and file work live in src/main/updater.js.

import { parseVersion } from './version.js';

export const DEFAULT_REPO = 'silent-diffusion/YALTI-Prompter';

// Release file names, as set in package.json (build.nsis/portable/win artifactName).
const ASSETS = {
  installer: /^YALTI-Prompter-Setup-\d+\.\d+\.\d+(?:-[\w.]+)?\.exe$/i,
  portable: /^YALTI-Prompter-Portable-\d+\.\d+\.\d+(?:-[\w.]+)?\.exe$/i,
  zip: /^YALTI-Prompter-\d+\.\d+\.\d+(?:-[\w.]+)?-win-x64\.zip$/i,
};

/** "owner/repo" from a package.json repository URL, or the default. */
export function repoFromUrl(url) {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}` : DEFAULT_REPO;
}

export function latestReleaseApi(repo) {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export function releasesPage(repo) {
  return `https://github.com/${repo}/releases`;
}

/**
 * The parts of a GitHub API release we use, or null if it isn't a usable
 * published release. Only files attached to this repository's releases are kept.
 */
export function releaseInfo(json, repo) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const version = String(json.tag_name || '').replace(/^v/i, '');
  if (!parseVersion(version)) return null;
  const page = releasesPage(repo);
  const downloads = `https://github.com/${repo}/releases/download/`;
  const assets = (Array.isArray(json.assets) ? json.assets : [])
    .filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string'
      && a.browser_download_url.startsWith(downloads))
    .map((a) => ({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 }));
  return {
    version,
    name: String(json.name || `YALTI Prompter ${version}`).slice(0, 120),
    notes: String(json.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 8000),
    url: typeof json.html_url === 'string' && json.html_url.startsWith(`${page}/`) ? json.html_url : page,
    publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
    assets,
  };
}

/** The file to download for an install kind ('installer' | 'portable' | 'zip'). */
export function pickAsset(assets, kind) {
  const re = ASSETS[kind];
  return re ? assets.find((a) => re.test(a.name)) || null : null;
}

/**
 * Expected checksum of `name` from a SHA256SUMS.txt ("<hex>  <name>" per line).
 * @returns {{ algorithm: 'sha256', encoding: 'hex', digest: string } | null}
 */
export function checksumFromSums(text, name) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return { algorithm: 'sha256', encoding: 'hex', digest: m[1].toLowerCase() };
  }
  return null;
}

/**
 * Expected checksum of `name` from electron-builder's latest.yml
 * ("- url: <name>" followed by "sha512: <base64>").
 * @returns {{ algorithm: 'sha512', encoding: 'base64', digest: string } | null}
 */
export function checksumFromLatestYml(text, name) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-?\s*url:\s*(.+?)\s*$/.exec(lines[i]);
    if (!m || m[1].replace(/^['"]|['"]$/g, '') !== name) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (/^\s*-\s/.test(lines[j])) break;
      const h = /^\s*sha512:\s*([A-Za-z0-9+/]+={0,2})\s*$/.exec(lines[j]);
      if (h) return { algorithm: 'sha512', encoding: 'base64', digest: h[1] };
    }
  }
  return null;
}
