/**
 * One-Euro Filter — adaptive low-pass filter for real-time signal smoothing.
 *
 * Reference: Casiez, G., Roussel, N., & Vogel, D. (2012).
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems."
 * CHI 2012.
 *
 * Principle: strong smoothing when the signal moves slowly (kills jitter),
 * weak smoothing when it moves fast (avoids lag). Ideal for pose landmarks:
 * stable when the person is still, responsive during fast reaches.
 */

export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private minCutoff = 1.5,
    private beta = 0.05,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      this.dxPrev = 0;
      return x;
    }

    const dt = Math.max((t - this.tPrev) / 1000, 0.001);

    // Smooth the derivative (velocity)
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    // Adaptive cutoff: faster movement → higher cutoff → less smoothing
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/**
 * Applies One-Euro filtering to an array of 2D/3D landmarks.
 * When visibility drops below threshold, the filter resets so that
 * re-acquired points aren't smoothed toward stale positions.
 */
export interface SmoothableLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export class LandmarkSmoother {
  private xFilters: OneEuroFilter[];
  private yFilters: OneEuroFilter[];

  constructor(
    numLandmarks: number,
    minCutoff = 1.2,
    beta = 0.04,
  ) {
    this.xFilters = Array.from({ length: numLandmarks }, () => new OneEuroFilter(minCutoff, beta));
    this.yFilters = Array.from({ length: numLandmarks }, () => new OneEuroFilter(minCutoff, beta));
  }

  smooth<T extends SmoothableLandmark>(landmarks: T[], t: number): T[] {
    return landmarks.map((lm, i) => {
      const vis = lm.visibility ?? 0.5;
      if (vis < 0.3) {
        this.xFilters[i]?.reset();
        this.yFilters[i]?.reset();
        return lm;
      }
      return {
        ...lm,
        x: this.xFilters[i].filter(lm.x, t),
        y: this.yFilters[i].filter(lm.y, t),
      };
    });
  }

  reset(): void {
    this.xFilters.forEach(f => f.reset());
    this.yFilters.forEach(f => f.reset());
  }
}
