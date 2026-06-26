/**
 * Internal event channels carried over Redis Pub/Sub. These are the "event-driven"
 * backbone from the design: the three triggers publish here, the Risk Engine
 * (future) consumes + recomputes, then publishes RISK_DELTA back, which the
 * realtime gateway forwards to the matching viewport rooms.
 */
export const EVENT_CHANNELS = {
  /** A station's flood thresholds changed → Risk Engine must recompute it. */
  THRESHOLD_CHANGED: 'risk.threshold-changed',
  /** A disaster event was closed → map/risk for its scope must refresh. */
  EVENT_CLOSED: 'event.closed',
  /** Scope was assigned to an event → recompute risk for the affected stations. */
  EVENT_SCOPE_ASSIGNED: 'event.scope-assigned',
  /** A new weather snapshot landed → rerun the whole risk assessment. */
  WEATHER_SNAPSHOT: 'weather.snapshot',
  /** Risk Engine output: a per-station risk change to push to clients (≤1s). */
  RISK_DELTA: 'risk.delta',
} as const;

export interface ThresholdChangedPayload {
  stationId: number;
}

export interface EventClosedPayload {
  eventId: string;
}

export interface EventScopeAssignedPayload {
  eventId: string;
  stationIds: number[];
}

export interface WeatherSnapshotPayload {
  snapshotId: string;
  sourceCode: string;
}

/**
 * One station's recomputed risk. Carries coordinates so the gateway can route it
 * to the right viewport room(s) without a DB lookup on the hot path.
 */
export interface RiskDeltaPayload {
  stationId: number;
  riskStatus: string | null;
  severity?: string | null;
  lng: number;
  lat: number;
}

/** Maps each channel to its payload type for compile-time safety. */
export type EventPayloadMap = {
  [EVENT_CHANNELS.THRESHOLD_CHANGED]: ThresholdChangedPayload;
  [EVENT_CHANNELS.EVENT_CLOSED]: EventClosedPayload;
  [EVENT_CHANNELS.EVENT_SCOPE_ASSIGNED]: EventScopeAssignedPayload;
  [EVENT_CHANNELS.WEATHER_SNAPSHOT]: WeatherSnapshotPayload;
  [EVENT_CHANNELS.RISK_DELTA]: RiskDeltaPayload;
};

export type EventChannel = keyof EventPayloadMap;
