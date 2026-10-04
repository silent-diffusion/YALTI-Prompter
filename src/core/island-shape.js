// Geometry of the island: a dark surface that flows out of the top edge of
// the screen. Concave "shoulders" blend the island into the bezel, corners use
// smooth (squircle-like) curves, and the edges can bulge slightly while moving
// so the surface reads as liquid rather than rigid.

const r1 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p
 * @param {number} p.cx       horizontal center
 * @param {number} p.top      y of the screen edge (0) or float gap
 * @param {number} p.w        body width
 * @param {number} p.h        body height (below `top`)
 * @param {number} p.r        corner radius
 * @param {number} [p.s]      shoulder radius (liquid style)
 * @param {number} [p.bulgeX] outward bow of the sides, px
 * @param {number} [p.bulgeY] downward bow of the bottom edge, px
 * @param {'liquid'|'flush'|'floating'} [p.style]
 * @returns {string} SVG path data ('' when nothing is visible)
 */
export function islandPath({ cx, top = 0, w, h, r, s = 0, bulgeX = 0, bulgeY = 0, style = 'liquid' }) {
  if (!(w > 1) || !(h > 0.5)) return '';
  const floating = style === 'floating';
  const shoulder = style === 'liquid' ? Math.max(0, Math.min(s, h * 0.45, w * 0.2)) : 0;
  const xl = cx - w / 2;
  const xr = cx + w / 2;
  const bottom = top + h;
  // Corner extent: the curve starts a little before a circle would (smoother).
  const maxCorner = floating ? Math.min(w / 2, h / 2) : Math.min(w / 2, h - shoulder);
  const p = Math.max(0, Math.min(r * 1.18, maxCorner));
  const k = p * 0.6;
  const ks = shoulder * 0.56;
  const bx = (bulgeX * 4) / 3;
  const by = (bulgeY * 4) / 3;
  const d = [];

  if (floating) {
    const yTop = top;
    const sideTop = yTop + p;
    const sideBottom = bottom - p;
    d.push(`M${r1(xl + p)},${r1(yTop)}`);
    d.push(`L${r1(xr - p)},${r1(yTop)}`);
    d.push(`C${r1(xr - p + k)},${r1(yTop)} ${r1(xr)},${r1(sideTop - k)} ${r1(xr)},${r1(sideTop)}`);
    d.push(sideCurve(xr, sideTop, sideBottom, bx));
    d.push(`C${r1(xr)},${r1(sideBottom + k)} ${r1(xr - p + k)},${r1(bottom)} ${r1(xr - p)},${r1(bottom)}`);
    d.push(bottomCurve(xr - p, xl + p, bottom, by));
    d.push(`C${r1(xl + p - k)},${r1(bottom)} ${r1(xl)},${r1(sideBottom + k)} ${r1(xl)},${r1(sideBottom)}`);
    d.push(sideCurve(xl, sideBottom, sideTop, -bx));
    d.push(`C${r1(xl)},${r1(sideTop - k)} ${r1(xl + p - k)},${r1(yTop)} ${r1(xl + p)},${r1(yTop)}`);
    d.push('Z');
    return d.join(' ');
  }

  // Attached to the top edge. Start slightly above the edge so no seam shows.
  const bleed = top - 2;
  const sideTop = top + shoulder;
  const sideBottom = bottom - p;
  d.push(`M${r1(xl - shoulder)},${r1(bleed)}`);
  d.push(`L${r1(xl - shoulder)},${r1(top)}`);
  if (shoulder > 0) d.push(`C${r1(xl - shoulder + ks)},${r1(top)} ${r1(xl)},${r1(sideTop - ks)} ${r1(xl)},${r1(sideTop)}`);
  d.push(sideCurve(xl, sideTop, sideBottom, -bx));
  d.push(`C${r1(xl)},${r1(sideBottom + k)} ${r1(xl + p - k)},${r1(bottom)} ${r1(xl + p)},${r1(bottom)}`);
  d.push(bottomCurve(xl + p, xr - p, bottom, by));
  d.push(`C${r1(xr - p + k)},${r1(bottom)} ${r1(xr)},${r1(sideBottom + k)} ${r1(xr)},${r1(sideBottom)}`);
  d.push(sideCurve(xr, sideBottom, sideTop, bx));
  if (shoulder > 0) d.push(`C${r1(xr)},${r1(sideTop - ks)} ${r1(xr + shoulder - ks)},${r1(top)} ${r1(xr + shoulder)},${r1(top)}`);
  d.push(`L${r1(xr + shoulder)},${r1(bleed)}`);
  d.push('Z');
  return d.join(' ');
}

function sideCurve(x, y0, y1, bow) {
  if (Math.abs(bow) < 0.05) return `L${r1(x)},${r1(y1)}`;
  const a = y0 + (y1 - y0) / 3;
  const b = y0 + (2 * (y1 - y0)) / 3;
  return `C${r1(x + bow)},${r1(a)} ${r1(x + bow)},${r1(b)} ${r1(x)},${r1(y1)}`;
}

function bottomCurve(x0, x1, y, bow) {
  if (Math.abs(bow) < 0.05) return `L${r1(x1)},${r1(y)}`;
  const a = x0 + (x1 - x0) / 3;
  const b = x0 + (2 * (x1 - x0)) / 3;
  return `C${r1(a)},${r1(y + bow)} ${r1(b)},${r1(y + bow)} ${r1(x1)},${r1(y)}`;
}

/**
 * The resize grip in a bottom corner: a band along the rim of the rounded
 * corner, `thickness` px deep, continuing `extent` px along both edges. The rim
 * stays clear of the controls inset from the edges, so it never steals their
 * clicks. Coordinates are local to a square box of `size` px whose bottom-right
 * corner is the island's corner (mirror the box for the left corner).
 * @returns {{ size: number, clip: string, grip: string }} clip-path and grip-stroke path data
 */
export function cornerGrip({ r, extent = 28, thickness = 12, inset = 6, tail = 8 }) {
  const R = Math.max(0, r);
  const S = R + extent;
  const ri = Math.max(0, R - thickness);
  const rg = Math.max(0, R - inset);
  const clip = [
    `M${r1(S - thickness)},0`, `L${r1(S)},0`, `L${r1(S)},${r1(S - R)}`,
    `A${r1(R)},${r1(R)} 0 0 1 ${r1(S - R)},${r1(S)}`,
    `L0,${r1(S)}`, `L0,${r1(S - thickness)}`, `L${r1(S - thickness - ri)},${r1(S - thickness)}`,
    `A${r1(ri)},${r1(ri)} 0 0 0 ${r1(S - thickness)},${r1(S - thickness - ri)}`, 'Z',
  ].join(' ');
  const g = S - inset;
  const grip = [
    `M${r1(g)},${r1(S - R - tail)}`, `L${r1(g)},${r1(S - inset - rg)}`,
    `A${r1(rg)},${r1(rg)} 0 0 1 ${r1(S - inset - rg)},${r1(g)}`,
    `L${r1(S - R - tail)},${r1(g)}`,
  ].join(' ');
  return { size: S, clip, grip };
}

/** Is (x, y) on the island body (with an optional margin)? */
export function hitIsland({ cx, top = 0, w, h }, x, y, margin = 0) {
  return Math.abs(x - cx) <= w / 2 + margin && y >= top - 4 && y <= top + h + margin;
}
