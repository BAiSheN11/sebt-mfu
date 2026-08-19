/**
 * FootEstimator — adaptive Kalman filter + kinematic-chain toe estimation.
 *
 * v2 improvements:
 *  - Adaptive process noise: scales with measured foot speed so fast reaches
 *    are tracked responsively while quiet stance stays smooth.
 *  - Velocity-aware kinematic chain: during occlusion the toe is predicted from
 *    ankle position + calibrated foot vector + ankle velocity contribution,
 *    which handles foot rotation (toe lifting / reaching forward) better.
 *  - Occlusion segment analysis: tracks max continuous occlusion streak,
 *    number of occlusion events, and whether peak-reach frames were estimated.
 *  - Re-acquisition blending: when the toe reappears after a short occlusion,
 *    the new observation is blended in gradually to prevent jumps.
 *  - Per-frame confidence is exposed so reach measurements can be gated /
 *    flagged by measurement quality.
 */

// ─── Small matrix helpers ────────────────────────────────────────────────────
function matMul(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j];
    }
  return c;
}

function matT(a: Float64Array, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) c[j * n + i] = a[i * n + j];
  return c;
}

function matAdd(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) c[i] = a[i] + b[i];
  return c;
}

function inv2(a: number, b: number, c: number, d: number): [number, number, number, number] {
  const det = a * d - b * c;
  const id = 1 / det;
  return [d * id, -b * id, -c * id, a * id];
}

function inv3(m: Float64Array): Float64Array {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  return new Float64Array([
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ]);
}

// ─── 2D Kalman filter (image space) ──────────────────────────────────────────
class Kalman2D {
  s = new Float64Array(4);
  P = new Float64Array(16);
  private qBase: number;
  init = false;

  constructor(processNoise = 0.5) {
    this.qBase = processNoise;
    for (let i = 0; i < 4; i++) this.P[i * 5] = 1;
  }

  reset() {
    this.s.fill(0);
    this.P.fill(0);
    for (let i = 0; i < 4; i++) this.P[i * 5] = 1;
    this.init = false;
  }

  initialize(x: number, y: number) {
    this.s[0] = x; this.s[1] = y; this.s[2] = 0; this.s[3] = 0;
    this.init = true;
  }

  /** qScale multiplies base process noise — use >1 when moving fast. */
  predict(dt: number, qScale = 1) {
    if (!this.init) return;
    this.s[0] += this.s[2] * dt;
    this.s[1] += this.s[3] * dt;
    const F = new Float64Array(16);
    F[0] = 1; F[5] = 1; F[10] = 1; F[15] = 1;
    F[2] = dt; F[7] = dt;
    const q = this.qBase * qScale;
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt2 * dt2;
    const Q = new Float64Array(16);
    Q[0] = q * dt4 / 4; Q[5] = q * dt4 / 4;
    Q[2] = q * dt3 / 2; Q[7] = q * dt3 / 2;
    Q[8] = q * dt3 / 2; Q[13] = q * dt3 / 2;
    Q[10] = q * dt2; Q[15] = q * dt2;
    const Ft = matT(F, 4);
    this.P = matAdd(matMul(matMul(F, this.P, 4), Ft, 4), Q, 4);
  }

  update(zx: number, zy: number, mNoise: number) {
    if (!this.init) return;
    const s00 = this.P[0] + mNoise, s01 = this.P[1];
    const s10 = this.P[4], s11 = this.P[5] + mNoise;
    const [si00, si01, si10, si11] = inv2(s00, s01, s10, s11);
    const K = new Float64Array(8);
    for (let i = 0; i < 4; i++) {
      const p0 = this.P[i * 4 + 0], p1 = this.P[i * 4 + 1];
      K[i * 2 + 0] = p0 * si00 + p1 * si10;
      K[i * 2 + 1] = p0 * si01 + p1 * si11;
    }
    const y0 = zx - this.s[0], y1 = zy - this.s[1];
    this.s[0] += K[0] * y0 + K[1] * y1;
    this.s[1] += K[2] * y0 + K[3] * y1;
    this.s[2] += K[4] * y0 + K[5] * y1;
    this.s[3] += K[6] * y0 + K[7] * y1;
    for (let i = 0; i < 4; i++) {
      const kh0 = K[i * 2 + 0], kh1 = K[i * 2 + 1];
      for (let j = 0; j < 4; j++) {
        this.P[i * 4 + j] -= kh0 * this.P[0 * 4 + j] + kh1 * this.P[1 * 4 + j];
      }
    }
  }

  get x() { return this.s[0]; }
  get y() { return this.s[1]; }
  get vx() { return this.s[2]; }
  get vy() { return this.s[3]; }
  get speed() { return Math.hypot(this.s[2], this.s[3]); }
  get uncertainty() { return this.P[0] + this.P[5]; }
}

// ─── 3D Kalman filter (world space, meters) ──────────────────────────────────
class Kalman3D {
  s = new Float64Array(6);
  P = new Float64Array(36);
  private qBase: number;
  init = false;

  constructor(processNoise = 0.02) {
    this.qBase = processNoise;
    for (let i = 0; i < 6; i++) this.P[i * 7] = 1;
  }

  reset() {
    this.s.fill(0);
    this.P.fill(0);
    for (let i = 0; i < 6; i++) this.P[i * 7] = 1;
    this.init = false;
  }

  initialize(x: number, y: number, z: number) {
    this.s[0] = x; this.s[1] = y; this.s[2] = z;
    this.s[3] = 0; this.s[4] = 0; this.s[5] = 0;
    this.init = true;
  }

  predict(dt: number, qScale = 1) {
    if (!this.init) return;
    this.s[0] += this.s[3] * dt;
    this.s[1] += this.s[4] * dt;
    this.s[2] += this.s[5] * dt;
    const F = new Float64Array(36);
    for (let i = 0; i < 6; i++) F[i * 7] = 1;
    F[3] = dt; F[10] = dt; F[17] = dt;
    const q = this.qBase * qScale;
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt2 * dt2;
    const Q = new Float64Array(36);
    Q[0] = q * dt4 / 4; Q[7] = q * dt4 / 4; Q[14] = q * dt4 / 4;
    Q[3] = q * dt3 / 2; Q[10] = q * dt3 / 2; Q[17] = q * dt3 / 2;
    Q[18] = q * dt3 / 2; Q[25] = q * dt3 / 2; Q[32] = q * dt3 / 2;
    Q[21] = q * dt2; Q[28] = q * dt2; Q[35] = q * dt2;
    const Ft = matT(F, 6);
    this.P = matAdd(matMul(matMul(F, this.P, 6), Ft, 6), Q, 6);
  }

  update(zx: number, zy: number, zz: number, mNoise: number) {
    if (!this.init) return;
    const S = new Float64Array([
      this.P[0] + mNoise, this.P[1], this.P[2],
      this.P[6], this.P[7] + mNoise, this.P[8],
      this.P[12], this.P[13], this.P[14] + mNoise,
    ]);
    const Si = inv3(S);
    const K = new Float64Array(18);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += this.P[i * 6 + k] * Si[k * 3 + j];
        K[i * 3 + j] = sum;
      }
    }
    const y0 = zx - this.s[0], y1 = zy - this.s[1], y2 = zz - this.s[2];
    for (let i = 0; i < 6; i++) {
      this.s[i] += K[i * 3 + 0] * y0 + K[i * 3 + 1] * y1 + K[i * 3 + 2] * y2;
    }
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        this.P[i * 6 + j] -=
          K[i * 3 + 0] * this.P[0 * 6 + j] +
          K[i * 3 + 1] * this.P[1 * 6 + j] +
          K[i * 3 + 2] * this.P[2 * 6 + j];
      }
    }
  }

  get x() { return this.s[0]; }
  get y() { return this.s[1]; }
  get z() { return this.s[2]; }
  get speed() { return Math.hypot(this.s[3], this.s[4], this.s[5]); }
  get uncertainty() { return this.P[0] + this.P[7] + this.P[14]; }
}

// ─── FootEstimator ───────────────────────────────────────────────────────────
export interface FootEstimatorResult {
  imgX: number; imgY: number;
  worldX: number; worldY: number; worldZ: number;
  /** 0–1 confidence (1 = direct high-vis observation, 0 = invalid) */
  confidence: number;
  wasEstimated: boolean;
  wasObserved: boolean;
  /** How many consecutive frames the toe has been occluded */
  occlusionStreak: number;
}

export interface OcclusionStats {
  leftOcc: number;
  rightOcc: number;
  leftEst: number;
  rightEst: number;
  /** Longest continuous occlusion streak (frames) */
  leftMaxStreak: number;
  rightMaxStreak: number;
  /** Number of discrete occlusion events */
  leftEvents: number;
  rightEvents: number;
}

export class FootEstimator {
  private kf2d = new Kalman2D(0.5);
  private kf3d = new Kalman3D(0.02);
  private prevTime = 0;

  // Calibrated foot geometry
  private footVec2dX = 0;
  private footVec2dY = 0;
  private footVec3dX = 0;
  private footVec3dY = 0;
  private footVec3dZ = 0;
  private footLength3d = 0;
  private footCalibrated = false;
  private footCalibSamples = 0;

  // Occlusion accounting
  private totalFrames = 0;
  private occludedFrameCount = 0;
  private estimatedFrameCount = 0;
  private currentStreak = 0;
  private maxStreak = 0;
  private occlusionEvents = 0;
  private wasOccluded = false;

  // Re-acquisition blending
  private reacquireFrames = 0;

  // Ankle velocity tracking (for velocity-aware kinematic chain)
  private prevAnkleX = 0;
  private prevAnkleY = 0;
  private prevAnkleTime = 0;
  private ankleVelX = 0;
  private ankleVelY = 0;

  private result: FootEstimatorResult = {
    imgX: 0, imgY: 0, worldX: 0, worldY: 0, worldZ: 0,
    confidence: 0, wasEstimated: false, wasObserved: false, occlusionStreak: 0,
  };

  get occlusionPercent() {
    return this.totalFrames > 0 ? Math.round((this.occludedFrameCount / this.totalFrames) * 100) : 0;
  }
  get estimatedPercent() {
    return this.totalFrames > 0 ? Math.round((this.estimatedFrameCount / this.totalFrames) * 100) : 0;
  }
  get maxOcclusionStreak() { return this.maxStreak; }
  get occlusionEventCount() { return this.occlusionEvents; }

  reset() {
    this.kf2d.reset();
    this.kf3d.reset();
    this.prevTime = 0;
    this.footVec2dX = this.footVec2dY = 0;
    this.footVec3dX = this.footVec3dY = this.footVec3dZ = 0;
    this.footLength3d = 0;
    this.footCalibrated = false;
    this.footCalibSamples = 0;
    this.totalFrames = this.occludedFrameCount = this.estimatedFrameCount = 0;
    this.currentStreak = this.maxStreak = this.occlusionEvents = 0;
    this.wasOccluded = false;
    this.reacquireFrames = 0;
    this.prevAnkleX = this.prevAnkleY = this.prevAnkleTime = 0;
    this.ankleVelX = this.ankleVelY = 0;
    this.result = { imgX: 0, imgY: 0, worldX: 0, worldY: 0, worldZ: 0, confidence: 0, wasEstimated: false, wasObserved: false, occlusionStreak: 0 };
  }

  update(
    toeImg: { x: number; y: number } | undefined,
    toeW: { x: number; y: number; z?: number } | undefined,
    toeVis: number,
    ankleImg: { x: number; y: number } | undefined,
    ankleW: { x: number; y: number; z?: number } | undefined,
    ankleVis: number,
    now: number,
  ): FootEstimatorResult {
    const dt = this.prevTime > 0 ? Math.min((now - this.prevTime) / 1000, 0.1) : 0.016;
    this.prevTime = now;
    this.totalFrames++;

    const toeVisible = !!toeImg && toeVis >= 0.3;
    const ankleVisible = !!ankleImg && ankleVis >= 0.3;

    // ── Track ankle velocity (image space) ──
    if (ankleVisible && ankleImg) {
      if (this.prevAnkleTime > 0) {
        const adt = Math.max((now - this.prevAnkleTime) / 1000, 0.001);
        const avx = (ankleImg.x - this.prevAnkleX) / adt;
        const avy = (ankleImg.y - this.prevAnkleY) / adt;
        this.ankleVelX = this.ankleVelX * 0.6 + avx * 0.4;
        this.ankleVelY = this.ankleVelY * 0.6 + avy * 0.4;
      }
      this.prevAnkleX = ankleImg.x;
      this.prevAnkleY = ankleImg.y;
      this.prevAnkleTime = now;
    }

    // ── Adaptive process noise: scale with estimated speed ──
    const speed2d = this.kf2d.speed;
    const qScale2d = 1 + Math.min(speed2d * 8, 8);
    const speed3d = this.kf3d.speed;
    const qScale3d = 1 + Math.min(speed3d * 30, 8);

    this.kf2d.predict(dt, qScale2d);
    if (toeW) this.kf3d.predict(dt, qScale3d);

    let wasEstimated = false;
    let wasObserved = false;
    let confidence = 0;

    if (toeVisible && toeImg) {
      // ── Direct observation ──
      wasObserved = true;
      confidence = Math.min(1, toeVis);

      // Re-acquisition: if we just came out of an occlusion, use higher
      // measurement noise for a few frames so the filter doesn't snap.
      const mNoise2d = this.reacquireFrames > 0 ? 0.0015 : 0.0002;
      if (this.reacquireFrames > 0) this.reacquireFrames--;

      if (!this.kf2d.init) this.kf2d.initialize(toeImg.x, toeImg.y);
      this.kf2d.update(toeImg.x, toeImg.y, mNoise2d);

      if (toeW) {
        const tz = toeW.z ?? 0;
        const mNoise3d = this.reacquireFrames > 0 ? 0.003 : 0.0005;
        if (!this.kf3d.init) this.kf3d.initialize(toeW.x, toeW.y, tz);
        this.kf3d.update(toeW.x, toeW.y, tz, mNoise3d);
      }

      // ── Calibrate foot vector ──
      if (ankleVisible && ankleImg && ankleW) {
        const dvx = toeImg.x - ankleImg.x;
        const dvy = toeImg.y - ankleImg.y;
        if (!this.footCalibrated || this.footCalibSamples < 30) {
          const alpha = this.footCalibrated ? 0.1 : 1;
          this.footVec2dX = this.footVec2dX * (1 - alpha) + dvx * alpha;
          this.footVec2dY = this.footVec2dY * (1 - alpha) + dvy * alpha;
          this.footVec3dX = this.footVec3dX * (1 - alpha) + (toeW!.x - ankleW.x) * alpha;
          this.footVec3dY = this.footVec3dY * (1 - alpha) + (toeW!.y - ankleW.y) * alpha;
          this.footVec3dZ = this.footVec3dZ * (1 - alpha) + ((toeW!.z ?? 0) - (ankleW.z ?? 0)) * alpha;
          this.footCalibSamples++;
          if (this.footCalibSamples >= 15) {
            this.footLength3d = Math.hypot(this.footVec3dX, this.footVec3dY, this.footVec3dZ);
            this.footCalibrated = true;
          }
        } else {
          // Slow EMA update
          this.footVec2dX = this.footVec2dX * 0.97 + dvx * 0.03;
          this.footVec2dY = this.footVec2dY * 0.97 + dvy * 0.03;
          const fvx = toeW!.x - ankleW.x;
          const fvy = toeW!.y - ankleW.y;
          const fvz = (toeW!.z ?? 0) - (ankleW.z ?? 0);
          this.footVec3dX = this.footVec3dX * 0.97 + fvx * 0.03;
          this.footVec3dY = this.footVec3dY * 0.97 + fvy * 0.03;
          this.footVec3dZ = this.footVec3dZ * 0.97 + fvz * 0.03;
          const fl = Math.hypot(this.footVec3dX, this.footVec3dY, this.footVec3dZ);
          if (fl > 0.001) {
            const scale = this.footLength3d / fl;
            this.footVec3dX *= scale;
            this.footVec3dY *= scale;
            this.footVec3dZ *= scale;
          }
          this.footLength3d = this.footLength3d * 0.99 + fl * 0.01;
        }
      }

      // Occlusion event bookkeeping
      if (this.wasOccluded) {
        this.reacquireFrames = 5;
      }
      this.currentStreak = 0;
      this.wasOccluded = false;
    } else {
      // ── Toe occluded ──
      this.occludedFrameCount++;
      this.currentStreak++;
      this.maxStreak = Math.max(this.maxStreak, this.currentStreak);
      if (!this.wasOccluded) this.occlusionEvents++;
      this.wasOccluded = true;

      if (ankleVisible && ankleImg && this.footCalibrated) {
        // ── Velocity-aware kinematic chain ──
        // The toe moves with the ankle; add the ankle's velocity contribution
        // over one frame so a rapidly moving/reaching foot is predicted ahead
        // of the rigid ankle+vector position.
        wasEstimated = true;
        this.estimatedFrameCount++;

        const estX = ankleImg.x + this.footVec2dX + this.ankleVelX * dt * 0.5;
        const estY = ankleImg.y + this.footVec2dY + this.ankleVelY * dt * 0.5;

        if (!this.kf2d.init) this.kf2d.initialize(estX, estY);
        // Noise grows with occlusion duration — trust the motion model more over time
        const mNoise2d = 0.004 + this.currentStreak * 0.0008;
        this.kf2d.update(estX, estY, Math.min(mNoise2d, 0.02));

        if (ankleW) {
          const ex = ankleW.x + this.footVec3dX;
          const ey = ankleW.y + this.footVec3dY;
          const ez = (ankleW.z ?? 0) + this.footVec3dZ;
          if (!this.kf3d.init) this.kf3d.initialize(ex, ey, ez);
          const mNoise3d = 0.004 + this.currentStreak * 0.0008;
          this.kf3d.update(ex, ey, ez, Math.min(mNoise3d, 0.02));
        }

        // Confidence: starts at 0.55, decays with streak length
        confidence = Math.max(0.12, 0.55 - this.currentStreak * 0.025);
      } else {
        // ── Full occlusion — Kalman prediction only ──
        wasEstimated = true;
        this.estimatedFrameCount++;
        confidence = Math.max(0, 0.35 - this.currentStreak * 0.035);
      }
    }

    this.result.imgX = this.kf2d.x;
    this.result.imgY = this.kf2d.y;
    this.result.worldX = this.kf3d.x;
    this.result.worldY = this.kf3d.y;
    this.result.worldZ = this.kf3d.z;
    this.result.confidence = confidence;
    this.result.wasEstimated = wasEstimated;
    this.result.wasObserved = wasObserved;
    this.result.occlusionStreak = this.currentStreak;

    return this.result;
  }

  get resultValue() { return this.result; }
  get has3D() { return this.kf3d.init; }
}
