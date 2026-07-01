import { RiskSeverity } from './entities/station-risk-assessment.entity';
import { RiskStatus } from '../stations/entities/station.entity';
import { ahpFromJudgments, AhpResult, SAATY } from './risk-ahp';

/**
 * Pure, side-effect-free implementation of the four-layer flood-risk model
 * (design PDF, Phần 6). Kept separate from {@link RiskEngineService} so the math
 * is independently testable and free of I/O:
 *
 *   Layer 1 — normalize each input to [0, 1]:  R (rain), V (river), E (elevation)
 *   Layer 2 — weighted hazard → risk_score ∈ [0, 100]
 *   Layer 3 — severity / alert_level banding + the hard threshold gate
 *   Layer 4 — human-readable reason string
 *
 * The functions take already-resolved numbers (the service does the SQL/aggregation
 * and percentile lookups); nothing here touches the DB.
 */

/** Hazard weights (Layer 2). Normalized so wRain + wRiver = 1 (see {@link normalizeWeights}). */
export interface RiskWeights {
  rain: number;
  river: number;
}

/**
 * Hazard criteria for the Layer-2 weighting, in AHP matrix order. Only these two
 * are AHP-weighted; elevation stays a separate vulnerability multiplier (see
 * {@link riskScore}), not a weighted-sum criterion.
 */
export const HAZARD_CRITERIA = ['rain', 'river'] as const;
const RAIN = 0;
const RIVER = 1;

/**
 * The single domain judgment behind the river-group weights: how many times more
 * important the river stage is than local rainfall for flooding. Grounded in
 * hydrology — the river level is the proximate, integrated indicator (it already
 * embodies upstream rain + catchment runoff + antecedent wetness and *is* the
 * flood), whereas local rainfall is a leading but indirect signal that drainage
 * and soil can absorb. Default = Saaty "equal-to-moderate" (2): the river is
 * weakly more important than rain. Tunable via env `RISK_AHP_RIVER_VS_RAIN`.
 */
export const DEFAULT_RIVER_VS_RAIN_JUDGMENT: number = SAATY.EQUAL_TO_MODERATE;

/** Per-group hazard weights (Layer 2), each summing to 1. See {@link deriveWeightProfiles}. */
export interface RiskWeightProfiles {
  /** River-monitored stations (≥1 water-level tier): full rain-vs-river AHP. */
  river: RiskWeights;
  /** Tier-less stations: river is non-applicable (V≡0), so rain carries all weight. */
  rainOnly: RiskWeights;
}

/** The group a station is classified into. */
export type StationGroupKey = keyof RiskWeightProfiles;

/** AHP-derived profiles plus the audit trail (judgment + consistency) for logging. */
export interface RiskWeightDerivation {
  profiles: RiskWeightProfiles;
  /** The river-group AHP result (weights, λmax, CI, CR, consistent). */
  riverGroupAhp: AhpResult;
  /** The river-vs-rain judgment actually used (after the positive-finite guard). */
  riverVsRainJudgment: number;
}

/**
 * Derive the per-group hazard weights via AHP from one interpretable judgment.
 *
 *   • river group — a 2-criteria AHP over {rain, river}. Both signals apply, so the
 *     weights come straight from the priority vector (a 2×2 reciprocal matrix is
 *     consistent by construction, CR = 0).
 *   • rain-only group — for tier-less stations the river is a *non-applicable*
 *     criterion (riverIndex is always 0), so AHP runs over the single applicable
 *     criterion {rain}: its normalized priority is 1.0 and river gets 0.0. This is
 *     a structural fact (not a preference) and also stops such a station's score
 *     from being capped at ~w_rain·R.
 */
export function deriveWeightProfiles(riverVsRainJudgment: number): RiskWeightDerivation {
  const j =
    Number.isFinite(riverVsRainJudgment) && riverVsRainJudgment > 0
      ? riverVsRainJudgment
      : DEFAULT_RIVER_VS_RAIN_JUDGMENT;

  // a(rain, river) = 1/j because the river is judged j× as important as rain.
  const riverGroupAhp = ahpFromJudgments(HAZARD_CRITERIA.length, [
    { i: RAIN, j: RIVER, a: 1 / j },
  ]);

  return {
    profiles: {
      river: { rain: riverGroupAhp.weights[RAIN], river: riverGroupAhp.weights[RIVER] },
      rainOnly: { rain: 1, river: 0 },
    },
    riverGroupAhp,
    riverVsRainJudgment: j,
  };
}

/** Profiles for the default judgment — a convenient fallback for callers. */
export const DEFAULT_RISK_WEIGHT_PROFILES: RiskWeightProfiles =
  deriveWeightProfiles(DEFAULT_RIVER_VS_RAIN_JUDGMENT).profiles;

/** AHP-derived reference weights for a river-monitored station (the default judgment). */
export const DEFAULT_RISK_WEIGHTS: RiskWeights = DEFAULT_RISK_WEIGHT_PROFILES.river;

/** One flood-threshold tier for a station, ascending by alert level (I/II/III). */
export interface ThresholdTier {
  alertLevel: number;
  thresholdValue: number;
}

/** Normalized [0,1] inputs plus the raw values needed for the reason string. */
export interface RiskComponents {
  R: number;
  V: number;
  E: number;
  /** Rolling 24h / 3-day rainfall totals actually used for R (mm). */
  rain24h: number;
  rain3day: number;
  /** River water level used for V and the hard gate (m), if known. */
  riverLevel: number | null;
}

/** Final per-day risk verdict written to one `station_risk_assessments` row. */
export interface RiskVerdict {
  riskScore: number;
  severity: RiskSeverity;
  /** 0 = no alert; 1 = Chú ý, 2 = Cảnh báo, 3 = Nguy hiểm. */
  alertLevel: number;
  isExceeded: boolean;
  predictedWaterLevel: number | null;
  /** The tier threshold that the hard gate matched (copied, not referenced). */
  thresholdValue: number | null;
  reason: string;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Normalize a weight pair so the two hazard weights sum to 1 (Layer 2 requirement). */
export function normalizeWeights(w: RiskWeights): RiskWeights {
  const total = w.rain + w.river;
  if (total <= 0) return { ...DEFAULT_RISK_WEIGHTS };
  return { rain: w.rain / total, river: w.river / total };
}

/**
 * Classify a station into a weight group from its configured tiers: a station with
 * ≥1 water-level tier is river-monitored, otherwise it is rain-driven.
 */
export function classifyStationGroup(tiers: ThresholdTier[]): StationGroupKey {
  return tiers.length > 0 ? 'river' : 'rainOnly';
}

/** Resolve the (already-normalized) hazard weights for a station from its group. */
export function weightsForStation(
  tiers: ThresholdTier[],
  profiles: RiskWeightProfiles,
): RiskWeights {
  return profiles[classifyStationGroup(tiers)];
}

// ---------------------------------------------------------------------------
// Layer 1 — normalize inputs to [0, 1].
// ---------------------------------------------------------------------------

/**
 * R — rainfall index. The design uses three windows (3h/24h/3-day) mapped against
 * Vietnam rainfall thresholds (50mm = to, 100mm = rất to / 24h). Our forecast data
 * is daily-granular, so we drop the sub-daily 3h window and use:
 *
 *   P = max(P_24h / 100, P_3day / 200)
 *
 * `rain24h` is the given day's total; `rain3day` is that day plus the two prior
 * forecast days (the caller supplies the rolling sum).
 */
export function rainIndex(rain24h: number, rain3day: number): number {
  const p = Math.max(rain24h / 100, rain3day / 200);
  return clamp01(p);
}

/**
 * V — river index, "Cách B" (mapped against the station's configured báo động
 * I/II/III tiers from flood_thresholds). Piecewise-linear:
 *   below tier-1            → [0.00, 0.33)
 *   tier-1 → tier-2         → [0.33, 0.67)
 *   tier-2 → tier-3         → [0.67, 1.00)
 *   at/above the top tier   → 1.00
 *
 * Tolerates fewer than three tiers by spreading the available bands evenly. With
 * no tiers or no river reading, V = 0 (rainfall then drives the score).
 */
export function riverIndex(
  riverLevel: number | null,
  tiers: ThresholdTier[],
): number {
  if (riverLevel == null) return 0;
  const sorted = [...tiers].sort((a, b) => a.thresholdValue - b.thresholdValue);
  if (sorted.length === 0) return 0;

  // Build band edges: [0, t1, t2, ...] with matching V anchors [0, 1/n, 2/n, ..., 1].
  const edges = [0, ...sorted.map((t) => t.thresholdValue)];
  const n = sorted.length;
  if (riverLevel >= edges[edges.length - 1]) return 1;

  for (let i = 1; i < edges.length; i++) {
    if (riverLevel < edges[i]) {
      const lo = edges[i - 1];
      const hi = edges[i];
      const vLo = (i - 1) / n;
      const vHi = i / n;
      const frac = hi > lo ? (riverLevel - lo) / (hi - lo) : 0;
      return clamp01(vLo + frac * (vHi - vLo));
    }
  }
  return 1;
}

/**
 * E — elevation index, normalized *relative to other stations in the same
 * province/basin* so different reference frames don't mix (design Phần 6):
 *
 *   E = clamp((H_p90 − elevation) / (H_p90 − H_p10), 0, 1)
 *
 * Lowest station → E ≈ 1 (most flood-prone); highest → E ≈ 0. When percentiles
 * are missing/degenerate or the elevation is unknown, return a neutral 0.5 so a
 * station is neither unduly amplified nor exempted.
 */
export function elevationIndex(
  elevation: number | null,
  p10: number | null,
  p90: number | null,
): number {
  if (elevation == null || p10 == null || p90 == null) return 0.5;
  if (p90 <= p10) return 0.5;
  return clamp01((p90 - elevation) / (p90 - p10));
}

// ---------------------------------------------------------------------------
// Layer 2 — weighted hazard → risk_score ∈ [0, 100].
// ---------------------------------------------------------------------------

/**
 * Hazard = w_R·R + w_V·V; risk_score = 100 · Hazard · (0.5 + 0.5·E).
 * The elevation factor is a vulnerability multiplier in [0.5, 1.0]: a high station
 * (E≈0) gets a 50% discount, a low station (E≈1) takes the full hazard.
 */
export function riskScore(c: RiskComponents, weights: RiskWeights): number {
  const hazard = weights.rain * c.R + weights.river * c.V;
  const score = 100 * hazard * (0.5 + 0.5 * c.E);
  return Math.round(score * 100) / 100; // fits DECIMAL(5,2)
}

// ---------------------------------------------------------------------------
// Layer 3 — severity / alert_level banding + hard threshold gate.
// ---------------------------------------------------------------------------

/** Score → (severity, alert_level) band per the design table. */
function classifyScore(score: number): { severity: RiskSeverity; level: number } {
  if (score < 30) return { severity: RiskSeverity.LOW, level: 0 };
  if (score < 60) return { severity: RiskSeverity.MEDIUM, level: 1 };
  if (score < 80) return { severity: RiskSeverity.HIGH, level: 2 };
  return { severity: RiskSeverity.HIGH, level: 3 };
}

/**
 * Hard gate (cổng ngưỡng cứng): independent of the score, if the predicted water
 * level reaches a configured tier k, force is_exceeded and alert_level ≥ k. The
 * final alert_level is max(band, gate) so a physical exceedance is never masked
 * by a low score. Returns the matched (highest) tier and its threshold value.
 */
function hardGate(
  riverLevel: number | null,
  tiers: ThresholdTier[],
): { level: number; threshold: number | null } {
  if (riverLevel == null) return { level: 0, threshold: null };
  let level = 0;
  let threshold: number | null = null;
  for (const t of tiers) {
    if (riverLevel >= t.thresholdValue && t.alertLevel > level) {
      level = t.alertLevel;
      threshold = t.thresholdValue;
    }
  }
  return { level, threshold };
}

// ---------------------------------------------------------------------------
// Layer 4 — reason string.
// ---------------------------------------------------------------------------

function buildReason(
  c: RiskComponents,
  score: number,
  alertLevel: number,
): string {
  const parts: string[] = [];
  parts.push(`Mưa ${c.rain24h.toFixed(0)}mm/24h (R=${c.R.toFixed(2)})`);
  if (c.riverLevel != null) {
    parts.push(`mực nước sông ${c.riverLevel.toFixed(2)}m (V=${c.V.toFixed(2)})`);
  }
  parts.push(`độ cao tương đối (E=${c.E.toFixed(2)})`);
  const tier =
    alertLevel >= 3
      ? 'Nguy hiểm (cấp 3)'
      : alertLevel === 2
        ? 'Cảnh báo (cấp 2)'
        : alertLevel === 1
          ? 'Chú ý (cấp 1)'
          : 'dưới ngưỡng';
  return `${parts.join(' + ')} → risk_score ${score.toFixed(0)}, ${tier}.`;
}

// ---------------------------------------------------------------------------
// Top-level assembly.
// ---------------------------------------------------------------------------

/** Run all four layers for one station-day. */
export function assessRisk(
  c: RiskComponents,
  tiers: ThresholdTier[],
  weights: RiskWeights,
): RiskVerdict {
  const score = riskScore(c, weights);
  const band = classifyScore(score);
  const gate = hardGate(c.riverLevel, tiers);

  const alertLevel = Math.max(band.level, gate.level);
  const isExceeded = gate.level > 0;
  // Severity follows the score band, but a physical exceedance can't read LOW.
  let severity = band.severity;
  if (isExceeded && severity === RiskSeverity.LOW) severity = RiskSeverity.MEDIUM;

  return {
    riskScore: score,
    severity,
    alertLevel,
    isExceeded,
    predictedWaterLevel: c.riverLevel,
    // Prefer the gate's matched threshold; else the top configured tier (reference).
    thresholdValue:
      gate.threshold ??
      (tiers.length
        ? Math.max(...tiers.map((t) => t.thresholdValue))
        : null),
    reason: buildReason(c, score, alertLevel),
  };
}

/**
 * Map a per-day alert level to the station-level {@link RiskStatus} cached on the
 * station row + pushed in RISK_DELTA. The engine takes the worst level over the
 * 5–7 day horizon.
 */
export function alertLevelToRiskStatus(level: number): RiskStatus {
  switch (level) {
    case 3:
      return RiskStatus.DANGER;
    case 2:
      return RiskStatus.WARNING;
    case 1:
      return RiskStatus.WATCH;
    default:
      return RiskStatus.NORMAL;
  }
}

/** Ordinal for comparing two RiskStatus values (used to detect escalation). */
export function riskStatusRank(status: RiskStatus | null): number {
  switch (status) {
    case RiskStatus.DANGER:
      return 3;
    case RiskStatus.WARNING:
      return 2;
    case RiskStatus.WATCH:
      return 1;
    default:
      return 0;
  }
}
