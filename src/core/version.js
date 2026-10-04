// Semantic versions ("1.2.3", "v1.2.3-beta.2"), for update checks.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @returns {{ major: number, minor: number, patch: number, pre: string[] } | null} */
export function parseVersion(text) {
  const m = SEMVER.exec(String(text ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1 as `a` is older than, the same as, or newer than `b`. Throws on non-versions. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  }
  // A pre-release comes before its release: 1.2.0-beta < 1.2.0.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (Number(p) !== Number(q)) return Number(p) > Number(q) ? 1 : -1;
    } else if (pn !== qn) {
      return pn ? -1 : 1; // numeric identifiers sort first
    } else if (p !== q) {
      return p > q ? 1 : -1;
    }
  }
  return 0;
}
