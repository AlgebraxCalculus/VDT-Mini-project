export type Role = 'viewer' | 'operator' | 'admin';

export type RouteKey =
  | 'login'
  | 'map'
  | 'forecast'
  | 'stations'
  | 'import'
  | 'events'
  | 'accounts'
  | 'health';

export type WeatherLayerKey = 'temp' | 'rain' | 'radar' | 'wind';

export type MapLayout = 'A' | 'B' | 'C';

/** Cached real-time risk state — mirrors backend RiskStatus enum. */
export type RiskStatus = 'NORMAL' | 'WATCH' | 'WARNING' | 'DANGER';

/**
 * Severity bucket of a single risk assessment — mirrors backend RiskSeverity.
 * Banded from risk_score (0–100): <30 LOW, <60 MEDIUM, ≥60 HIGH.
 */
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Lightweight province reference (no boundary geometry — BE drops it). */
export interface ProvinceRef {
  id: number;
  code: string;
  name: string;
}

/** One flood-threshold tier; alertLevel 1=Chú ý, 2=Cảnh báo, 3=Nguy hiểm. */
export interface Threshold {
  alertLevel: 1 | 2 | 3;
  thresholdValue: number;
  label?: string | null;
}

/**
 * Per-station weather snapshot. NOT part of GET /stations — it comes from the
 * weather API. Optional so the Station shape mirrors the backend exactly; the
 * mock fills it so the existing UI keeps rendering before the merge.
 */
export interface StationWeather {
  temp: number;
  rain: number;
  wind: number;
  humid: number;
}

export interface Station {
  // ── Returned by GET /stations (Group C contract) ──────────────────────
  id: number; // numeric PK — use for CRUD URLs
  stationCode: string; // human code, e.g. "VTS-QT-081"
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  provinceId: number | null;
  province: ProvinceRef | null; // {id, code, name} — no boundary
  riskStatus: RiskStatus | null; // enum, not a numeric score
  thresholds: Threshold[]; // 0–3 tiers, must be read null-safe
  // ── Enrichment: separate APIs at merge, mock-only for now ──────────────
  weather?: StationWeather; // weather snapshot API
  riskScore?: number; // 0–100 metric — station_risk_assessments.risk_score (Group G)
  severity?: RiskSeverity; // peak severity in the forecast window (Group G)
}

// ───────────────────────────────────────────────────────────────────────────
// Group G — Risk & forecast read side (APIs 36–39). These mirror the backend
// response shapes exactly so the mock can be swapped for the real API at merge.
// ───────────────────────────────────────────────────────────────────────────

/**
 * One row of GET /risk/stations (API 36): a pre-computed assessment for a
 * station on a single forecast day, joined to its station/province. risk_score
 * is 0–100; eventId is a BIGINT string (or null).
 */
export interface RiskAssessment {
  id: string;
  stationId: number;
  eventId: string | null;
  forecastDate: string; // YYYY-MM-DD
  predictedWaterLevel: number | null;
  thresholdValue: number | null;
  isExceeded: boolean;
  severity: RiskSeverity | null;
  riskScore: number | null; // 0–100
  computedAt: string; // ISO timestamp
  station: Station;
}

/** One aggregated day in a forecast series (GET /forecasts/provinces/:id, API 37). */
export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  temperature: number | null;
  rainfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  riverWaterLevel: number | null;
}

/** A station forecast day enriched with its on-the-fly risk classification (API 38). */
export interface ClassifiedForecastPoint extends ForecastPoint {
  severity: RiskSeverity;
  alertLevel: number; // 0–3
  isExceeded: boolean;
  riskScore: number; // 0–100
}

/** One immutable triggered-alert record (GET /stations/:id/alert-history, API 39). */
export interface AlertHistoryEntry {
  id: string;
  stationId: number;
  eventId: string | null;
  alertLevel: number; // 1–3
  triggeredAt: string; // ISO timestamp
  actualValue: number | null;
  thresholdValue: number | null;
  reason: string | null;
  weatherSnapshotId: string | null;
  createdAt: string;
}

export interface ForecastDay {
  day: string;
  val: number;
  color: string;
  h: string;
}

export type EventState = 'draft' | 'active' | 'monitor' | 'closed';

export interface EventItem {
  id: string;
  name: string;
  type: string;
  sev: string;
  sevColor: string;
  state: EventState;
  start: string;
  end: string;
  provinces: string[];
  stations: number;
}

export interface Account {
  name: string;
  user: string;
  role: 'Admin' | 'Operator' | 'Viewer';
  roleColor: string;
  status: 'active' | 'locked';
  last: string;
}

export type ServiceHealth = 'ok' | 'slow' | 'err';

export interface ServiceStatus {
  name: string;
  desc: string;
  status: ServiceHealth;
  latency: string;
  uptime: string;
  last: string;
}

export interface BgJob {
  name: string;
  state: 'done' | 'running';
  time: string;
  info: string;
}

export interface ImportRow {
  row: number;
  id: string;
  name: string;
  prov: string;
  lat: string;
  lng: string;
  ok: boolean;
  msg: string;
}

export interface Notif {
  title: string;
  body: string;
  time: string;
  color: string;
  bg: string;
}

export interface StationDrawerForm {
  id: number | null; // numeric PK when editing; null when adding
  stationCode: string;
  name: string;
  lat: string;
  lng: string;
  elevation: string;
  // Province is auto-assigned server-side via ST_Contains — not entered here.
  // No operational status field: the backend stations table has none.
  th1: string;
  th2: string;
  th3: string;
}

export interface DrawerState {
  mode: 'add' | 'edit';
  s: StationDrawerForm;
}

export interface EventForm {
  name: string;
  type: string;
  sev: string;
  source: string;
  start: string;
  provinces: string[];
  note: string;
}

export interface AccountForm {
  name: string;
  user: string;
  email: string;
  password: string;
  role: Account['role'];
}

export type EventTab = 'active' | 'closed' | 'all';
