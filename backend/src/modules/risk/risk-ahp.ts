/**
 * Analytic Hierarchy Process (Saaty, 1980) — a pure, dependency-free engine that
 * derives hazard weights from an interpretable judgment ("river stage is ~N× as
 * important as rainfall") instead of magic constants, with a consistency check.
 * Generic over criteria count, so sub-criteria can be added later.
 *
 * Pipeline: judgments → reciprocal matrix → priority vector (row geometric mean) →
 * consistency (λmax → CI → CR vs Saaty's RI). CR < 0.10 is accepted; a 1–2 criteria
 * matrix is consistent by construction (CR = 0).
 */

/**
 * Saaty's 1–9 scale: `a(i,j)` means "i is <anchor> more important than j", the
 * reverse being its reciprocal. Intermediate values and fractions are allowed.
 */
export const SAATY = {
  EQUAL: 1,
  EQUAL_TO_MODERATE: 2,
  MODERATE: 3,
  MODERATE_TO_STRONG: 4,
  STRONG: 5,
  STRONG_TO_VERY_STRONG: 6,
  VERY_STRONG: 7,
  VERY_TO_EXTREME: 8,
  EXTREME: 9,
} as const;

/** Saaty's Random Index by matrix order n; normalizes CI into the scale-free CR. */
const RANDOM_INDEX: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0.58,
  4: 0.9,
  5: 1.12,
  6: 1.24,
  7: 1.32,
  8: 1.41,
  9: 1.45,
  10: 1.49,
};

/** Saaty's acceptance threshold: CR below this is consistent enough. */
export const MAX_ACCEPTABLE_CR = 0.1;

/** Square reciprocal matrix; `m[i][j]` = importance of i over j. */
export type PairwiseMatrix = number[][];

/** One upper-triangle judgment: criterion `i` is `a`× as important as `j`. */
export interface Judgment {
  i: number;
  j: number;
  a: number;
}

export interface AhpResult {
  /** Priority vector (criterion weights); sums to 1. */
  weights: number[];
  lambdaMax: number;
  /** Consistency Index = (λmax − n)/(n − 1). */
  ci: number;
  /** Consistency Ratio = CI / RI(n). */
  cr: number;
  consistent: boolean;
}

/** Build an n×n reciprocal matrix from upper-triangle judgments (a(j,i) = 1/a). */
export function reciprocalMatrix(n: number, judgments: Judgment[]): PairwiseMatrix {
  const m: PairwiseMatrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 1),
  );
  for (const { i, j, a } of judgments) {
    if (i < 0 || j < 0 || i >= n || j >= n || i === j) {
      throw new Error(`Invalid AHP judgment index (${i},${j}) for n=${n}`);
    }
    if (!(a > 0) || !Number.isFinite(a)) {
      throw new Error(`AHP judgment a(${i},${j}) must be a positive finite number`);
    }
    m[i][j] = a;
    m[j][i] = 1 / a;
  }
  return m;
}

/**
 * Priority vector by row geometric mean (normalized to sum 1) — Saaty's principal-
 * eigenvector approximation, exact for a consistent matrix.
 */
export function priorityVector(m: PairwiseMatrix): number[] {
  const n = m.length;
  const geo = m.map((row) => Math.pow(row.reduce((p, x) => p * x, 1), 1 / n));
  const sum = geo.reduce((a, b) => a + b, 0);
  return geo.map((g) => g / sum);
}

/**
 * Consistency of a matrix given its priority vector: λmax = mean of (A·w)_i / w_i,
 * then CI/CR per Saaty. Large n falls back to the largest tabulated RI.
 */
export function consistency(
  m: PairwiseMatrix,
  w: number[],
): { lambdaMax: number; ci: number; cr: number; consistent: boolean } {
  const n = m.length;
  const aw = m.map((row) => row.reduce((s, x, j) => s + x * w[j], 0));
  const lambdaMax = aw.reduce((s, v, i) => s + v / w[i], 0) / n;
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[n] ?? 1.49;
  const cr = ri > 0 ? ci / ri : 0;
  return { lambdaMax, ci, cr, consistent: cr < MAX_ACCEPTABLE_CR };
}

/** Run the full AHP pipeline over a reciprocal matrix. */
export function ahp(m: PairwiseMatrix): AhpResult {
  const weights = priorityVector(m);
  const { lambdaMax, ci, cr, consistent } = consistency(m, weights);
  return { weights, lambdaMax, ci, cr, consistent };
}

/** Build the matrix from judgments and run AHP in one call. */
export function ahpFromJudgments(n: number, judgments: Judgment[]): AhpResult {
  return ahp(reciprocalMatrix(n, judgments));
}
