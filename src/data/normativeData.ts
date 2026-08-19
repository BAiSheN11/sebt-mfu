/**
 * Normative reference data for SEBT / YBT.
 *
 * Primary source:
 *   Y Balance Test (YBT) Dataset — University College Dublin / MLG
 *   407 subjects, 7,262 trials, ground-truth reach distances measured on YBT platform.
 *   http://mlg.ucd.ie/ybt/
 *   Published in: Sustainability 2021, 13(21), 12165. PMC8587552.
 *
 *   Raw reach (cm) from the paper:
 *     Anterior:       59.65 ± 6.73 cm   (leg length 96.6–96.9 cm)
 *     Posteromedial: 104.63 ± 8.66 cm
 *     Posterolateral:100.27 ± 9.10 cm
 *   Normalized to leg length (mean ≈ 96.75 cm):
 *     ANT ≈ 0.617 ± 0.070
 *     PM  ≈ 1.082 ± 0.090
 *     PL  ≈ 1.036 ± 0.094
 *
 * Remaining 5 SEBT directions from pooled SEBT literature
 * (Hertel 2000, Gribble & Hertel 2003, Olmsted et al. 2002, Plisky et al. 2006):
 *   healthy adult composite reach ≈ 85–95% leg length, direction-specific below.
 *
 * Limb Symmetry Index (LSI) threshold:
 *   >4 cm or >4% side-to-side asymmetry is considered clinically relevant
 *   (Plisky et al. 2006; Gribble et al. 2012).
 */

export interface NormativeValue {
  mean: number;   // normalized reach (reach / leg length)
  sd: number;     // standard deviation
  source: 'ybt-dataset' | 'sebt-literature';
}

export const NORMATIVE_REACH: Record<string, NormativeValue> = {
  anterior:        { mean: 0.617, sd: 0.070, source: 'ybt-dataset' },
  anterolateral:   { mean: 0.770, sd: 0.080, source: 'sebt-literature' },
  lateral:         { mean: 0.720, sd: 0.080, source: 'sebt-literature' },
  posterolateral:  { mean: 1.036, sd: 0.094, source: 'ybt-dataset' },
  posterior:       { mean: 0.980, sd: 0.090, source: 'sebt-literature' },
  posteromedial:   { mean: 1.082, sd: 0.090, source: 'ybt-dataset' },
  medial:          { mean: 0.900, sd: 0.085, source: 'sebt-literature' },
  anteromedial:    { mean: 0.940, sd: 0.085, source: 'sebt-literature' },
};

/** Limb Symmetry Index threshold (fraction, e.g. 0.04 = 4%) */
export const LSI_THRESHOLD = 0.04;

export interface Zones {
  deficient: number;  // below mean - 1 SD
  normal_low: number; // mean - 1 SD
  normal_high: number; // mean + 1 SD
  excellent: number;  // above mean + 1 SD
}

export function getZones(key: string): Zones {
  const n = NORMATIVE_REACH[key];
  return {
    deficient: n.mean - n.sd,
    normal_low: n.mean - n.sd,
    normal_high: n.mean + n.sd,
    excellent: n.mean + n.sd,
  };
}

/** z-score: how many SDs from population mean */
export function zScore(reachRatio: number, key: string): number {
  const n = NORMATIVE_REACH[key];
  if (!n || n.sd === 0) return 0;
  return (reachRatio - n.mean) / n.sd;
}

export type ClinicalBand = 'below-average' | 'average' | 'above-average';

export function clinicalBand(reachRatio: number, key: string): ClinicalBand {
  const z = zScore(reachRatio, key);
  if (z < -1) return 'below-average';
  if (z > 1) return 'above-average';
  return 'average';
}

/** Percentile estimate assuming normal distribution */
export function percentileEstimate(reachRatio: number, key: string): number {
  const z = zScore(reachRatio, key);
  // Approximation of normal CDF
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.round(p * 100);
}

function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export const DATASET_CITATION = {
  name: 'Y Balance Test (YBT) Dataset',
  institution: 'University College Dublin — Machine Learning Group',
  subjects: 407,
  trials: 7262,
  url: 'http://mlg.ucd.ie/ybt/',
  paper: 'Scoring Performance on the Y-Balance Test Using a Deep Learning Approach. Sustainability 2021, 13(21), 12165.',
};
