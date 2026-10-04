// The island: one continuous dark surface whose width, height and corners are
// springs. Every state change (emerge, expand, hover, toast, retract) just moves
// the spring targets, so all transitions belong to the same liquid motion.

import { Spring, Animator } from '../../core/spring.js';
import { islandPath, hitIsland } from '../../core/island-shape.js';

const COMPACT_H = 36;
const TOAST_H = 38;
const HIDDEN_W = 84;

export class Island {
  constructor({ path, sheen, expanded, compact, toast, drop, onIgnoreMouse, onFrame, onSettled }) {
    this.el = { path, sheen, expanded, compact, toast, drop };
    this.onIgnoreMouse = onIgnoreMouse;
    this.onFrame = onFrame || (() => {});
    this.onSettled = onSettled || (() => {});
    this.mode = 'hidden';
    this.hover = false;
    this.inside = false;
    this.captured = false;
    this.toast = null;
    this.compactWidth = 200;
    this.geo = { islandWidth: 780, islandHeight: 250, floatGap: 0 };
    this.look = { style: 'liquid', intensity: 0.7, radius: 30 };
    this.size = { w: 780, h: 250 }; // expanded size (can change live while resizing)
    this.w = new Spring(HIDDEN_W, { stiffness: 240, damping: 27, precision: 0.1 });
    this.h = new Spring(0, { stiffness: 210, damping: 25, precision: 0.1 });
    this.r = new Spring(18, { stiffness: 300, damping: 32, precision: 0.05 });
    this.timers = [];
    this.lastClip = '';
    this.animator = new Animator((dt) => this._frame(dt));
  }

  get cx() { return window.innerWidth / 2; }
  get top() { return this.look.style === 'floating' ? this.geo.floatGap : 0; }

  /** Current visible rectangle of the island body. */
  get rect() { return { cx: this.cx, top: this.top, w: this.w.value, h: this.h.value }; }

  setGeometry(geo) {
    this.geo = { ...this.geo, ...geo };
    if (!geo.resizing) this.size = { w: geo.islandWidth, h: geo.islandHeight };
    this._retarget();
  }

  setLook(look) {
    this.look = { ...this.look, ...look };
    this._retarget();
  }

  /** Live resize (while the user drags the handle). */
  setExpandedSize(w, h) {
    this.size = { w, h };
    if (this.mode === 'expanded') {
      this.w.snap(w);
      this.h.snap(h);
      this.r.snap(this.look.radius);
    }
    this.animator.kick();
  }

  setCompactWidth(px) {
    this.compactWidth = Math.max(150, Math.min(360, px));
    if (this.mode === 'compact') this._retarget();
  }

  setMode(mode, { instant = false } = {}) {
    const prev = this.mode;
    if (prev === mode && !instant) return;
    this.mode = mode;
    document.body.classList.remove('state-hidden', 'state-compact', 'state-expanded');
    document.body.classList.add(`state-${mode}`);
    this.el.expanded.classList.remove('content-in');
    this.el.compact.classList.remove('content-in');
    this._retarget({ stagger: !instant, from: prev });
    if (instant) {
      this.w.snap(this.w.target);
      this.h.snap(this.h.target);
      this.r.snap(this.r.target);
    }
    this.animator.kick();
  }

  setHover(on) {
    if (this.hover === on) return;
    this.hover = on;
    this._retarget();
  }

  /** Grow the island briefly to show a short message (like a notification). */
  showToast(text, { kind = 'info', ms = 2600 } = {}) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.toggle('error', kind === 'error');
    const ctx = (this._measure ||= document.createElement('canvas').getContext('2d'));
    ctx.font = "600 13px 'Inter Variable', system-ui, sans-serif";
    const width = Math.ceil(ctx.measureText(text).width) + 44;
    this.toast = { width: Math.min(width, Math.max(this.size.w, 360)), until: performance.now() + ms };
    document.body.classList.add('toast-active');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), ms);
    this._retarget();
  }

  hideToast() {
    this.toast = null;
    document.body.classList.remove('toast-active');
    this.el.toast.classList.remove('show');
    this._retarget();
  }

  get toastVisible() {
    return !!this.toast && this.mode !== 'expanded';
  }

  _targets() {
    const hover = this.hover && !this.captured;
    if (this.toast && this.mode !== 'expanded') {
      return { w: Math.max(this.toast.width, this.mode === 'compact' ? this.compactWidth : 0), h: TOAST_H, r: TOAST_H / 2 };
    }
    switch (this.mode) {
      case 'expanded': return { w: this.size.w, h: this.size.h, r: this.look.radius };
      case 'compact': return { w: this.compactWidth + (hover ? 18 : 0), h: COMPACT_H + (hover ? 5 : 0), r: (COMPACT_H + (hover ? 5 : 0)) / 2 };
      default: return { w: HIDDEN_W, h: 0, r: 12 };
    }
  }

  _retarget({ stagger = false, from = this.mode } = {}) {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const t = this._targets();
    const growing = t.h > this.h.value;
    this.r.setTarget(t.r);
    if (stagger && from !== this.mode) {
      // Liquid sequencing: spread then drop when growing; lift then narrow when shrinking.
      if (growing) {
        this.w.setTarget(t.w);
        this.timers.push(setTimeout(() => { this.h.setTarget(t.h); this.animator.kick(); }, 45));
      } else {
        this.h.setTarget(t.h);
        this.timers.push(setTimeout(() => { this.w.setTarget(t.w); this.animator.kick(); }, 70));
      }
    } else {
      this.w.setTarget(t.w);
      this.h.setTarget(t.h);
    }
    this.animator.kick();
  }

  _frame(dt) {
    this.w.step(dt);
    this.h.step(dt);
    this.r.step(dt);
    this.render();
    this.onFrame(this.rect);
    // Staggered targets re-kick the loop when their timer fires.
    if (this.w.done && this.h.done && this.r.done) {
      this.onSettled(this.mode);
      return false;
    }
    return true;
  }

  render() {
    const { style, intensity } = this.look;
    const w = Math.max(0, this.w.value);
    const h = Math.max(0, this.h.value);
    const cx = this.cx;
    const top = this.top;
    const liquid = style === 'liquid' ? intensity : intensity * 0.5;
    const bulgeY = clamp(this.h.velocity * 0.010 * liquid, -9, 9);
    const bulgeX = clamp(this.w.velocity * 0.004 * liquid, -5, 5);
    const shoulder = Math.min(6 + 16 * intensity, h * 0.45);
    const r = Math.min(this.r.value, h);
    const d = islandPath({ cx, top, w, h, r, s: shoulder, bulgeX, bulgeY, style });
    this.el.path.setAttribute('d', d);

    // A faint sheen along the lower edge gives the surface depth.
    const sheen = this.el.sheen;
    if (h > 30 && intensity > 0.05) {
      const y = top + h - 0.5;
      const inset = Math.max(r * 1.2, 24);
      sheen.setAttribute('d', `M${cx - w / 2 + inset},${y} L${cx + w / 2 - inset},${y}`);
      sheen.style.opacity = String(0.06 + 0.1 * intensity);
    } else {
      sheen.style.opacity = '0';
    }

    // Expanded content: fixed size, revealed by a clip that follows the surface.
    const W = this.size.w;
    const H = this.size.h;
    const ex = this.el.expanded.style;
    ex.left = `${cx - W / 2}px`;
    ex.top = `${top}px`;
    ex.width = `${W}px`;
    ex.height = `${H}px`;
    const side = Math.max(0, (W - w) / 2);
    const bottom = Math.max(0, H - h);
    const clip = `inset(0px ${side.toFixed(1)}px ${bottom.toFixed(1)}px ${side.toFixed(1)}px round 0 0 ${r.toFixed(1)}px ${r.toFixed(1)}px)`;
    if (clip !== this.lastClip) {
      ex.clipPath = clip;
      this.lastClip = clip;
    }
    if (this.mode === 'expanded' && h > H * 0.72 && w > W * 0.8) this.el.expanded.classList.add('content-in');

    for (const el of [this.el.compact, this.el.toast]) {
      const s = el.style;
      s.left = `${cx - w / 2}px`;
      s.top = `${top}px`;
      s.width = `${w}px`;
      s.height = `${h}px`;
    }
    if (this.mode === 'compact' && !this.toast && h > COMPACT_H * 0.7) this.el.compact.classList.add('content-in');
    if (this.toast && this.mode !== 'expanded' && h > TOAST_H * 0.7 && Math.abs(w - this.w.target) < 30) this.el.toast.classList.add('show');

    const drop = this.el.drop.style;
    drop.left = `${cx - w / 2 + 8}px`;
    drop.top = `${top + 8}px`;
    drop.width = `${Math.max(0, w - 16)}px`;
    drop.height = `${Math.max(0, h - 16)}px`;
  }

  /** Track the pointer to decide whether clicks belong to us or pass through. */
  pointer(x, y) {
    if (this.captured) return;
    const inside = this.mode !== 'hidden' && this.h.value > 4 && hitIsland(this.rect, x, y, 2);
    if (inside !== this.inside) {
      this.inside = inside;
      this.onIgnoreMouse(!inside);
    }
    this.setHover(inside);
  }

  pointerLeft() {
    if (this.captured) return;
    if (this.inside) {
      this.inside = false;
      this.onIgnoreMouse(true);
    }
    this.setHover(false);
  }

  capture(on) {
    this.captured = on;
    if (on) {
      this.inside = true;
      this.onIgnoreMouse(false);
    }
  }

  get busy() {
    return !(this.w.done && this.h.done && this.r.done);
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
