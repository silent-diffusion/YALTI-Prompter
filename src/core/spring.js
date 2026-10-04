// Damped springs drive every movement of the island, so expanding, shrinking,
// hovering and retracting all feel like one continuous, physical surface.

export class Spring {
  /**
   * @param {number} value initial value
   * @param {{ stiffness?: number, damping?: number, precision?: number }} [opts]
   */
  constructor(value, { stiffness = 220, damping = 26, precision = 0.05 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
    this.precision = precision;
  }

  setTarget(target) {
    this.target = target;
  }

  snap(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  get done() {
    return Math.abs(this.velocity) < this.precision * 4 && Math.abs(this.target - this.value) < this.precision;
  }

  /** Advance by dt seconds using small fixed sub-steps for stability. */
  step(dt) {
    if (this.done) {
      this.value = this.target;
      this.velocity = 0;
      return this.value;
    }
    let remaining = Math.min(dt, 0.064);
    const h = 1 / 240;
    while (remaining > 1e-6) {
      const s = Math.min(h, remaining);
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += force * s;
      this.value += this.velocity * s;
      remaining -= s;
    }
    if (this.done) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
}

/** A frame loop that runs only while something is moving (no idle CPU). */
export class Animator {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
  }

  kick() {
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const keepGoing = this.onFrame(dt, now);
    this.raf = keepGoing ? requestAnimationFrame(this.tick) : 0;
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
