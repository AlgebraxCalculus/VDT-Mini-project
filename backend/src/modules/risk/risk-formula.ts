import { RiskSeverity } from './entities/station-risk-assessment.entity';
import { RiskStatus } from '../stations/entities/station.entity';
import { ahpFromJudgments, AhpResult, SAATY } from './risk-ahp';

/**
 * Pure four-layer flood-risk model (design Phần 6), split from the service so the
 * math is I/O-free and testable. Layers: 1 normalize R/V/E to [0,1] → 2 weighted
 * hazard → risk_score [0,100] → 3 severity/alert banding + hard gate → 4 reason.
 */

/** Hazard weights, normalized so rain + river = 1 (see {@link normalizeWeights}). */
export interface RiskWeights {
  rain: number;
  river: number;
}

/** AHP-weighted hazard criteria; elevation is a separate multiplier, not weighted. */
export const HAZARD_CRITERIA = ['rain', 'river'] as const;
const RAIN = 0;
const RIVER = 1;

/**
 * How many times more important river stage is than local rainfall: the river level
 * is the proximate, integrated flood indicator, rainfall a leading but absorbable
 * signal. Default Saaty 2 (weakly more important); tunable via `RISK_AHP_RIVER_VS_RAIN`.
 */
export const DEFAULT_RIVER_VS_RAIN_JUDGMENT: number = SAATY.EQUAL_TO_MODERATE;

/** Per-group hazard weights, each summing to 1. See {@link deriveWeightProfiles}. */
export interface RiskWeightProfiles {
  /** Stations with ≥1 water-level tier: full rain-vs-river AHP. */
  river: RiskWeights;
  /** Tier-less stations: river non-applicable (V≡0), so rain carries all weight. */
  rainOnly: RiskWeights;
}

export type StationGroupKey = keyof RiskWeightProfiles;

/** AHP profiles plus audit trail (judgment + consistency) for logging. */
export interface RiskWeightDerivation {
  profiles: RiskWeightProfiles;
  riverGroupAhp: AhpResult;
  riverVsRainJudgment: number;
}

/**
 * Derive per-group weights from one judgment. River group: 2-criteria AHP over
 * {rain, river} (2×2 matrix is consistent, CR=0). Rain-only group: river is
 * non-applicable, so rain=1/river=0 — structural, and avoids capping the score at ~w_rain·R.
 */
export function deriveWeightProfiles(riverVsRainJudgment: number): RiskWeightDerivation {
  const j =
    Number.isFinite(riverVsRainJudgment) && riverVsRainJudgment > 0
      ? riverVsRainJudgment
      : DEFAULT_RIVER_VS_RAIN_JUDGMENT;

  // a(rain, river) = 1/j since river is judged j× as important as rain.
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

/** Profiles for the default judgment. */
export const DEFAULT_RISK_WEIGHT_PROFILES: RiskWeightProfiles =
  deriveWeightProfiles(DEFAULT_RIVER_VS_RAIN_JUDGMENT).profiles;

/** Reference weights for a river-monitored station (default judgment). */
export const DEFAULT_RISK_WEIGHTS: RiskWeights = DEFAULT_RISK_WEIGHT_PROFILES.river;

/** One flood-threshold tier, ascending by alert level (I/II/III). */
export interface ThresholdTier {
  alertLevel: number;
  thresholdValue: number;
}

/** Normalized [0,1] inputs plus raw values for the reason string. */
export interface RiskComponents {
  R: number;
  V: number;
  E: number;
  /** Rolling 24h / 3-day rainfall totals (mm). */
  rain24h: number;
  rain3day: number;
  /** River level for V and the hard gate (m), if known. */
  riverLevel: number | null;
}

/** Per-day verdict written to one `station_risk_assessments` row. */
export interface RiskVerdict {
  riskScore: number;
  severity: RiskSeverity;
  /** 0 = no alert; 1 Chú ý, 2 Cảnh báo, 3 Nguy hiểm. */
  alertLevel: number;
  isExceeded: boolean;
  predictedWaterLevel: number | null;
  /** Threshold the hard gate matched (copied, not referenced). */
  thresholdValue: number | null;
  reason: string;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Normalize a weight pair so rain + river = 1. */
export function normalizeWeights(w: RiskWeights): RiskWeights {
  const total = w.rain + w.river;
  if (total <= 0) return { ...DEFAULT_RISK_WEIGHTS };
  return { rain: w.rain / total, river: w.river / total };
}

/** Station with ≥1 water-level tier is river-monitored, else rain-driven. */
export function classifyStationGroup(tiers: ThresholdTier[]): StationGroupKey {
  return tiers.length > 0 ? 'river' : 'rainOnly';
}

export function weightsForStation(
  tiers: ThresholdTier[],
  profiles: RiskWeightProfiles,
): RiskWeights {
  return profiles[classifyStationGroup(tiers)];
}

// --- Layer 1 — normalize inputs to [0, 1] ---

/**
 * R — rainfall index. Forecast data is daily-granular so the sub-daily 3h window is
 * dropped: P = max(P_24h/100, P_3day/200). `rain3day` is the day plus two prior days.
 */
export function rainIndex(rain24h: number, rain3day: number): number {
  const p = Math.max(rain24h / 100, rain3day / 200);
  return clamp01(p);
}

/**
 * V — river index, piecewise-linear against the station's báo động I/II/III tiers:
 * each band maps to an even [k/n, (k+1)/n] slice, top tier → 1. No tiers or no
 * reading → 0 (rainfall then drives the score).
 */
export function riverIndex(
  riverLevel: number | null,
  tiers: ThresholdTier[],
): number {
  if (riverLevel == null) return 0;
  const sorted = [...tiers].sort((a, b) => a.thresholdValue - b.thresholdValue);
  if (sorted.length === 0) return 0;

  // Band edges [0, t1, t2, ...] with V anchors [0, 1/n, 2/n, ..., 1].
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
 * E — elevation index, normalized against p10/p90 within the same province/basin:
 * E = clamp((p90 − elevation)/(p90 − p10), 0, 1). Lowest station → ≈1, highest → ≈0.
 * Missing/degenerate inputs → neutral 0.5.
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

// --- Layer 2 — weighted hazard → risk_score ∈ [0, 100] ---

/**
 * risk_score = 100 · (w_R·R + w_V·V) · (0.5 + 0.5·E). Elevation is a vulnerability
 * multiplier in [0.5, 1.0]: high station (E≈0) gets a 50% discount, low takes full hazard.
 */
export function riskScore(c: RiskComponents, weights: RiskWeights): number {
  const hazard = weights.rain * c.R + weights.river * c.V;
  const score = 100 * hazard * (0.5 + 0.5 * c.E);
  return Math.round(score * 100) / 100; // fits DECIMAL(5,2)
}

// --- Layer 3 — severity / alert_level banding + hard threshold gate ---

/** Score → (severity, alert_level) band per the design table. */
function classifyScore(score: number): { severity: RiskSeverity; level: number } {
  if (score < 30) return { severity: RiskSeverity.LOW, level: 0 };
  if (score < 60) return { severity: RiskSeverity.MEDIUM, level: 1 };
  if (score < 80) return { severity: RiskSeverity.HIGH, level: 2 };
  return { severity: RiskSeverity.HIGH, level: 3 };
}

/**
 * Hard gate: if the predicted level reaches tier k, force is_exceeded and alert ≥ k,
 * regardless of score, so a physical exceedance is never masked. Returns the highest
 * matched tier and its threshold.
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

// --- Layer 4 — reason string ---

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

// --- Top-level assembly ---

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
  // A physical exceedance can't read LOW.
  let severity = band.severity;
  if (isExceeded && severity === RiskSeverity.LOW) severity = RiskSeverity.MEDIUM;

  return {
    riskScore: score,
    severity,
    alertLevel,
    isExceeded,
    predictedWaterLevel: c.riverLevel,
    // Gate's matched threshold, else the top configured tier.
    thresholdValue:
      gate.threshold ??
      (tiers.length
        ? Math.max(...tiers.map((t) => t.thresholdValue))
        : null),
    reason: buildReason(c, score, alertLevel),
  };
}

/** Per-day alert level → station-level {@link RiskStatus} (worst over the 5–7 day horizon). */
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

/** Ordinal for comparing RiskStatus values (escalation detection). */
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
