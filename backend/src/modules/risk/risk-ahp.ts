/**
 * Analytic Hierarchy Process (Saaty, 1980) — a small, pure, dependency-free
 * implementation used to *derive* the hazard weights from explicit pairwise
 * importance judgments instead of hand-picked constants.
 *
 * Why AHP here: the rain/river hazard weights used to be magic numbers (0.4/0.6).
 * AHP lets us instead state an interpretable domain judgment — "the river stage is
 * ~N times as important as local rainfall for flooding" — and mechanically derive
 * normalized weights that are *consistency-checked*. The engine is generic (works
 * for any number of criteria) so elevation or rainfall sub-criteria can later be
 * folded in as a proper hierarchy without changing the math.
 *
 * Pipeline: pairwise judgments → reciprocal matrix → priority vector (row
 * geometric mean, the standard AHP approximation, exact for consistent matrices)
 * → consistency check (λmax → CI → CR against Saaty's Random Index). CR < 0.10 is
 * Saaty's acceptance threshold; a 1- or 2-criteria matrix is consistent by
 * construction (CR = 0).
 */

/**
 * Saaty's 1–9 fundamental scale with its verbal anchors. A judgment `a(i,j)` on
 * this scale means "criterion i is <anchor> more important than criterion j";
 * the reverse comparison is its reciprocal. Intermediate values (2,4,6,8) and
 * fractions are permitted — the scale is guidance, not a hard enum.
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

/**
 * Saaty's Random Index (RI): the average consistency index of large samples of
 * randomly generated reciprocal matrices, indexed by matrix order n. Used to
 * normalize CI into the scale-free CR. Orders 1–2 are always consistent (RI = 0).
 */
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

/** Saaty's acceptance threshold: judgments with CR below this are "consistent enough". */
export const MAX_ACCEPTABLE_CR = 0.1;

/** A square reciprocal pairwise-comparison matrix; `m[i][j]` = importance of i over j. */
export type PairwiseMatrix = number[][];

/** One pairwise judgment for the upper triangle: criterion `i` is `a`× as important as `j`. */
export interface Judgment {
  i: number;
  j: number;
  a: number;
}

/** Outcome of one AHP run over a criteria set. */
export interface AhpResult {
  /** Priority vector (criterion weights); sums to 1, same order as the matrix. */
  weights: number[];
  /** Principal eigenvalue estimate. */
  lambdaMax: number;
  /** Consistency Index = (λmax − n)/(n − 1). */
  ci: number;
  /** Consistency Ratio = CI / RI(n). */
  cr: number;
  /** Whether CR is within Saaty's acceptance threshold. */
  consistent: boolean;
}

/**
 * Assemble an n×n reciprocal matrix from upper-triangle judgments. The diagonal is
 * 1; every stated `a(i,j)` sets its reciprocal `a(j,i) = 1/a` automatically, which
 * guarantees the matrix is reciprocal (a precondition of AHP).
 */
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
 * Priority vector via the row geometric-mean method: w_i = geomean(row_i) then
 * normalize to sum 1. This is Saaty's recommended approximation of the principal
 * eigenvector and is exact when the matrix is perfectly consistent.
 */
export function priorityVector(m: PairwiseMatrix): number[] {
  const n = m.length;
  const geo = m.map((row) => Math.pow(row.reduce((p, x) => p * x, 1), 1 / n));
  const sum = geo.reduce((a, b) => a + b, 0);
  return geo.map((g) => g / sum);
}

/**
 * Consistency of a judgment matrix given its priority vector. λmax is estimated as
 * the mean of (A·w)_i / w_i; CI/CR follow Saaty. Falls back to the largest tabulated
 * RI for very large n (keeps CR defined rather than throwing).
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

/** Convenience: build the matrix from judgments and run AHP in one call. */
export function ahpFromJudgments(n: number, judgments: Judgment[]): AhpResult {
  return ahp(reciprocalMatrix(n, judgments));
}
