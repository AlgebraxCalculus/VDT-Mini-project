/**
 * Redis key for the Risk Engine single-flight lock. The internal event bus
 * delivers WEATHER_SNAPSHOT to *every* API instance; this lock ensures only one
 * instance runs a full recompute per snapshot, so the work isn't duplicated
 * across the cluster (SET … NX PX, same pattern as the weather refresh lock).
 */
export const RISK_RECOMPUTE_LOCK_KEY = 'risk:recompute:lock';

/** How long the full-recompute lock is held before auto-expiry (ms). */
export const RISK_RECOMPUTE_LOCK_TTL_MS = 5 * 60 * 1000;

/** Forecast horizon for the risk timeline (days from today), per the 5–7 day spec. */
export const RISK_HORIZON_DAYS = 7;

/** Rows per INSERT for station_risk_assessments to stay within parameter limits. */
export const ASSESSMENT_CHUNK = 500;
