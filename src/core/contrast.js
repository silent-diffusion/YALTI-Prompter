// Readable colors for the controls drawn on the island, whatever color the
// island is: light controls on dark islands, dark ones on light islands.
// Uses the WCAG relative luminance and contrast ratio.

/** Dark ink used on light islands (matches --ui-rgb in prompter.css). */
export const DARK_INK = '#18181b';
export const LIGHT_INK = '#ffffff';

/** Status colors for each kind of island (also in prompter.css). */
export const STATUS = {
  light: { ok: '#34d17a', warn: '#ffb347', bad: '#ff6a5c' }, // light ink: dark islands
  dark: { ok: '#0f7a3e', warn: '#985000', bad: '#c0262d' }, // dark ink: light islands
};

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 0;
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 'dark' when dark controls read better on this background than light ones. */
export function inkFor(background) {
  return contrastRatio(background, DARK_INK) > contrastRatio(background, LIGHT_INK) ? 'dark' : 'light';
}
