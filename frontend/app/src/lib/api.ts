// Thin REST client for the NestJS backend (Group A — Auth, Group B — Accounts,
// Group C — Stations & provinces). Handles JWT persistence, the Authorization
// header, and a one-shot refresh on 401 so an expired access token is
// transparently rotated mid-session.

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

const API_BASE = (
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '');

const ACCESS_KEY = 'fws_access_token';
const REFRESH_KEY = 'fws_refresh_token';

// ---------------------------------------------------------------------------
// Backend response shapes (mirror auth.service / users.service).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Token storage (localStorage so a refresh survives a page reload).
// ---------------------------------------------------------------------------

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Error type — carries the HTTP status so callers can branch (401/403/409…).
// ---------------------------------------------------------------------------

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
      // Reset on the next tick so callers awaiting this promise still read it.
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

  // Transparent token rotation: refresh once, then replay the original request.
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

// ---------------------------------------------------------------------------
// Group A — Authentication.
// ---------------------------------------------------------------------------

export async function apiLogin(username: string, password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
  setTokens(data.access_token, data.refresh_token);
  return data;
}

/** Revoke the refresh token server-side (if any), then drop local tokens. */
export async function apiLogout(): Promise<void> {
  const rt = getRefreshToken();
  try {
    // refresh_token is @IsJWT() — only call when we actually hold one.
    if (rt) await request<void>('/auth/logout', { method: 'POST', body: { refresh_token: rt } });
  } catch {
    // Logout is best-effort; clear locally regardless.
  } finally {
    clearTokens();
  }
}

export const apiMe = () => request<AuthUser>('/auth/me');

// ---------------------------------------------------------------------------
// Group B — Accounts & RBAC (Admin-only on the server).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Group C — Stations & provinces.
// Response rows reuse the shared `Station` / `ProvinceRef` / `Threshold` types
// (they mirror the backend contract). The list endpoint includes thresholds
// (batched server-side); geom/boundary are never sent.
// ---------------------------------------------------------------------------

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
 * GET /stations/viewport — stations inside the current map BBOX. The server
 * runs a GIST-indexed ST_MakeEnvelope/ST_Contains, so the result set is bounded
 * by what's on screen (one request, no paging) — far lighter than
 * apiListAllStations as the map zooms in. Rows are risk-ordered server-side.
 * `riskStatus` optionally filters; `limit` caps the rows for a fully zoomed-out
 * view (defaults to the server cap).
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
 * Fetch every matching station across pages (the server caps `size` at 100 and
 * has no viewport/bbox param yet). Used by the map, which needs all points to
 * cluster client-side. Interim approach — fine at seed scale, heavy at 10k+;
 * replace with a bbox endpoint when one exists. `maxStations` is a safety cap.
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

// station_code is immutable — only name/coords/elevation are updatable.
export const apiUpdateStation = (id: number, dto: UpdateStationPayload) =>
  request<Station>(`/stations/${id}`, { method: 'PUT', body: dto });

export const apiDeleteStation = (id: number) =>
  request<void>(`/stations/${id}`, { method: 'DELETE' });

export const apiSetStationThresholds = (id: number, thresholds: ThresholdInput[]) =>
  request<Threshold[]>(`/stations/${id}/thresholds`, { method: 'PUT', body: { thresholds } });

export const apiListProvinces = () => request<ProvinceRef[]>('/provinces');

// ---------------------------------------------------------------------------
// Group F — third-party weather integration.
//   • Healthcheck (API 35) is Admin-only on the server.
//   • Manual refresh + job status (APIs 31–32) are Operator/Admin.
// ---------------------------------------------------------------------------

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

export interface RefreshWeatherPayload {
  stationIds?: number[];
  provinceIds?: number[];
  source?: string;
}

/** API 31 — POST /weather/refresh → 202 { jobId }. Throws ApiError 429 if a
 *  refresh is already in flight (the in-flight jobId rides along on the error). */
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

// ---------------------------------------------------------------------------
// Group G — Risk engine read side (APIs 36–39). All read-only, Viewer+.
//   • 36 GET /risk/stations              — paginated at-risk stations
//   • 37 GET /forecasts/provinces/{id}   — province forecast series
//   • 38 GET /forecasts/stations/{id}    — station forecast series (classified)
//   • 39 GET /stations/{id}/alert-history — paginated alert history
// Response shapes mirror risk.service.ts; risk_score is on the 0–100 scale.
// ---------------------------------------------------------------------------

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
