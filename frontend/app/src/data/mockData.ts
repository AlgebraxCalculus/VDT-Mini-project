import type {
  Account,
  AlertHistoryEntry,
  BgJob,
  ClassifiedForecastPoint,
  EventItem,
  ForecastDay,
  ImportRow,
  Notif,
  ProvinceRef,
  RiskSeverity,
  RiskStatus,
  ServiceStatus,
  Station,
  Threshold,
} from '../types';

// All risk scores are on the backend 0–100 scale (station_risk_assessments.
// risk_score). Band boundaries mirror the engine's classifier: 30 / 60 / 80.
export function band(r: number): [string, string] {
  if (r < 10) return ['Thấp', '#94A3B8'];
  if (r < 30) return ['Chú ý', '#16A34A'];
  if (r < 60) return ['Trung bình', '#EAB308'];
  if (r < 80) return ['Cao', '#F97316'];
  return ['Rất cao', '#EE0033'];
}

/**
 * Province registry (id/code/name) — mirrors the `provinces` table contract the
 * backend returns (minus boundary geometry). At merge these come from the DB;
 * here they back the station list filter and the search-by-province feature.
 */
export const PROVINCES: ProvinceRef[] = [
  { id: 1, code: 'HNI', name: 'Hà Nội' },
  { id: 2, code: 'HPG', name: 'Hải Phòng' },
  { id: 3, code: 'QNH', name: 'Quảng Ninh' },
  { id: 4, code: 'THA', name: 'Thanh Hóa' },
  { id: 5, code: 'NAN', name: 'Nghệ An' },
  { id: 6, code: 'HTH', name: 'Hà Tĩnh' },
  { id: 7, code: 'QBH', name: 'Quảng Bình' },
  { id: 8, code: 'QTR', name: 'Quảng Trị' },
  { id: 9, code: 'TTH', name: 'Thừa Thiên Huế' },
  { id: 10, code: 'DNG', name: 'Đà Nẵng' },
  { id: 11, code: 'QNM', name: 'Quảng Nam' },
  { id: 12, code: 'QNG', name: 'Quảng Ngãi' },
  { id: 13, code: 'BDH', name: 'Bình Định' },
  { id: 14, code: 'PYN', name: 'Phú Yên' },
  { id: 15, code: 'KHA', name: 'Khánh Hòa' },
  { id: 16, code: 'GLI', name: 'Gia Lai' },
  { id: 17, code: 'DLK', name: 'Đắk Lắk' },
  { id: 18, code: 'LDG', name: 'Lâm Đồng' },
  { id: 19, code: 'HCM', name: 'TP. Hồ Chí Minh' },
  { id: 20, code: 'CTO', name: 'Cần Thơ' },
  { id: 21, code: 'CMU', name: 'Cà Mau' },
];

const PROVINCE_BY_NAME: Record<string, ProvinceRef> = Object.fromEntries(
  PROVINCES.map((p) => [p.name, p]),
);

/** Label + colour for a RiskStatus enum value (replaces the old numeric band). */
export const RISK_META: Record<RiskStatus, { label: string; color: string }> = {
  NORMAL: { label: 'An toàn', color: '#16A34A' },
  WATCH: { label: 'Theo dõi', color: '#EAB308' },
  WARNING: { label: 'Cảnh báo', color: '#F97316' },
  DANGER: { label: 'Nguy hiểm', color: '#EE0033' },
};

export const riskMeta = (rs: RiskStatus | null) => RISK_META[rs ?? 'NORMAL'];

/** Read a threshold tier by alert level, null-safe (stations may have 0–3). */
export const thresholdAt = (thresholds: Threshold[], level: 1 | 2 | 3): number | null =>
  thresholds.find((t) => t.alertLevel === level)?.thresholdValue ?? null;

/**
 * Derive the RiskStatus enum from the 0–100 risk score — mirrors the engine's
 * classifyScore → alertLevel → RiskStatus chain (<30 NORMAL, <60 WATCH,
 * <80 WARNING, ≥80 DANGER).
 */
function statusFromScore(r: number): RiskStatus {
  if (r >= 80) return 'DANGER';
  if (r >= 60) return 'WARNING';
  if (r >= 30) return 'WATCH';
  return 'NORMAL';
}

/**
 * Derive the RiskSeverity bucket from the 0–100 risk score — mirrors the
 * engine's classifyScore (<30 LOW, <60 MEDIUM, ≥60 HIGH).
 */
function severityFromScore(r: number): RiskSeverity {
  if (r >= 60) return 'HIGH';
  if (r >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Map a 0–100 flood-risk score to its legend band (colour + label) — mirrors the
 * "Chỉ số rủi ro lũ" bands in FLOOD_LEGEND (<10 Thấp, 10–30 Chú ý, 30–60 Trung
 * bình, 60–80 Cao, ≥80 Rất cao). Used to colour the map dots by score.
 */
export function floodLevel(score: number): { color: string; label: string } {
  if (score >= 80) return { color: '#EE0033', label: 'Rất cao' };
  if (score >= 60) return { color: '#F97316', label: 'Cao' };
  if (score >= 30) return { color: '#EAB308', label: 'Trung bình' };
  if (score >= 10) return { color: '#16A34A', label: 'Chú ý' };
  return { color: '#94A3B8', label: 'Thấp' };
}

/**
 * Mock-only: a stable pseudo flood-risk score in [0,100) for a station, used until
 * the Risk Engine populates station_risk_assessments.risk_score (which the
 * viewport API will then surface as `riskScore`). Deterministic from the id so
 * colours stay put across refetches and all five legend bands are visible on the
 * map. Real `station.riskScore` always takes precedence over this.
 */
export function mockRiskScore(id: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 10000) / 100; // 0.00–99.99
}

// stationCode, name, province, lat, lng, riskScore, temp, rain, wind, humid
type RawStation = [string, string, string, number, number, number, number, number, number, number];

const STATIONS_RAW: RawStation[] = [
  ['VTS-HN-014', 'Trạm Cầu Giấy', 'Hà Nội', 21.03, 105.802, 2.1, 24, 0.4, 2.2, 72],
  ['VTS-HN-007', 'Trạm Hoàn Kiếm', 'Hà Nội', 21.028, 105.852, 1.4, 25, 0.0, 1.8, 68],
  ['VTS-HP-022', 'Trạm Hồng Bàng', 'Hải Phòng', 20.862, 106.683, 3.6, 23, 1.2, 3.4, 80],
  ['VTS-QN-031', 'Trạm Hạ Long', 'Quảng Ninh', 20.951, 107.075, 4.2, 22, 2.6, 4.1, 83],
  ['VTS-TH-045', 'Trạm Sầm Sơn', 'Thanh Hóa', 19.752, 105.903, 5.1, 23, 4.8, 5.0, 86],
  ['VTS-NA-052', 'Trạm Vinh', 'Nghệ An', 18.68, 105.681, 5.8, 24, 7.2, 5.6, 88],
  ['VTS-HT-061', 'Trạm Hà Tĩnh', 'Hà Tĩnh', 18.34, 105.901, 6.9, 23, 12.5, 6.8, 90],
  ['VTS-HT-066', 'Trạm Kỳ Anh', 'Hà Tĩnh', 18.082, 106.301, 7.4, 23, 16.0, 8.2, 92],
  ['VTS-QB-070', 'Trạm Đồng Hới', 'Quảng Bình', 17.472, 106.602, 8.1, 22, 21.4, 9.1, 94],
  ['VTS-QB-074', 'Trạm Ba Đồn', 'Quảng Bình', 17.752, 106.421, 7.2, 22, 15.2, 7.5, 91],
  ['VTS-QT-081', 'Trạm Đông Hà', 'Quảng Trị', 16.812, 107.101, 8.6, 22, 24.8, 10.4, 95],
  ['VTS-TTH-088', 'Trạm Huế', 'Thừa Thiên Huế', 16.463, 107.591, 7.8, 23, 18.6, 8.0, 93],
  ['VTS-DN-090', 'Trạm Hải Châu', 'Đà Nẵng', 16.06, 108.221, 6.4, 24, 10.8, 6.2, 89],
  ['VTS-QNa-097', 'Trạm Hội An', 'Quảng Nam', 15.88, 108.331, 6.1, 25, 9.4, 5.8, 88],
  ['VTS-QNa-099', 'Trạm Tam Kỳ', 'Quảng Nam', 15.572, 108.481, 5.6, 25, 7.0, 5.2, 87],
  ['VTS-QNg-104', 'Trạm Quảng Ngãi', 'Quảng Ngãi', 15.12, 108.8, 5.9, 25, 8.2, 5.5, 87],
  ['VTS-BD-112', 'Trạm Quy Nhơn', 'Bình Định', 13.782, 109.219, 4.3, 27, 3.0, 4.0, 82],
  ['VTS-PY-118', 'Trạm Tuy Hòa', 'Phú Yên', 13.096, 109.301, 3.8, 28, 2.0, 3.6, 80],
  ['VTS-KH-124', 'Trạm Nha Trang', 'Khánh Hòa', 12.238, 109.196, 2.6, 29, 0.6, 2.8, 76],
  ['VTS-GL-131', 'Trạm Pleiku', 'Gia Lai', 13.983, 108.0, 3.1, 22, 1.4, 3.0, 78],
  ['VTS-DL-138', 'Trạm Buôn Ma Thuột', 'Đắk Lắk', 12.68, 108.05, 2.4, 24, 0.8, 2.6, 75],
  ['VTS-LD-142', 'Trạm Đà Lạt', 'Lâm Đồng', 11.94, 108.439, 1.8, 19, 0.2, 2.2, 70],
  ['VTS-HCM-160', 'Trạm Quận 1', 'TP. Hồ Chí Minh', 10.776, 106.7, 2.2, 31, 0.0, 2.4, 73],
  ['VTS-CT-175', 'Trạm Ninh Kiều', 'Cần Thơ', 10.033, 105.783, 3.4, 30, 1.0, 3.2, 81],
  ['VTS-CM-188', 'Trạm Cà Mau', 'Cà Mau', 9.182, 105.15, 4.0, 30, 2.2, 3.8, 84],
];

const ELEV: Record<string, number> = {
  'VTS-HN-014': 9,
  'VTS-HN-007': 6,
  'VTS-HP-022': 4,
  'VTS-QN-031': 6,
  'VTS-TH-045': 3,
  'VTS-NA-052': 7,
  'VTS-HT-061': 5,
  'VTS-HT-066': 4,
  'VTS-QB-070': 4,
  'VTS-QB-074': 8,
  'VTS-QT-081': 5,
  'VTS-TTH-088': 7,
  'VTS-DN-090': 6,
  'VTS-QNg-104': 9,
  'VTS-BD-112': 5,
  'VTS-PY-118': 6,
  'VTS-KH-124': 5,
  'VTS-GL-131': 758,
  'VTS-DL-138': 502,
  'VTS-LD-142': 1495,
  'VTS-HCM-160': 5,
  'VTS-CT-175': 2,
  'VTS-CM-188': 1,
};

function computeStations(): Station[] {
  return STATIONS_RAW.map((s, i) => {
    // Raw scores are authored on a 0–10 scale; lift to the backend 0–100 scale.
    const score = Math.round(s[5] * 10);
    // River-level thresholds (metres) — independent of the risk score.
    const base = s[5] >= 7 ? 7.5 : s[5] >= 5 ? 7.0 : 6.5;
    const thresholds: Threshold[] = [
      { alertLevel: 1, thresholdValue: +(base - 2).toFixed(1), label: 'Chú ý' },
      { alertLevel: 2, thresholdValue: +base.toFixed(1), label: 'Cảnh báo' },
      { alertLevel: 3, thresholdValue: +(base + 1.3).toFixed(1), label: 'Nguy hiểm' },
    ];
    const province = PROVINCE_BY_NAME[s[2]] ?? null;
    return {
      id: i + 1,
      stationCode: s[0],
      name: s[1],
      latitude: s[3],
      longitude: s[4],
      elevation: ELEV[s[0]] ?? 8,
      provinceId: province?.id ?? null,
      province,
      riskStatus: statusFromScore(score),
      thresholds,
      weather: { temp: s[6], rain: s[7], wind: s[8], humid: s[9] },
      riskScore: score,
      severity: severityFromScore(score),
    };
  });
}

export const STATIONS: Station[] = computeStations();

export function forecast7d(base: number): ForecastDay[] {
  const days = ['T6', 'T7', 'CN', 'T2', 'T3', 'T4', 'T5'];
  let v = base;
  const out: ForecastDay[] = [];
  for (let i = 0; i < 7; i++) {
    v = Math.max(4, Math.min(100, v + Math.sin(i * 1.3) * 16 + (i === 2 ? 14 : 0) - (i > 4 ? 10 : 0)));
    const [, color] = band(v);
    out.push({ day: days[i], val: Math.round(v), color, h: 8 + v * 0.7 + 'px' });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Backend-shaped per-station mock (APIs 38 & 39). These mirror the exact return
// shapes of apiGetStationForecast / apiGetStationAlertHistory, so the map detail
// panel runs on mock now and swaps to the real API by changing only the call
// site. Promise-returning on purpose — same async signature as the API.
// ───────────────────────────────────────────────────────────────────────────

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** Short Vietnamese weekday label for a YYYY-MM-DD / ISO date. */
export const forecastDayLabel = (iso: string) => DOW[new Date(iso).getDay()] ?? '';

// Deterministic [0,1) noise from any seed — keeps mock values stable per station.
function noise(seed: number): number {
  const x = Math.sin(seed * 91.7) * 43758.5453;
  return x - Math.floor(x);
}

// Score → alert level, matching the engine's bands (<30→0, <60→1, <80→2, ≥80→3).
const alertLevelFromScore = (score: number): number =>
  score >= 80 ? 3 : score >= 60 ? 2 : score >= 30 ? 1 : 0;

/**
 * API 38 mock — GET /forecasts/stations/{id}. A 7-day series of
 * ClassifiedForecastPoint, each day classified (severity / alertLevel /
 * isExceeded / riskScore) the way the Risk Engine would, with the hard-gate
 * threshold check. Anchored on the station's risk score + thresholds so the
 * numbers stay coherent with the map dots.
 */
export function mockStationForecast(station: Station): Promise<{
  stationId: number;
  from: string;
  to: string;
  series: ClassifiedForecastPoint[];
}> {
  const w = station.weather;
  const thr1 = thresholdAt(station.thresholds, 1);
  const thr2 = thresholdAt(station.thresholds, 2);
  const anchor = thr2 ?? 6.5;
  const baseTemp = w?.temp ?? 24 + noise(station.id) * 6 - 3;
  const baseWind = w?.wind ?? 2 + noise(station.id * 3) * 6;
  const today = new Date();
  const series: ClassifiedForecastPoint[] = [];
  let v = station.riskScore ?? mockRiskScore(station.id);
  for (let i = 0; i < 7; i++) {
    v = Math.max(4, Math.min(100, v + Math.sin(i * 1.3) * 16 + (i === 2 ? 14 : 0) - (i > 4 ? 10 : 0)));
    const score = Math.round(v);
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const n = noise(station.id * 31 + i);
    const riverWaterLevel = Math.round((anchor - 1.2 + (score / 100) * 2.8) * 100) / 100;
    const alertByThreshold =
      thr2 != null && riverWaterLevel >= thr2 ? 2 : thr1 != null && riverWaterLevel >= thr1 ? 1 : 0;
    const alertLevel = Math.max(alertLevelFromScore(score), alertByThreshold);
    series.push({
      date,
      temperature: Math.round((baseTemp + Math.sin(i) * 2) * 10) / 10,
      rainfall: Math.round((score * 1.5 + n * 18) * 10) / 10,
      windSpeed: Math.round((baseWind + n * 3) * 10) / 10,
      windDirection: Math.round(n * 360),
      riverWaterLevel,
      severity: severityFromScore(score),
      alertLevel,
      isExceeded: alertByThreshold > 0,
      riskScore: score,
    });
  }
  return Promise.resolve({ stationId: station.id, from: series[0].date, to: series[6].date, series });
}

/**
 * API 39 mock — GET /stations/{id}/alert-history. Newest-first immutable alert
 * records (actual vs threshold + reason). Record count scales with risk.
 */
export function mockStationAlertHistory(station: Station): Promise<{
  data: AlertHistoryEntry[];
  total: number;
  page: number;
  size: number;
}> {
  const base = station.riskScore ?? mockRiskScore(station.id);
  const threshold = thresholdAt(station.thresholds, 2) ?? 7.0;
  const peak = alertLevelFromScore(base) || 1;
  const count = base >= 60 ? 3 : base >= 30 ? 2 : 1;
  const now = Date.now();
  const data: AlertHistoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const level = Math.max(1, peak - i);
    const ts = new Date(now - ((i + 1) * 6 + noise(station.id + i) * 4) * 3_600_000).toISOString();
    const actualValue =
      Math.round((threshold + (level - 1) * 0.6 + noise(station.id * 7 + i) * 0.5) * 100) / 100;
    data.push({
      id: `${station.id}-AH-${i}`,
      stationId: station.id,
      eventId: null,
      alertLevel: level,
      triggeredAt: ts,
      actualValue,
      thresholdValue: threshold,
      reason: `Mực nước ${actualValue}m vượt ngưỡng cấp ${level} (${threshold}m)`,
      weatherSnapshotId: null,
      createdAt: ts,
    });
  }
  return Promise.resolve({ data, total: data.length, page: 1, size: 20 });
}

export const EVENTS: EventItem[] = [
  {
    id: 'EVT-2026-0031',
    name: 'Bão số 3 — WIPHA',
    type: 'Bão',
    sev: 'Cao',
    sevColor: '#F97316',
    state: 'active',
    start: '18/06/2026 04:00',
    end: '—',
    provinces: ['Quảng Bình', 'Quảng Trị', 'Thừa Thiên Huế', 'Đà Nẵng', 'Quảng Nam'],
    stations: 9,
  },
  {
    id: 'EVT-2026-0030',
    name: 'Mưa lớn diện rộng Bắc Bộ',
    type: 'Mưa lớn',
    sev: 'Trung bình',
    sevColor: '#EAB308',
    state: 'monitor',
    start: '17/06/2026 20:00',
    end: '—',
    provinces: ['Hà Nội', 'Hải Phòng', 'Quảng Ninh'],
    stations: 4,
  },
  {
    id: 'EVT-2026-0028',
    name: 'Áp thấp nhiệt đới gần bờ',
    type: 'ATNĐ',
    sev: 'Cao',
    sevColor: '#F97316',
    state: 'closed',
    start: '09/06/2026 12:00',
    end: '12/06/2026 08:00',
    provinces: ['Khánh Hòa', 'Phú Yên', 'Bình Định'],
    stations: 3,
  },
  {
    id: 'EVT-2026-0025',
    name: 'Lũ quét khu vực Tây Nguyên',
    type: 'Lũ quét',
    sev: 'Rất cao',
    sevColor: '#EE0033',
    state: 'closed',
    start: '28/05/2026 03:00',
    end: '30/05/2026 18:00',
    provinces: ['Gia Lai', 'Đắk Lắk', 'Lâm Đồng'],
    stations: 5,
  },
];

export const ACCOUNTS: Account[] = [
  { name: 'Nguyễn Văn An', user: 'an.nv', role: 'Admin', roleColor: '#EE0033', status: 'active', last: '19/06/2026 07:42' },
  { name: 'Trần Thị Bình', user: 'binh.tt', role: 'Operator', roleColor: '#B45309', status: 'active', last: '19/06/2026 06:15' },
  { name: 'Lê Văn Cường', user: 'cuong.lv', role: 'Viewer', roleColor: '#0E7490', status: 'active', last: '18/06/2026 22:03' },
  { name: 'Phạm Thu Hà', user: 'ha.pt', role: 'Operator', roleColor: '#B45309', status: 'active', last: '19/06/2026 05:50' },
  { name: 'Đỗ Minh Khoa', user: 'khoa.dm', role: 'Viewer', roleColor: '#0E7490', status: 'locked', last: '10/06/2026 14:20' },
  { name: 'Vũ Quốc Đạt', user: 'dat.vq', role: 'Operator', roleColor: '#B45309', status: 'active', last: '19/06/2026 04:11' },
];

export const SERVICES: ServiceStatus[] = [
  { name: 'Open-Meteo API', desc: 'Dữ liệu dự báo thời tiết', status: 'ok', latency: '182 ms', uptime: '99.98%', last: '07:45' },
  { name: 'GDACS', desc: 'Cảnh báo thiên tai toàn cầu', status: 'ok', latency: '410 ms', uptime: '99.70%', last: '07:44' },
  { name: 'CARTO Basemap', desc: 'Tile bản đồ nền', status: 'ok', latency: '96 ms', uptime: '100%', last: '07:45' },
  { name: 'WebSocket Realtime', desc: 'Cập nhật rủi ro trực tiếp', status: 'slow', latency: '1.2 s', uptime: '99.10%', last: '07:45' },
  { name: 'PostGIS Database', desc: 'CSDL không gian', status: 'ok', latency: '24 ms', uptime: '99.99%', last: '07:45' },
  { name: 'Job Queue (Redis)', desc: 'Hàng đợi tác vụ nền', status: 'ok', latency: '12 ms', uptime: '99.95%', last: '07:45' },
];

export const JOBS: BgJob[] = [
  { name: 'Đồng bộ Open-Meteo', state: 'done', time: '07:30', info: '1.247 trạm' },
  { name: 'Tính chỉ số rủi ro lũ', state: 'done', time: '07:32', info: '1.247 trạm' },
  { name: 'Đồng bộ GDACS', state: 'running', time: '07:45', info: '64%' },
  { name: 'Nhập trạm lô #B-204', state: 'done', time: '06:10', info: '320 / 325 dòng' },
];

export const IMPORT_PREVIEW: ImportRow[] = [
  { row: 2, id: 'VTS-LS-201', name: 'Trạm Đồng Đăng', prov: 'Lạng Sơn', lat: '21.95', lng: '106.71', ok: true, msg: 'Hợp lệ' },
  { row: 3, id: 'VTS-CB-205', name: 'Trạm Cao Bằng TT', prov: 'Cao Bằng', lat: '22.66', lng: '106.26', ok: true, msg: 'Hợp lệ' },
  { row: 4, id: 'VTS-LC-210', name: 'Trạm Sa Pa', prov: 'Lào Cai', lat: '22.34', lng: '103.84', ok: true, msg: 'Hợp lệ' },
  { row: 5, id: 'VTS-??-000', name: 'Trạm Mường Lay', prov: 'Điện Biên', lat: '118.4', lng: '103.1', ok: false, msg: 'Vĩ độ ngoài khoảng 8–24°' },
  { row: 6, id: 'VTS-HG-214', name: '', prov: 'Hà Giang', lat: '22.83', lng: '104.98', ok: false, msg: 'Thiếu tên trạm (bắt buộc)' },
  { row: 7, id: 'VTS-CB-205', name: 'Trạm Trùng Khánh', prov: 'Cao Bằng', lat: '22.83', lng: '106.51', ok: false, msg: 'Trùng mã trạm dòng 3' },
  { row: 8, id: 'VTS-SL-220', name: 'Trạm Mộc Châu', prov: 'Sơn La', lat: '20.84', lng: '104.63', ok: true, msg: 'Hợp lệ' },
];

export const NOTIFS: Notif[] = [
  {
    title: 'Nguy cơ Rất cao — Trạm Đông Hà',
    body: 'Chỉ số ngập đạt 8.6 (ngưỡng 7.0). Mưa 24.8mm/h, mực nước sông vượt báo động 2. Đề nghị ứng cứu ưu tiên.',
    time: '5 phút trước',
    color: '#EE0033',
    bg: '#FDE7EB',
  },
  {
    title: 'Bão số 3 — WIPHA cập nhật vùng ảnh hưởng',
    body: 'Phạm vi mở rộng thêm 2 tỉnh: Quảng Nam, Đà Nẵng. Tổng 9 trạm bị tác động, tự động gán qua ST_Contains.',
    time: '22 phút trước',
    color: '#F97316',
    bg: '#FFF1E6',
  },
  {
    title: 'Đồng bộ Open-Meteo hoàn tất',
    body: 'Đã cập nhật snapshot thời tiết mới nhất cho 1.247 trạm. Nguồn chính Open-Meteo, không có fallback.',
    time: '1 giờ trước',
    color: '#16A34A',
    bg: '#ECFDF3',
  },
  {
    title: 'Nhập trạm hàng loạt — lô #B-204',
    body: '320/325 dòng thành công, 5 dòng lỗi (sai tọa độ & trùng mã). Báo cáo lỗi đã sẵn sàng để tải.',
    time: '2 giờ trước',
    color: '#2563EB',
    bg: '#EFF5FF',
  },
  {
    title: 'WebSocket Realtime phản hồi chậm',
    body: 'Độ trễ tăng lên 1.2s (ngưỡng 800ms). Hệ thống vẫn hoạt động, đang theo dõi healthcheck.',
    time: '3 giờ trước',
    color: '#B45309',
    bg: '#FEF3C7',
  },
];

export const EV_PROV_OPTIONS = [
  'Quảng Bình',
  'Quảng Trị',
  'Thừa Thiên Huế',
  'Đà Nẵng',
  'Quảng Nam',
  'Quảng Ngãi',
  'Hà Tĩnh',
  'Nghệ An',
  'Hà Nội',
  'Hải Phòng',
];

export const EV_TYPE_OPTIONS = ['Bão', 'Áp thấp nhiệt đới', 'Mưa lớn diện rộng', 'Lũ quét', 'Lũ / ngập lụt', 'Triều cường'];
export const EV_SEV_OPTIONS = ['Thấp', 'Trung bình', 'Cao', 'Rất cao'];

export const FLOOD_LEGEND = [
  { c: '#94A3B8', label: 'Thấp', range: '<10' },
  { c: '#16A34A', label: 'Chú ý', range: '10–30' },
  { c: '#EAB308', label: 'Trung bình', range: '30–60' },
  { c: '#F97316', label: 'Cao', range: '60–80' },
  { c: '#EE0033', label: 'Rất cao', range: '≥80' },
];

export const WEATHER_LEGENDS: Record<string, { title: string; gradient: string; ticks: string[] }> = {
  temp: { title: 'Nhiệt độ không khí (°C)', gradient: 'linear-gradient(90deg,#2563EB,#22C55E,#EAB308,#F97316,#EF4444)', ticks: ['10°', '20°', '30°', '40°'] },
  rain: { title: 'Lượng mưa 1 giờ (mm)', gradient: 'linear-gradient(90deg,#DBEAFE,#3B82F6,#7C3AED)', ticks: ['0', '5', '15', '≥30'] },
  radar: { title: 'Radar mưa (3 giờ gần đây)', gradient: 'linear-gradient(90deg,#EDE9FE,#8B5CF6,#6D28D9)', ticks: ['Nhẹ', 'TB', 'To', 'Rất to'] },
  wind: { title: 'Tốc độ gió (m/s)', gradient: 'linear-gradient(90deg,#E0F2FE,#38BDF8,#EC4899)', ticks: ['0', '5', '10', '≥20'] },
};
