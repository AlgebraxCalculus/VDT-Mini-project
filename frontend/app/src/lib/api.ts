// REST client for the NestJS backend: JWT persistence + a one-shot 401 refresh
// that transparently rotates an expired access token mid-session.

import type {
  AlertHistoryEntry,
  ClassifiedForecastPoint,
  ForecastPoint,
  ProvinceRef,
  RiskAssessment,
  RiskSeverity,
  RiskStatus,
  Station,
  Threshold,
} from '../types';

export const API_BASE = (
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '');

const ACCESS_KEY = 'fws_access_token';
const REFRESH_KEY = 'fws_refresh_token';

// --- Backend response shapes (mirror auth.service / users.service) ---

export type RoleCode = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
  role: RoleCode | null;
  permissions: string[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: string;
  user: AuthUser;
}

export interface ApiRole {
  id: number;
  code: RoleCode;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface ApiUser {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roleId: number | null;
  role: ApiRole | null;
}

export interface PaginatedUsers {
  data: ApiUser[];
  total: number;
  page: number;
  size: number;
}

export interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  fullName?: string;
  roleId: number;
}

// --- Token storage ---

export const getAccessToken = () =>
  sessionStorage.getItem(ACCESS_KEY) ?? localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () =>
  sessionStorage.getItem(REFRESH_KEY) ?? localStorage.getItem(REFRESH_KEY);

/**
 * Persist the token pair. `remember` picks the store: localStorage (survives restart)
 * vs sessionStorage (dropped on tab close) — the only effect of the "Ghi nhớ" toggle.
 * When omitted (the silent refresh) the current store is kept.
 */
function setTokens(access: string, refresh: string, remember?: boolean) {
  const useSession =
    remember === undefined
      ? sessionStorage.getItem(ACCESS_KEY) !== null
      : !remember;
  const target = useSession ? sessionStorage : localStorage;
  const other = useSession ? localStorage : sessionStorage;
  other.removeItem(ACCESS_KEY);
  other.removeItem(REFRESH_KEY);
  target.setItem(ACCESS_KEY, access);
  target.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

// --- Error type — carries the HTTP status so callers can branch ---

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach the access token (default true)
}

// Single in-flight refresh shared by concurrent 401s.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const rt = getRefreshToken();
      if (!rt) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) {
          clearTokens();
          return false;
        }
        const data = (await res.json()) as LoginResponse;
        setTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      // Reset next tick so awaiting callers still read the resolved value.
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  }
  return refreshing;
}

async function request<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được tới máy chủ. Kiểm tra API đã chạy chưa.');
  }

  // Refresh once, then replay the request.
  if (res.status === 401 && auth && retry && getRefreshToken()) {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, opts, false);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg = (data as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(msg) ? msg.join(', ') : msg ?? res.statusText;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- Group A — Authentication ---

export async function apiLogin(
  username: string,
  password: string,
  remember = true,
): Promise<LoginResponse> {
  const data = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
  setTokens(data.access_token, data.refresh_token, remember);
  return data;
}

/** Revoke the refresh token server-side (if any), then drop local tokens. */
export async function apiLogout(): Promise<void> {
  const rt = getRefreshToken();
  try {
    // refresh_token is @IsJWT() — only call when we hold one.
    if (rt) await request<void>('/auth/logout', { method: 'POST', body: { refresh_token: rt } });
  } catch {
    // Best-effort; clear locally regardless.
  } finally {
    clearTokens();
  }
}

export const apiMe = () => request<AuthUser>('/auth/me');

// --- Group B — Accounts & RBAC (Admin-only on the server) ---

export function apiListUsers(params: {
  role?: RoleCode;
  q?: string;
  page?: number;
  size?: number;
} = {}): Promise<PaginatedUsers> {
  const qs = new URLSearchParams();
  if (params.role) qs.set('role', params.role);
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 100));
  return request<PaginatedUsers>(`/users?${qs.toString()}`);
}

export const apiCreateUser = (dto: CreateUserPayload) =>
  request<ApiUser>('/users', { method: 'POST', body: dto });

export const apiUpdateUser = (id: number, dto: Partial<CreateUserPayload> & { isActive?: boolean }) =>
  request<ApiUser>(`/users/${id}`, { method: 'PATCH', body: dto });

export const apiDeleteUser = (id: number) =>
  request<void>(`/users/${id}`, { method: 'DELETE' });

export const apiChangeRole = (id: number, roleId: number) =>
  request<ApiUser>(`/users/${id}/role`, { method: 'PUT', body: { roleId } });

export const apiListRoles = () => request<ApiRole[]>('/roles');

// --- Group C — Stations & provinces (geom/boundary never sent) ---

export interface PaginatedStations {
  data: Station[];
  total: number;
  page: number;
  size: number;
}

export interface ThresholdInput {
  alertLevel: 1 | 2 | 3;
  thresholdValue: number;
  label?: string;
}

export interface CreateStationPayload {
  stationCode: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  thresholds?: ThresholdInput[];
}

export interface UpdateStationPayload {
  name?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

export interface ListStationsParams {
  provinceId?: number;
  riskStatus?: RiskStatus;
  eventId?: string;
  q?: string;
  page?: number;
  size?: number;
}

export function apiListStations(params: ListStationsParams = {}): Promise<PaginatedStations> {
  const qs = new URLSearchParams();
  if (params.provinceId != null) qs.set('provinceId', String(params.provinceId));
  if (params.riskStatus) qs.set('riskStatus', params.riskStatus);
  if (params.eventId) qs.set('eventId', params.eventId);
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  return request<PaginatedStations>(`/stations?${qs.toString()}`);
}

export const apiGetStation = (id: number) => request<Station>(`/stations/${id}`);

export interface ViewportBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * GET /stations/viewport — stations inside the map BBOX (one request, no paging),
 * risk-ordered server-side. `riskStatus` filters; `limit` caps the rows.
 */
export function apiListStationsInViewport(
  bounds: ViewportBounds,
  params: { riskStatus?: RiskStatus; limit?: number } = {},
): Promise<Station[]> {
  const qs = new URLSearchParams();
  qs.set('minLng', String(bounds.minLng));
  qs.set('minLat', String(bounds.minLat));
  qs.set('maxLng', String(bounds.maxLng));
  qs.set('maxLat', String(bounds.maxLat));
  if (params.riskStatus) qs.set('riskStatus', params.riskStatus);
  if (params.limit != null) qs.set('limit', String(params.limit));
  return request<Station[]>(`/stations/viewport?${qs.toString()}`);
}

/**
 * Fetch every matching station across pages (server caps `size` at 100). Fallback
 * for callers needing all points; heavy at 10k+. `maxStations` is a safety cap.
 */
export async function apiListAllStations(
  params: Omit<ListStationsParams, 'page' | 'size'> = {},
  maxStations = 5000,
): Promise<Station[]> {
  const size = 100;
  const all: Station[] = [];
  for (let page = 1; all.length < maxStations; page++) {
    const res = await apiListStations({ ...params, page, size });
    all.push(...res.data);
    if (res.data.length === 0 || all.length >= res.total) break;
  }
  return all;
}

export const apiCreateStation = (dto: CreateStationPayload) =>
  request<Station>('/stations', { method: 'POST', body: dto });

// station_code is immutable — only name/coords/elevation update.
export const apiUpdateStation = (id: number, dto: UpdateStationPayload) =>
  request<Station>(`/stations/${id}`, { method: 'PUT', body: dto });

export const apiDeleteStation = (id: number) =>
  request<void>(`/stations/${id}`, { method: 'DELETE' });

export const apiSetStationThresholds = (id: number, thresholds: ThresholdInput[]) =>
  request<Threshold[]>(`/stations/${id}/thresholds`, { method: 'PUT', body: { thresholds } });

// --- Group C — bulk import (APIs 18–19). Multipart upload → async BullMQ job ---

/** One skipped row in the import report (mirrors backend ImportRowError). */
export interface ImportRowError {
  row: number;
  stationCode: string;
  message: string;
}

/** Final report from the import job (API 19, when the job completes). */
export interface ImportReport {
  total: number;
  success: number;
  failed: number;
  errors: ImportRowError[];
  truncatedErrors: boolean;
}

/** Job state + progress + report (mirrors backend StationImportService.getStatus). */
export interface ImportStatus {
  jobId: string;
  state: string;
  progress: number; // 0–100
  report: ImportReport | null;
  failedReason: string | null;
}

/**
 * API 18 — POST /stations/import (multipart). Bypasses `request` (which forces JSON)
 * so the browser sets the multipart boundary; mirrors its one-shot 401 refresh.
 */
export async function apiImportStations(file: File): Promise<{ jobId: string }> {
  const send = async (): Promise<Response> => {
    const form = new FormData();
    form.append('file', file);
    const token = getAccessToken();
    return fetch(`${API_BASE}/stations/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && getRefreshToken() && (await tryRefresh())) {
      res = await send();
    }
  } catch {
    throw new ApiError(0, 'Không kết nối được tới máy chủ. Kiểm tra API đã chạy chưa.');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(msg) ? msg.join(', ') : msg ?? res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as { jobId: string };
}

/** API 19 — GET /stations/import/{jobId}. */
export const apiGetImportJob = (jobId: string) =>
  request<ImportStatus>(`/stations/import/${jobId}`);

export const apiListProvinces = () => request<ProvinceRef[]>('/provinces');

// --- Group D — Disaster events (auto-tracked from GDACS; operator can override scope) ---

/** Backend EventStatus — the only two lifecycle states. */
export type EventStatus = 'ONGOING' | 'CLOSED';

export interface ApiDisasterType {
  id: number;
  code: string; // STORM / FLOOD …
  name: string;
}

/** One row of GET /events (API 20/21) — mirrors EventWithScope. */
export interface ApiEvent {
  id: string; // BIGINT as string
  eventCode: string; // e.g. GDACS-TC1000810
  disasterTypeId: number;
  disasterType: ApiDisasterType | null;
  name: string;
  status: EventStatus;
  startTime: string; // ISO
  endTime: string | null;
  description: string | null;
  createdBy: number | null; // null for auto-ingested events
  provinceCount: number;
  stationCount: number;
}

export interface PaginatedEvents {
  data: ApiEvent[];
  total: number;
  page: number;
  size: number;
}

export interface ListEventsParams {
  status?: EventStatus;
  page?: number;
  size?: number;
}

/** API 20 — GET /events. */
export function apiListEvents(params: ListEventsParams = {}): Promise<PaginatedEvents> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  return request<PaginatedEvents>(`/events?${qs.toString()}`);
}

export interface EventScopeProvince {
  id: number;
  code: string;
  name: string;
}

/** One station in an event's scope (mirrors EventScope.stations.data). */
export interface EventScopeStation {
  id: number;
  stationCode: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  riskStatus: RiskStatus | null;
  provinceName: string | null;
}

/** API 26 / 25 payload — the event's provinces + a paginated station list. */
export interface EventScope {
  provinces: EventScopeProvince[];
  stations: {
    data: EventScopeStation[];
    total: number;
    page: number;
    size: number;
  };
}

/** API 26 — GET /events/{id}/stations. */
export function apiGetEventStations(
  eventId: string,
  params: { page?: number; size?: number } = {},
): Promise<EventScope> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  return request<EventScope>(`/events/${eventId}/stations?${qs.toString()}`);
}

/** GeoJSON footprint accepted by API 25 (SRID 4326). */
export interface GeoJsonPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

/** Body for API 25 — at least one of provinceIds / affectedArea required. */
export interface AssignImpactPayload {
  provinceIds?: number[];
  affectedArea?: GeoJsonPolygon;
}

/** API 25 — POST /events/{id}/impact. (Re)assigns scope, replacing the auto-assigned one. */
export const apiAssignImpact = (eventId: string, body: AssignImpactPayload) =>
  request<EventScope>(`/events/${eventId}/impact`, { method: 'POST', body });

/** API 24 — POST /events/{id}/close. Closes an ONGOING event (Operator/Admin); 409 if already CLOSED. */
export const apiCloseEvent = (eventId: string, body: { endTime?: string } = {}) =>
  request<ApiEvent>(`/events/${eventId}/close`, { method: 'POST', body });

// --- Group E — Map / GIS by viewport BBOX (APIs 27–30), read-only ---

/** One grid-cell cluster (API 27, zoomed-out mode). */
export interface MapCluster {
  lng: number;
  lat: number;
  count: number;
  riskStatus: RiskStatus;
}

/** API 27 response — either individual enriched stations or clusters. */
export type MapStationsResult =
  | { clustered: false; zoom: number; stations: Station[] }
  | { clustered: true; zoom: number; clusters: MapCluster[] };

/** Drawable active event with its affected-area footprint as GeoJSON (API 28). */
export interface MapEvent {
  id: string;
  eventCode: string;
  name: string;
  status: EventStatus;
  disasterTypeCode: string | null;
  startTime: string;
  provinceCount: number;
  stationCount: number;
  affectedArea: GeoJsonPolygon | null;
}

export type WeatherOverlayLayer = 'rain' | 'wind' | 'temp';

/** One weather-overlay sample (API 29). `value` unit depends on the layer. */
export interface WeatherOverlayPoint {
  lat: number;
  lng: number;
  value: number;
}

export interface WeatherOverlayResult {
  layer: WeatherOverlayLayer;
  snapshotId: string | null;
  points: WeatherOverlayPoint[];
}

function bboxParams(b: ViewportBounds): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set('minLng', String(b.minLng));
  qs.set('minLat', String(b.minLat));
  qs.set('maxLng', String(b.maxLng));
  qs.set('maxLat', String(b.maxLat));
  return qs;
}

/**
 * API 27 — GET /map/stations. In-view stations enriched with risk + a light forecast;
 * the server clusters when `zoom` is below its threshold. Pass the live map zoom.
 */
export function apiGetMapStations(
  bounds: ViewportBounds,
  params: { zoom?: number; riskStatus?: RiskStatus; limit?: number } = {},
): Promise<MapStationsResult> {
  const qs = bboxParams(bounds);
  if (params.zoom != null) qs.set('zoom', String(params.zoom));
  if (params.riskStatus) qs.set('riskStatus', params.riskStatus);
  if (params.limit != null) qs.set('limit', String(params.limit));
  return request<MapStationsResult>(`/map/stations?${qs.toString()}`);
}

/** API 28 — GET /map/events. Defaults to ONGOING events intersecting the viewport. */
export function apiGetMapEvents(
  bounds: ViewportBounds,
  params: { status?: EventStatus } = {},
): Promise<MapEvent[]> {
  const qs = bboxParams(bounds);
  if (params.status) qs.set('status', params.status);
  return request<MapEvent[]>(`/map/events?${qs.toString()}`);
}

/** API 29 — GET /map/weather. Forecast field overlay points for the chosen layer. */
export function apiGetMapWeather(
  bounds: ViewportBounds,
  layer: WeatherOverlayLayer,
): Promise<WeatherOverlayResult> {
  const qs = bboxParams(bounds);
  qs.set('layer', layer);
  return request<WeatherOverlayResult>(`/map/weather?${qs.toString()}`);
}

/** API 30 — GET /map/stations/search. Free-text + risk filter within the viewport. */
export function apiSearchMapStations(
  bounds: ViewportBounds,
  params: { q?: string; riskStatus?: RiskStatus; limit?: number } = {},
): Promise<Station[]> {
  const qs = bboxParams(bounds);
  if (params.q) qs.set('q', params.q);
  if (params.riskStatus) qs.set('riskStatus', params.riskStatus);
  if (params.limit != null) qs.set('limit', String(params.limit));
  return request<Station[]>(`/map/stations/search?${qs.toString()}`);
}

// --- Group F — third-party weather integration (health Admin-only; refresh Operator/Admin) ---

/** One external source's last cached healthcheck — mirrors backend SourceHealth. */
export interface SourceHealth {
  code: string;
  configured: boolean;
  status: 'UP' | 'DOWN' | 'UNKNOWN';
  latencyMs: number | null;
  /** Rolling failure ratio since process start (0–1). */
  errorRate: number;
  error: string | null;
  checkedAt: string | null;
}

/** API 35 — GET /integrations/health. One row per external source (Admin-only). */
export const apiGetIntegrationsHealth = () =>
  request<SourceHealth[]>('/integrations/health');

/** POST /integrations/health/refresh (Admin-only) — probe every source now and return fresh results. */
export const apiRefreshIntegrationsHealth = () =>
  request<SourceHealth[]>('/integrations/health/refresh', { method: 'POST' });

/** One recent background job — mirrors backend RecentJob (system.types.ts). */
export interface RecentJob {
  id: string;
  queue: 'weather' | 'reports' | 'stations-import';
  name: string;
  state: 'active' | 'completed' | 'failed' | 'waiting' | 'delayed' | 'paused' | 'unknown';
  /** Numeric progress 0–100. */
  progress: number;
  attemptsMade: number;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
}

/** GET /system/jobs — recent BullMQ jobs across all queues, newest first (Admin-only). */
export const apiGetRecentJobs = () => request<RecentJob[]>('/system/jobs');

export interface RefreshWeatherPayload {
  stationIds?: number[];
  provinceIds?: number[];
  source?: string;
}

/** API 31 — POST /weather/refresh → 202 { jobId }. ApiError 429 if one is in flight. */
export const apiRefreshWeather = (body: RefreshWeatherPayload = {}) =>
  request<{ jobId: string }>('/weather/refresh', { method: 'POST', body });

export interface WeatherJobStatus {
  jobId: string;
  state: string;
  snapshotId: string | null;
  failedReason: string | null;
}

/** API 32 — GET /weather/refresh/{jobId}. */
export const apiGetWeatherJob = (jobId: string) =>
  request<WeatherJobStatus>(`/weather/refresh/${jobId}`);

// --- Group G — Risk engine read side (APIs 36–39), read-only; risk_score 0–100 ---

/** Sort key for GET /risk/stations — highest score first, or nearest in time. */
export type RiskSort = 'severity' | 'timeline';

export interface ListRiskStationsParams {
  /** Inclusive forecast-window bounds (YYYY-MM-DD); default [today, today+7]. */
  from?: string;
  to?: string;
  severity?: RiskSeverity;
  /** Include LOW-severity rows (default hidden). Ignored if `severity` is set. */
  includeLow?: boolean;
  provinceId?: number;
  /** disaster_events.id — BIGINT, sent as a numeric string. */
  eventId?: string;
  sort?: RiskSort;
  page?: number;
  size?: number;
}

export interface PaginatedRiskAssessments {
  data: RiskAssessment[];
  total: number;
  page: number;
  size: number;
}

export interface ProvinceForecast {
  provinceId: number;
  from: string;
  to: string;
  series: ForecastPoint[];
}

export interface StationForecast {
  stationId: number;
  from: string;
  to: string;
  series: ClassifiedForecastPoint[];
}

export interface PaginatedAlertHistory {
  data: AlertHistoryEntry[];
  total: number;
  page: number;
  size: number;
}

/** API 36 — GET /risk/stations. Excludes LOW unless `severity` is given. */
export function apiListRiskStations(
  params: ListRiskStationsParams = {},
): Promise<PaginatedRiskAssessments> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.severity) qs.set('severity', params.severity);
  if (params.includeLow) qs.set('includeLow', 'true');
  if (params.provinceId != null) qs.set('provinceId', String(params.provinceId));
  if (params.eventId) qs.set('eventId', params.eventId);
  if (params.sort) qs.set('sort', params.sort);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  return request<PaginatedRiskAssessments>(`/risk/stations?${qs.toString()}`);
}

/** API 37 — GET /forecasts/provinces/{id}. Optional date window. */
export function apiGetProvinceForecast(
  provinceId: number,
  params: { from?: string; to?: string } = {},
): Promise<ProvinceForecast> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ProvinceForecast>(`/forecasts/provinces/${provinceId}${suffix}`);
}

/** API 38 — GET /forecasts/stations/{id}. Each day classified server-side. */
export function apiGetStationForecast(
  stationId: number,
  params: { from?: string; to?: string } = {},
): Promise<StationForecast> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<StationForecast>(`/forecasts/stations/${stationId}${suffix}`);
}

/** API 39 — GET /stations/{id}/alert-history. Newest-first, paginated. */
export function apiGetStationAlertHistory(
  stationId: number,
  params: { page?: number; size?: number } = {},
): Promise<PaginatedAlertHistory> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  return request<PaginatedAlertHistory>(
    `/stations/${stationId}/alert-history?${qs.toString()}`,
  );
}

// --- Group H — report export (APIs 40–43): async render → poll → download; "PDF" = print the HTML ---

export type ReportKind = 'station-inventory' | 'risk-summary';
export type ReportFormat = 'csv' | 'html';

/** POST /reports body — same filters the StationsView list uses. */
export interface CreateReportPayload {
  kind?: ReportKind;
  format?: ReportFormat;
  provinceId?: number;
  q?: string;
  from?: string;
  to?: string;
}

/** Metadata the worker attaches once a report finishes (mirrors backend ReportMeta). */
export interface ReportMeta {
  kind: ReportKind;
  format: ReportFormat;
  filename: string;
  contentType: string;
  rowCount: number;
  byteSize: number;
  title: string;
}

/** API 42 — one report job's live state (mirrors backend ReportStatus). */
export interface ReportStatus {
  jobId: string;
  state: string;
  progress: number; // 0–100
  meta: ReportMeta | null;
  failedReason: string | null;
}

/** API 41 — one row of the recent-reports history. */
export interface ReportSummary {
  jobId: string;
  state: string;
  requestedAt: string | null;
  triggeredBy: number | null;
  params: {
    kind: ReportKind;
    format: ReportFormat;
    provinceId?: number;
    q?: string;
    from?: string;
    to?: string;
  };
  meta: ReportMeta | null;
}

/** API 40 — POST /reports. Enqueues the render job → { jobId, kind, format }. */
export const apiCreateReport = (body: CreateReportPayload) =>
  request<{ jobId: string; kind: ReportKind; format: ReportFormat }>('/reports', {
    method: 'POST',
    body,
  });

/** API 41 — GET /reports. */
export const apiListReports = () => request<ReportSummary[]>('/reports');

/** API 42 — GET /reports/{jobId}. */
export const apiGetReportJob = (jobId: string) =>
  request<ReportStatus>(`/reports/${jobId}`);

/**
 * API 43 — GET /reports/{jobId}/download. Returns the Blob + filename (from
 * Content-Disposition). Bypasses `request` (JSON-only) but mirrors its 401 refresh.
 */
export async function apiDownloadReport(
  jobId: string,
): Promise<{ blob: Blob; filename: string }> {
  const send = (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(`${API_BASE}/reports/${jobId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && getRefreshToken() && (await tryRefresh())) {
      res = await send();
    }
  } catch {
    throw new ApiError(0, 'Không kết nối được tới máy chủ. Kiểm tra API đã chạy chưa.');
  }

  if (!res.ok) {
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    const msg = (data as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(msg) ? msg.join(', ') : msg ?? res.statusText;
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const filename = match?.[1] ?? `bao-cao-${jobId}`;
  return { blob, filename };
}
