import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import L from 'leaflet';
import { useApp } from '../state/AppStateContext';
import { band, riskMeta, FLOOD_LEGEND, WEATHER_LEGENDS, forecastDayLabel } from '../data/mockData';
import { apiListStationsInViewport, apiGetStationForecast, apiGetStationAlertHistory, apiGetProvinceForecast, ApiError } from '../lib/api';
import type { AlertHistoryEntry, ClassifiedForecastPoint, ForecastPoint, MapLayout, Station, WeatherLayerKey } from '../types';

const WEATHER_FIELDS: Record<WeatherLayerKey, [number, number, string, number][]> = {
  temp: [
    [21, 105.8, '#3B82F6', 0.18],
    [18.5, 105.9, '#60A5FA', 0.2],
    [16, 108, '#F59E0B', 0.22],
    [13, 109, '#F97316', 0.24],
    [10.7, 106.7, '#EF4444', 0.26],
  ],
  rain: [
    [18, 106.2, '#2563EB', 0.22],
    [16.8, 107.1, '#7C3AED', 0.26],
    [16, 108.2, '#3B82F6', 0.2],
    [15.2, 108.8, '#6366F1', 0.2],
  ],
  radar: [
    [17.4, 106.6, '#7C3AED', 0.3],
    [16.5, 107.6, '#8B5CF6', 0.26],
    [18.3, 105.9, '#6366F1', 0.22],
  ],
  wind: [
    [16.8, 107.1, '#EC4899', 0.24],
    [16, 108.3, '#F472B6', 0.2],
    [13.8, 109.2, '#DB2777', 0.22],
  ],
};

const EVENT_POLY: [number, number][] = [
  [18.4, 105.6],
  [18.2, 107.1],
  [16.3, 108.6],
  [15.0, 109.1],
  [15.2, 107.6],
  [16.6, 106.4],
  [17.6, 105.9],
];

const SCRUB_LABELS = ['Hôm nay', 'T7 20/6', 'CN 21/6', 'T2 22/6', 'T3 23/6', 'T4 24/6', 'T5 25/6'];
const SCRUB_SHORT = ['19/6', '20/6', '21/6', '22/6', '23/6', '24/6', '25/6'];
const SCRUB_HEIGHTS = [26, 30, 38, 34, 28, 22, 18];

// alert_histories.alert_level → colour (1 Chú ý, 2 Cảnh báo, 3 Nguy hiểm).
const ALERT_LEVEL_COLOR: Record<number, string> = { 1: '#EAB308', 2: '#F97316', 3: '#EE0033' };

/** Format an ISO timestamp as dd/MM/yyyy HH:mm for the alert-history timeline. */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Day/month label (d/M) for a YYYY-MM-DD / ISO date — used by the forecast scrubber. */
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

/** Scrubber bar height (px) from a day's rainfall (mm) — the flood-relevant signal. */
const rainBarHeight = (rain: number | null) => Math.max(6, Math.min(40, 8 + (rain ?? 0) * 0.9));

// 8-point Vietnamese compass (B=North, Đ=East, N=South, T=West), 45° per sector.
const COMPASS = ['B', 'ĐB', 'Đ', 'ĐN', 'N', 'TN', 'T', 'TB'];
const windDir = (deg: number | null) => (deg == null ? '' : COMPASS[Math.round(deg / 45) % 8]);

const railBtnBase: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 11,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  border: 'none',
  boxShadow: '0 3px 10px rgba(16,20,30,.12)',
};

export default function MapView() {
  const { state, patch, togglePlay } = useApp();
  const { weatherLayer, floodOn, selectedId, searchText, scrubDay, playing, mapLayout } = state;

  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // All ~10k stations are drawn as small squares onto a single shared canvas
  // renderer (not DOM markers, not clustered) — this is what keeps a full-country
  // "coverage" layer performant at 10k features. stationLayerRef holds them.
  const stationLayerRef = useRef<L.LayerGroup | null>(null);
  const stationRendererRef = useRef<L.Canvas | null>(null);
  const weatherGroupRef = useRef<L.LayerGroup | null>(null);
  const floodGroupRef = useRef<L.LayerGroup | null>(null);
  const eventGroupRef = useRef<L.LayerGroup | null>(null);
  const markerByIdRef = useRef<Record<number, L.CircleMarker>>({});
  const viewRef = useRef<{ c: [number, number]; z: number }>({ c: [16.4, 107.0], z: 6 });

  // Real station data — fetched per map viewport (GET /stations/viewport, a
  // GIST-indexed BBOX query), refetched on pan/zoom (debounced). Markers + flood
  // circles below re-render when this changes; risk/weather panels read it
  // null-safe. NOTE: the alerts panel reflects high-risk stations *in view*.
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selected-station detail (APIs 38 & 39) — loaded on select, mock-backed for
  // now. setState lives in the .then() callbacks of the effect below (not a
  // synchronous effect body) to respect the project's set-state-in-effect baseline.
  const [selForecast, setSelForecast] = useState<ClassifiedForecastPoint[]>([]);
  const [selHistory, setSelHistory] = useState<AlertHistoryEntry[]>([]);
  // Province aggregate forecast (API 37) for the selected station's province —
  // drives the bottom "Mốc dự báo" timeline; empty → the static prototype bars.
  const [provForecast, setProvForecast] = useState<ForecastPoint[]>([]);

  useEffect(() => {
    if (!mapNodeRef.current) return;
    const v = viewRef.current;
    const map = L.map(mapNodeRef.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.5 }).setView(v.c, v.z);
    mapRef.current = map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);

    const weatherGroup = L.layerGroup().addTo(map);
    const floodGroup = L.layerGroup();
    const eventGroup = L.layerGroup().addTo(map);
    weatherGroupRef.current = weatherGroup;
    floodGroupRef.current = floodGroup;
    eventGroupRef.current = eventGroup;

    // Shared canvas renderer for the station squares: one <canvas> draws all
    // features in a single pass instead of 10k DOM nodes. padding keeps squares
    // just off-screen rendered so they don't pop in at the viewport edge.
    const stationRenderer = L.canvas({ padding: 0.5 });
    stationRendererRef.current = stationRenderer;
    const stationLayer = L.layerGroup().addTo(map);
    stationLayerRef.current = stationLayer;

    const poly = L.polygon(EVENT_POLY, { color: '#EE0033', weight: 2, fillColor: '#EE0033', fillOpacity: 0.08, dashArray: '6 5' }).addTo(eventGroup);
    poly.bindTooltip('Bão số 3 — WIPHA · Vùng ảnh hưởng', { sticky: true });

    // Fetch the stations inside the current map rectangle. Reads bounds fresh on
    // each call (so no stale closure), then re-renders markers via `stations`.
    // setState here runs inside a timer/event callback — not synchronously in
    // the effect body — so it doesn't trip the set-state-in-effect rule.
    const fetchInView = () => {
      const m = mapRef.current;
      if (!m) return;
      const b = m.getBounds();
      setLoading(true);
      apiListStationsInViewport({
        minLng: b.getWest(),
        minLat: b.getSouth(),
        maxLng: b.getEast(),
        maxLat: b.getNorth(),
      })
        .then((data) => {
          setStations(data);
          setLoadError(null);
        })
        .catch((e) => {
          setStations([]);
          setLoadError(e instanceof ApiError ? e.message : 'Không tải được danh sách trạm.');
        })
        .finally(() => setLoading(false));
    };

    let debounce: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', () => {
      viewRef.current = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
      clearTimeout(debounce);
      debounce = setTimeout(fetchInView, 350);
    });

    // Initial paint + first load once the container has its real size.
    const initTimer = setTimeout(() => {
      map.invalidateSize();
      fetchInView();
    }, 80);

    return () => {
      clearTimeout(debounce);
      clearTimeout(initTimer);
      viewRef.current = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // (Re)build the station dots whenever the fetched data changes. Each station is
  // a fixed-radius circle on the shared canvas renderer (not DOM markers, not
  // clustered) — fixed pixel size keeps individual dots easy to hover/click at any
  // zoom while staying performant at ~10k. All dots are green for now: the 10k
  // stations have no real risk data yet (the Risk Engine / station_risk_assessments
  // is unbuilt), so colour-by-risk-level would be meaningless. Swap fillColor for
  // a floodLevel(score) lookup once the viewport API surfaces a real riskScore.
  const STATION_GREEN = '#16A34A';
  useEffect(() => {
    const stationLayer = stationLayerRef.current;
    const renderer = stationRendererRef.current;
    if (!stationLayer || !renderer) return;
    stationLayer.clearLayers();
    const markerById: Record<number, L.CircleMarker> = {};
    stations.forEach((s) => {
      if (s.latitude == null || s.longitude == null) return; // unmappable (no geom)
      const dot = L.circleMarker([s.latitude, s.longitude], {
        renderer,
        radius: 5,
        color: '#fff',
        weight: 1,
        fillColor: STATION_GREEN,
        fillOpacity: 0.92,
      });
      dot.bindPopup(
        `<div style="font-weight:700;font-size:13.5px;">${s.name}</div><div style="font-size:11.5px;color:#9AA0A6;font-family:monospace;margin:2px 0 7px;">${s.stationCode} · ${s.province?.name ?? '—'}</div><div style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${STATION_GREEN};padding:2px 8px;border-radius:6px;">Đang hoạt động</div>`
      );
      dot.on('click', () => patch({ selectedId: s.id }));
      markerById[s.id] = dot;
      stationLayer.addLayer(dot);
    });
    markerByIdRef.current = markerById;
  }, [stations, patch]);

  useEffect(() => {
    const map = mapRef.current;
    const floodGroup = floodGroupRef.current;
    if (!map || !floodGroup) return;
    floodGroup.clearLayers();
    if (floodOn) {
      stations.filter((s) => s.latitude != null && s.longitude != null && (s.riskScore ?? 0) >= 30).forEach((s) => {
        const score = s.riskScore ?? 0;
        const color = riskMeta(s.riskStatus).color;
        L.circle([s.latitude!, s.longitude!], { radius: 6000 + score * 450, color, weight: 1, fillColor: color, fillOpacity: 0.16, interactive: false }).addTo(floodGroup);
      });
      if (!map.hasLayer(floodGroup)) floodGroup.addTo(map);
    } else if (map.hasLayer(floodGroup)) {
      map.removeLayer(floodGroup);
    }
  }, [floodOn, stations]);

  useEffect(() => {
    const map = mapRef.current;
    const weatherGroup = weatherGroupRef.current;
    if (!map || !weatherGroup) return;
    weatherGroup.clearLayers();
    if (!weatherLayer) return;
    (WEATHER_FIELDS[weatherLayer] || []).forEach((f) => {
      L.circle([f[0], f[1]], { radius: 90000, color: f[2], weight: 0, fillColor: f[2], fillOpacity: f[3], interactive: false }).addTo(weatherGroup);
    });
  }, [weatherLayer]);

  // Load the selected station's 7-day forecast (API 38) + alert history (API 39).
  // Keyed by station id only — the forecast/history don't change on pan, so this
  // doesn't refire when the viewport refetches. setState runs inside the resolved-
  // promise callbacks (never synchronously in the effect body); errors clear the
  // panel rather than break it (401 is handled by the transparent refresh in request).
  useEffect(() => {
    let alive = true;
    if (selectedId == null) {
      Promise.resolve().then(() => { if (alive) { setSelForecast([]); setSelHistory([]); } });
      return () => { alive = false; };
    }
    apiGetStationForecast(selectedId)
      .then((f) => { if (alive) setSelForecast(f.series); })
      .catch(() => { if (alive) setSelForecast([]); });
    apiGetStationAlertHistory(selectedId)
      .then((h) => { if (alive) setSelHistory(h.data); })
      .catch(() => { if (alive) setSelHistory([]); });
    return () => { alive = false; };
  }, [selectedId]);

  // Province aggregate forecast (API 37) for the scrubber. Keyed by province id,
  // so it doesn't refire on pan and skips the refetch when the next selected
  // station shares the same province. Clears (→ mock bars) when nothing is selected.
  const selProvinceId = stations.find((s) => s.id === selectedId)?.provinceId ?? null;
  useEffect(() => {
    let alive = true;
    if (selProvinceId == null) {
      Promise.resolve().then(() => {
        if (!alive) return;
        setProvForecast([]);
        patch({ scrubDayCount: 7 }); // back to the 7-day mock scrubber
      });
      return () => { alive = false; };
    }
    apiGetProvinceForecast(selProvinceId)
      .then((p) => {
        if (!alive) return;
        setProvForecast(p.series);
        // Sync the play timer's cycle length to the live day count and restart
        // the timeline at "today" so it never lands on a non-existent day.
        patch({ scrubDayCount: p.series.length || 7, scrubDay: 0 });
      })
      .catch(() => {
        if (!alive) return;
        setProvForecast([]);
        patch({ scrubDayCount: 7 });
      });
    return () => { alive = false; };
  }, [selProvinceId, patch]);

  const flyTo = (s: Station) => {
    const map = mapRef.current;
    if (map && s.latitude != null && s.longitude != null) {
      map.flyTo([s.latitude, s.longitude], Math.max(map.getZoom(), 9), { duration: 0.8 });
      const m = markerByIdRef.current[s.id];
      if (m) setTimeout(() => m.openPopup(), 700);
    }
    patch({ selectedId: s.id, searchText: '' });
  };

  const q = searchText.trim().toLowerCase();
  // Same search surface as the station list / backend: name, province, code.
  const searchResults = q
    ? stations.filter((s) => `${s.name} ${s.province?.name ?? ''} ${s.stationCode}`.toLowerCase().includes(q)).slice(0, 6)
    : [];

  const alertStations = stations.filter((s) => s.riskStatus === 'WARNING' || s.riskStatus === 'DANGER')
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .map((s) => {
      const w = s.weather;
      const reason = w && w.rain > 15 ? `Mưa lớn ${w.rain}mm/h` : w && w.wind > 7 ? `Gió mạnh ${w.wind}m/s` : 'Tích nước lưu vực';
      return { ...s, reason, meta: riskMeta(s.riskStatus) };
    });

  const sel = stations.find((s) => s.id === selectedId);
  const selMeta = sel ? riskMeta(sel.riskStatus) : null;
  // Today's forecast point backs the stat tiles: there is no "current weather"
  // endpoint in the 47-API spec, so the nearest forecast day is the closest
  // backend-true source for temp / rain / wind / river level.
  const today = selForecast[0] ?? null;

  // Scrubber timeline: the real province aggregate (API 37) when a station is
  // selected, else the static prototype bars. Bar height ∝ that day's rainfall.
  const scrubLive = provForecast.length > 0;
  const scrubDays = scrubLive
    ? provForecast.map((p) => ({ short: dayMonth(p.date), full: `${forecastDayLabel(p.date)} ${dayMonth(p.date)}`, height: rainBarHeight(p.rainfall) }))
    : SCRUB_HEIGHTS.map((h, i) => ({ short: SCRUB_SHORT[i], full: SCRUB_LABELS[i], height: h }));
  const dayCount = scrubDays.length;
  const activeDay = Math.min(scrubDay, dayCount - 1);
  // Full forecast readout for the day under the scrubber cursor (live only).
  const activePoint = scrubLive ? provForecast[activeDay] ?? null : null;
  const fieldChips = [
    { label: 'Nhiệt độ', color: '#F97316', value: activePoint?.temperature != null ? `${activePoint.temperature}°C` : '—' },
    { label: 'Mưa', color: '#2563EB', value: activePoint?.rainfall != null ? `${activePoint.rainfall} mm` : '—' },
    { label: 'Gió', color: '#7C3AED', value: activePoint?.windSpeed != null ? `${activePoint.windSpeed} m/s${activePoint.windDirection != null ? ` ${windDir(activePoint.windDirection)}` : ''}` : '—' },
    { label: 'Mực nước sông', color: '#0EA5E9', value: activePoint?.riverWaterLevel != null ? `${activePoint.riverWaterLevel} m` : '—' },
  ];

  const legend = weatherLayer ? WEATHER_LEGENDS[weatherLayer] : null;

  const showAlertsPanel = !sel && mapLayout !== 'C';
  const railPos: CSSProperties = mapLayout === 'B' ? { right: 16 } : { left: 16 };
  const panelPos: CSSProperties = mapLayout === 'B' ? { left: 16 } : { right: 16 };

  const layoutBtnStyle = (l: MapLayout): CSSProperties => ({
    width: 30,
    height: 28,
    border: 'none',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    background: mapLayout === l ? '#EE0033' : '#F1F2F4',
    color: mapLayout === l ? '#fff' : '#6B7280',
  });

  const wlBtnStyle = (key: WeatherLayerKey): CSSProperties => {
    const on = weatherLayer === key;
    return { ...railBtnBase, background: on ? '#EE0033' : '#fff', color: on ? '#fff' : '#4A4F57' };
  };

  const floodBtnStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    height: 44,
    padding: '0 15px',
    borderRadius: 22,
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 3px 10px rgba(16,20,30,.14)',
    background: floodOn ? '#EE0033' : '#fff',
    color: floodOn ? '#fff' : '#6B7280',
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mapNodeRef} style={{ position: 'absolute', inset: 0, background: '#E8EBEF' }} />

      {(loading || loadError) && (
        <div style={{ position: 'absolute', bottom: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 550, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 999, boxShadow: '0 4px 14px rgba(16,20,30,.16)', padding: '8px 16px', fontSize: 12.5, fontWeight: 600, color: loadError ? '#B4123A' : '#5B626B', border: loadError ? '1px solid #F7C6D2' : '1px solid #E8EAEE' }}>
          {!loadError && <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #FEE2E2', borderTopColor: '#EE0033', animation: 'fwsSpin 1s linear infinite' }} />}
          {loadError ?? 'Đang tải danh sách trạm…'}
        </div>
      )}

      <div style={{ position: 'absolute', top: 16, ...railPos, zIndex: 500, display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 14px rgba(16,20,30,.14)', background: '#fff' }}>
        <button onClick={() => mapRef.current?.zoomIn()} style={{ width: 38, height: 38, border: 'none', borderBottom: '1px solid #EEF0F3', background: '#fff', cursor: 'pointer', fontSize: 20, color: '#3A3F47', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
        <button onClick={() => mapRef.current?.zoomOut()} style={{ width: 38, height: 38, border: 'none', background: '#fff', cursor: 'pointer', fontSize: 22, color: '#3A3F47', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
      </div>

      <div style={{ position: 'absolute', top: 74, ...railPos, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => patch((s) => ({ weatherLayer: s.weatherLayer === 'temp' ? null : 'temp' }))} title="Lớp nhiệt độ" style={wlBtnStyle('temp')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 4a2 2 0 0 1 2 2v7.2a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="16.5" r="1.7" fill="currentColor" /></svg>
        </button>
        <button onClick={() => patch((s) => ({ weatherLayer: s.weatherLayer === 'rain' ? null : 'rain' }))} title="Lớp mưa" style={wlBtnStyle('rain')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M7 15a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1A3.5 3.5 0 0 1 18 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M8 17l-1 2M12 17l-1 2M16 17l-1 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => patch((s) => ({ weatherLayer: s.weatherLayer === 'radar' ? null : 'radar' }))} title="Lớp radar mưa" style={wlBtnStyle('radar')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12l5-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => patch((s) => ({ weatherLayer: s.weatherLayer === 'wind' ? null : 'wind' }))} title="Lớp gió" style={wlBtnStyle('wind')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 14h14a2.5 2.5 0 1 1-2.5 2.5M3 11.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => patch({ floodOn: !floodOn })} title="Lớp nguy cơ lũ lụt" style={floodBtnStyle}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" fill="currentColor" /></svg>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Lũ lụt</span>
        </button>
      </div>

      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 500, width: 'min(420px,42vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 44, padding: '0 14px', background: '#fff', borderRadius: 11, boxShadow: '0 4px 16px rgba(16,20,30,.12)', border: '1.5px solid #E2E5EA' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#9AA0A6" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="#9AA0A6" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input
            value={searchText}
            onChange={(e) => patch({ searchText: e.target.value })}
            placeholder="Tìm trạm, tỉnh/thành, mã trạm…"
            style={{ border: 'none', outline: 'none', flex: 1, fontSize: 14, background: 'transparent', color: '#16181D' }}
          />
          {searchText && (
            <button onClick={() => patch({ searchText: '' })} style={{ border: 'none', background: '#F1F2F4', width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✕</button>
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="fws-fade" style={{ marginTop: 8, background: '#fff', borderRadius: 11, boxShadow: '0 8px 24px rgba(16,20,30,.16)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
            {searchResults.map((r) => {
              const meta = riskMeta(r.riskStatus);
              return (
                <button key={r.id} onClick={() => flyTo(r)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', border: 'none', borderBottom: '1px solid #F1F2F4', background: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: meta.color }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>{r.name}</span>
                    <span style={{ fontSize: 11.5, color: '#9AA0A6' }}>{r.province?.name ?? '—'} · {r.stationCode}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showAlertsPanel && (
        <div className="fws-fade" style={{ position: 'absolute', top: 16, ...panelPos, zIndex: 500, width: 316, background: '#fff', borderRadius: 14, boxShadow: '0 10px 30px rgba(16,20,30,.16)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 150px)' }}>
          <div style={{ padding: '15px 16px 13px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: '#FDE7EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 4l9 16H3L12 4Z" stroke="#EE0033" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4m0 3v.5" stroke="#EE0033" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Cảnh báo nguy cơ</div>
              <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>{alertStations.length} trạm rủi ro cao trong 24h</div>
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 8 }}>
            {alertStations.map((a) => (
              <button key={a.id} onClick={() => flyTo(a)} style={{ width: '100%', display: 'flex', alignItems: 'stretch', gap: 0, border: '1px solid #F0F1F3', borderRadius: 11, background: '#fff', cursor: 'pointer', marginBottom: 7, overflow: 'hidden', textAlign: 'left' }}>
                <span style={{ width: 4, flex: 'none', background: a.meta.color }} />
                <span style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: '#fff', background: a.meta.color, padding: '2px 7px', borderRadius: 6 }}>{a.meta.label}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: '#9AA0A6', marginTop: 3 }}>{a.province?.name ?? '—'}{a.riskScore != null ? ` · Chỉ số ${a.riskScore}` : ''}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 11.5, color: '#6B7280' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" fill={a.meta.color} /></svg>
                    {a.reason}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sel && (
        <div className="fws-fade" style={{ position: 'absolute', top: 16, ...panelPos, zIndex: 600, width: 340, background: '#fff', borderRadius: 14, boxShadow: '0 14px 36px rgba(16,20,30,.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 150px)' }}>
          <div style={{ padding: 16, borderBottom: '1px solid #EEF0F3', background: `linear-gradient(135deg,${selMeta!.color}14,#fff)` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: selMeta!.color, color: '#fff', fontSize: 11, fontWeight: 700 }}>
                  Nguy cơ {selMeta!.label}{sel.riskScore != null ? ` · ${sel.riskScore}` : ''}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 9, letterSpacing: -0.3 }}>{sel.name}</div>
                <div style={{ fontSize: 12.5, color: '#9AA0A6', marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{sel.stationCode} · {sel.province?.name ?? '—'}</div>
              </div>
              <button onClick={() => patch({ selectedId: null })} style={{ flex: 'none', width: 30, height: 30, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 9 }}>Dự báo hôm nay</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Nhiệt độ</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{today?.temperature ?? '—'}°</div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Mưa dự báo (ngày)</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{today?.rainfall ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> mm</span></div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Gió</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{today?.windSpeed ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> m/s</span></div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Mực nước sông</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{today?.riverWaterLevel ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> m</span></div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', letterSpacing: 0.4, textTransform: 'uppercase', margin: '18px 0 9px' }}>Dự báo chỉ số ngập 7 ngày</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 78 }}>
              {selForecast.map((f) => (
                <div key={f.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div title={`Chỉ số ${f.riskScore}`} style={{ width: '100%', borderRadius: '5px 5px 2px 2px', background: band(f.riskScore)[1], height: 8 + f.riskScore * 0.7, minHeight: 5 }} />
                  <div style={{ fontSize: 9.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>{forecastDayLabel(f.date)}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', letterSpacing: 0.4, textTransform: 'uppercase', margin: '18px 0 9px' }}>Lịch sử cảnh báo</div>
            {selHistory.length === 0 && (
              <div style={{ fontSize: 12, color: '#9AA0A6', paddingBottom: 10 }}>Chưa có cảnh báo nào cho trạm này.</div>
            )}
            {selHistory.map((h) => {
              const color = ALERT_LEVEL_COLOR[h.alertLevel] ?? '#94A3B8';
              return (
                <div key={h.id} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, marginTop: 3 }} />
                    <span style={{ flex: 1, width: 2, background: '#EEF0F3' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.reason ?? `Cảnh báo cấp ${h.alertLevel}`}</div>
                    <div style={{ fontSize: 11, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace", marginTop: 1 }}>{fmtDateTime(h.triggeredAt)}</div>
                  </div>
                </div>
              );
            })}

            <button onClick={() => patch({ route: 'forecast' })} style={{ width: '100%', height: 42, border: 'none', borderRadius: 10, background: '#EE0033', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
              Xem chi tiết &amp; xuất báo cáo
            </button>
          </div>
        </div>
      )}

      {legend && (
        <div className="fws-fade" style={{ position: 'absolute', bottom: 96, left: 16, zIndex: 500, background: '#fff', borderRadius: 12, boxShadow: '0 6px 20px rgba(16,20,30,.14)', padding: '13px 15px', width: 230 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#3A3F47', letterSpacing: 0.3, textTransform: 'uppercase' }}>{legend.title}</div>
          <div style={{ height: 9, borderRadius: 5, margin: '10px 0 7px', background: legend.gradient }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>
            {legend.ticks.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>
      )}

      {floodOn && (
        <div style={{ position: 'absolute', bottom: 96, right: 16, zIndex: 500, background: '#fff', borderRadius: 12, boxShadow: '0 6px 20px rgba(16,20,30,.14)', padding: '12px 14px', width: 172 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#3A3F47', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 8 }}>Chỉ số rủi ro lũ</div>
          {FLOOD_LEGEND.map((fl, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ width: 13, height: 13, borderRadius: 4, background: fl.c, flex: 'none' }} />
              <span style={{ fontSize: 11.5, color: '#3A3F47', flex: 1 }}>{fl.label}</span>
              <span style={{ fontSize: 10.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>{fl.range}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 500, background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(8px)', borderTop: '1px solid #E8EAEE', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => patch((s) => ({ scrubDay: (s.scrubDay + dayCount - 1) % dayCount }))} style={{ width: 34, height: 34, border: '1px solid #E2E5EA', background: '#fff', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3A3F47' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M16 5v14M9 12l7-7v14l-7-7Z" fill="currentColor" /></svg>
          </button>
          <button onClick={togglePlay} style={{ width: 40, height: 40, border: 'none', background: '#EE0033', borderRadius: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 4px 12px rgba(238,0,51,.3)' }}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7L8 5Z" /></svg>
            )}
          </button>
          <button onClick={() => patch((s) => ({ scrubDay: (s.scrubDay + 1) % dayCount }))} style={{ width: 34, height: 34, border: '1px solid #E2E5EA', background: '#fff', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3A3F47' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M8 5v14M15 12L8 5v14l7-7Z" fill="currentColor" /></svg>
          </button>
        </div>
        <div style={{ flex: 'none', minWidth: 168 }}>
          <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            Mốc dự báo
            {scrubLive && (
              <span title="Dự báo tổng hợp theo tỉnh/thành — trực tiếp (API 37)" style={{ fontSize: 9.5, fontWeight: 700, color: '#16794A', background: '#F3FBF6', border: '1px solid #CDEBD8', padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', flex: 'none' }} />
                {sel?.province?.name ?? '—'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{scrubDays[activeDay]?.full ?? '—'}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'flex-end', height: 40 }}>
          {scrubDays.map((d, i) => {
            const on = i === activeDay;
            const p = scrubLive ? provForecast[i] : null;
            const tip = p
              ? `${d.full} · Nhiệt độ ${p.temperature ?? '—'}°C · Mưa ${p.rainfall ?? '—'}mm · Gió ${p.windSpeed ?? '—'}m/s${p.windDirection != null ? ` ${windDir(p.windDirection)}` : ''} · Mực nước ${p.riverWaterLevel ?? '—'}m`
              : d.full;
            return (
              <button key={i} title={tip} onClick={() => patch({ scrubDay: i })} style={{ flex: 1, height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, padding: 0 }}>
                <span style={{ width: '100%', borderRadius: 4, background: on ? '#EE0033' : '#F4B8C4', height: d.height, minHeight: 5, opacity: on ? 1 : 0.8 }} />
                <span style={{ fontSize: 9.5, fontWeight: on ? 700 : 500, color: on ? '#EE0033' : '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace", textAlign: 'center' }}>{d.short}</span>
              </button>
            );
          })}
        </div>
        {scrubLive ? (
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 12, borderLeft: '1px solid #E8EAEE' }}>
            {fieldChips.map((f) => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontSize: 9.5, color: '#9AA0A6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, flex: 'none' }} />{f.label}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: '#16181D', whiteSpace: 'nowrap' }}>{f.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ flex: 'none', maxWidth: 210, paddingLeft: 12, borderLeft: '1px solid #E8EAEE', fontSize: 11.5, color: '#9AA0A6', lineHeight: 1.35 }}>
            Chọn một trạm để xem dự báo chi tiết theo tỉnh (nhiệt độ · mưa · gió · mực nước sông).
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 84, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 10, boxShadow: '0 4px 14px rgba(16,20,30,.14)', padding: 4 }}>
        <span style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600, padding: '0 6px 0 8px' }}>Bố cục</span>
        <button onClick={() => patch({ mapLayout: 'A' })} style={layoutBtnStyle('A')}>A</button>
        <button onClick={() => patch({ mapLayout: 'B' })} style={layoutBtnStyle('B')}>B</button>
        <button onClick={() => patch({ mapLayout: 'C' })} style={layoutBtnStyle('C')}>C</button>
      </div>
    </div>
  );
}
