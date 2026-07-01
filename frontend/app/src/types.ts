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

/** Severity of a risk assessment, banded from risk_score: <30 LOW, <60 MEDIUM, ≥60 HIGH. */
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Province reference (no boundary geometry). */
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

/** Per-station weather snapshot (from the weather/map APIs, not GET /stations). */
export interface StationWeather {
  temp: number;
  rain: number;
  wind: number;
  humid: number;
}

export interface Station {
  // Returned by GET /stations (Group C):
  id: number;
  stationCode: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  provinceId: number | null;
  province: ProvinceRef | null;
  riskStatus: RiskStatus | null;
  thresholds: Threshold[]; // 0–3 tiers, read null-safe
  // Enrichment from separate APIs (weather/map/Group G):
  weather?: StationWeather;
  riskScore?: number; // 0–100
  severity?: RiskSeverity; // peak severity in the window
}

// --- Group G — Risk & forecast read side (APIs 36–39) ---

/** One row of GET /risk/stations (API 36): a pre-computed per-day assessment + station. */
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

export interface Account {
  name: string;
  user: string;
  role: 'Admin' | 'Operator' | 'Viewer';
  roleColor: string;
  status: 'active' | 'locked';
  last: string;
}

export interface StationDrawerForm {
  id: number | null; // null when adding
  stationCode: string;
  name: string;
  lat: string;
  lng: string;
  elevation: string;
  // Province is auto-assigned server-side; no status field on the backend table.
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
