import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import L from 'leaflet';
import { useApp } from '../state/AppStateContext';
import { band, riskMeta, WEATHER_LEGENDS, forecastDayLabel } from '../lib/display';
import {
  apiGetMapStations,
  apiGetMapEvents,
  apiGetMapWeather,
  apiSearchMapStations,
  apiGetStation,
  apiGetStationForecast,
  apiGetStationAlertHistory,
  apiGetProvinceForecast,
  ApiError,
  type MapCluster,
  type MapEvent,
  type WeatherOverlayLayer,
} from '../lib/api';
import { subscribeViewport, unsubscribeViewport, onRiskDelta, onRealtimeStatus, type RealtimeStatus } from '../lib/realtime';
import type { AlertHistoryEntry, ClassifiedForecastPoint, ForecastPoint, MapLayout, Station, WeatherLayerKey } from '../types';

// FE weather-layer buttons → backend overlay field (API 29). 'radar' reads rainfall like 'rain'.
const WEATHER_OVERLAY_LAYER: Record<WeatherLayerKey, WeatherOverlayLayer> = {
  temp: 'temp',
  rain: 'rain',
  radar: 'rain',
  wind: 'wind',
};

// Per-layer overlay colour + the value treated as full intensity (scales point opacity).
const WEATHER_OVERLAY_STYLE: Record<WeatherLayerKey, { color: string; max: number }> = {
  temp: { color: '#F97316', max: 38 },
  rain: { color: '#2563EB', max: 50 },
  radar: { color: '#7C3AED', max: 50 },
  wind: { color: '#EC4899', max: 20 },
};

// Placeholder scrubber bar heights before a station's real series loads.
const SCRUB_HEIGHTS = [26, 30, 38, 34, 28, 22, 18];

// alert_level → colour (1 Chú ý, 2 Cảnh báo, 3 Nguy hiểm).
const ALERT_LEVEL_COLOR: Record<number, string> = { 1: '#EAB308', 2: '#F97316', 3: '#EE0033' };

/** Format an ISO timestamp as dd/MM/yyyy HH:mm. */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Day/month label (d/M) for an ISO date. */
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

/** Scrubber bar height (px) from a day's rainfall (mm). */
const rainBarHeight = (rain: number | null) => Math.max(6, Math.min(40, 8 + (rain ?? 0) * 0.9));

// 8-point Vietnamese compass (B=N, Đ=E, N=S, T=W), 45° per sector.
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
  const { weatherLayer, selectedId, searchText, scrubDay, playing, mapLayout } = state;

  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Stations draw onto one shared canvas renderer (not DOM markers) to stay fast at 10k features.
  const stationLayerRef = useRef<L.LayerGroup | null>(null);
  const stationRendererRef = useRef<L.Canvas | null>(null);
  const weatherGroupRef = useRef<L.LayerGroup | null>(null);
  const eventGroupRef = useRef<L.LayerGroup | null>(null);
  const markerByIdRef = useRef<Record<number, L.CircleMarker>>({});
  const viewRef = useRef<{ c: [number, number]; z: number }>({ c: [16.4, 107.0], z: 6 });

  // Viewport stations (API 27), refetched debounced on pan/zoom. Zoomed out the
  // server returns grid clusters instead and `stations` is empty.
  const [stations, setStations] = useState<Station[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Active events (API 28) + weather overlay points (API 29), viewport-scoped, refetched via viewportVersion.
  const [mapEvents, setMapEvents] = useState<MapEvent[]>([]);
  const [weatherPoints, setWeatherPoints] = useState<{ lat: number; lng: number; value: number }[]>([]);
  // DB-backed viewport search (API 30) — works even when clustered.
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  // Bumped (debounced) on moveend so the event/weather effects refetch the new rectangle.
  const [viewportVersion, setViewportVersion] = useState(0);

  // Real-time risk channel (APIs 44–47); powers the live pill and merges deltas into `stations`.
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('connecting');

  // Selected-station detail (APIs 38 & 39), loaded on select.
  const [selForecast, setSelForecast] = useState<ClassifiedForecastPoint[]>([]);
  const [selHistory, setSelHistory] = useState<AlertHistoryEntry[]>([]);
  // Province aggregate forecast (API 37) — the only series the scrubber shows.
  const [provForecast, setProvForecast] = useState<ForecastPoint[]>([]);
  // Detail (API 13) fallback when the station was selected from another view and
  // isn't in the viewport yet, so the panel + fly-to have data. Guarded by flownToRef.
  const [selDetail, setSelDetail] = useState<Station | null>(null);
  const flownToRef = useRef<number | null>(null);
  // Viewport stations mirrored into a ref so the fly-to effect's "already in view"
  // check doesn't depend on `stations` (which would re-run it on every pan).
  const stationsRef = useRef<Station[]>([]);
  useEffect(() => { stationsRef.current = stations; }, [stations]);

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

    // Dedicated panes so station clicks always win over the overlay polygons (which
    // would otherwise intercept clicks meant for stations inside an event's area).
    map.createPane('fws-overlays').style.zIndex = '410';
    map.createPane('fws-stations').style.zIndex = '450';

    const weatherGroup = L.layerGroup().addTo(map);
    const eventGroup = L.layerGroup().addTo(map);
    weatherGroupRef.current = weatherGroup;
    eventGroupRef.current = eventGroup;

    // Shared canvas renderer, pinned to the stations pane so clicks win over overlays.
    const stationRenderer = L.canvas({ padding: 0.5, pane: 'fws-stations' });
    stationRendererRef.current = stationRenderer;
    const stationLayer = L.layerGroup().addTo(map);
    stationLayerRef.current = stationLayer;

    // Fetch the stations in the current rectangle (API 27), reading bounds + zoom
    // fresh each call. The server returns enriched stations or clusters by zoom;
    // bumping viewportVersion drives the event/weather refetch effects.
    const fetchInView = () => {
      const m = mapRef.current;
      if (!m) return;
      const b = m.getBounds();
      const bbox = {
        minLng: b.getWest(),
        minLat: b.getSouth(),
        maxLng: b.getEast(),
        maxLat: b.getNorth(),
      };
      // Re-join the viewport's tile rooms (API 45) so live deltas track pan/zoom.
      subscribeViewport(bbox);
      setLoading(true);
      apiGetMapStations(bbox, { zoom: Math.round(m.getZoom()) })
        .then((res) => {
          if (res.clustered) {
            setClusters(res.clusters);
            setStations([]);
          } else {
            setStations(res.stations);
            setClusters([]);
          }
          setLoadError(null);
        })
        .catch((e) => {
          setStations([]);
          setClusters([]);
          setLoadError(e instanceof ApiError ? e.message : 'Không tải được danh sách trạm.');
        })
        .finally(() => setLoading(false));
      setViewportVersion((v) => v + 1);
    };

    let debounce: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', () => {
      viewRef.current = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
      clearTimeout(debounce);
      debounce = setTimeout(fetchInView, 350);
    });

    // Initial paint + first load once the container has real size.
    const initTimer = setTimeout(() => {
      map.invalidateSize();
      fetchInView();
    }, 80);

    return () => {
      clearTimeout(debounce);
      clearTimeout(initTimer);
      unsubscribeViewport(); // API 47 — stop deltas on unmount
      viewRef.current = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Real-time risk deltas (API 46): merge each into the matching in-view station and
  // track connection status for the live pill.
  useEffect(() => {
    const offDelta = onRiskDelta((d) => {
      setStations((prev) => {
        let hit = false;
        const next = prev.map((s) => {
          if (s.id !== d.stationId) return s;
          hit = true;
          return { ...s, riskStatus: d.riskStatus, severity: d.severity ?? undefined };
        });
        return hit ? next : prev; // off-screen station → no re-render
      });
    });
    const offStatus = onRealtimeStatus(setRtStatus);
    return () => {
      offDelta();
      offStatus();
    };
  }, []);

  // (Re)build the station layer on data change: clusters (bubble per grid cell) when
  // zoomed out, else individual dots coloured by risk status.
  useEffect(() => {
    const stationLayer = stationLayerRef.current;
    const renderer = stationRendererRef.current;
    const map = mapRef.current;
    if (!stationLayer || !renderer) return;
    stationLayer.clearLayers();
    const markerById: Record<number, L.CircleMarker> = {};

    if (clusters.length > 0) {
      clusters.forEach((c) => {
        const meta = riskMeta(c.riskStatus);
        const r = Math.min(26, 11 + Math.sqrt(c.count) * 1.6);
        const bubble = L.circleMarker([c.lat, c.lng], {
          renderer, // stations pane — stays clickable above overlays
          radius: r,
          color: '#fff',
          weight: 2,
          fillColor: meta.color,
          fillOpacity: 0.82,
        });
        bubble.bindTooltip(`${c.count} trạm`, { permanent: true, direction: 'center', className: 'fws-cluster-label' });
        bubble.on('click', () => map?.flyTo([c.lat, c.lng], Math.max((map.getZoom() ?? 6) + 2, 9), { duration: 0.7 }));
        stationLayer.addLayer(bubble);
      });
      markerByIdRef.current = {};
      return;
    }

    stations.forEach((s) => {
      if (s.latitude == null || s.longitude == null) return; // no geom
      const meta = riskMeta(s.riskStatus);
      const dot = L.circleMarker([s.latitude, s.longitude], {
        renderer,
        radius: 5,
        color: '#fff',
        weight: 1,
        fillColor: meta.color,
        fillOpacity: 0.92,
      });
      const scoreChip = s.riskScore != null ? ` · Chỉ số ${s.riskScore}` : '';
      // Tooltip for a quick read; click opens the detail panel. No bindPopup — its
      // autoPan would trigger a viewport refetch that swaps out the marker mid-click.
      dot.bindTooltip(
        `<b>${s.name}</b><br><span style="color:#9AA0A6;font-family:monospace;font-size:11px;">${s.stationCode} · ${s.province?.name ?? '—'}</span><br><span style="color:${meta.color};font-weight:700;">${meta.label}${scoreChip}</span>`,
        { direction: 'top', offset: [0, -4], opacity: 0.97 },
      );
      dot.on('click', () => patch({ selectedId: s.id }));
      markerById[s.id] = dot;
      stationLayer.addLayer(dot);
    });
    markerByIdRef.current = markerById;
  }, [stations, clusters, patch]);

  // Active-event polygons (API 28): redraw eventGroup from the fetched footprints.
  useEffect(() => {
    const eventGroup = eventGroupRef.current;
    if (!eventGroup) return;
    eventGroup.clearLayers();
    mapEvents.forEach((ev) => {
      if (!ev.affectedArea) return;
      const layer = L.geoJSON(ev.affectedArea, {
        pane: 'fws-overlays', // below stations so it never eats station clicks
        style: { color: '#EE0033', weight: 2, fillColor: '#EE0033', fillOpacity: 0.08, dashArray: '6 5' },
      });
      layer.bindTooltip(`${ev.name} · Vùng ảnh hưởng (${ev.stationCount} trạm)`, { sticky: true });
      layer.addTo(eventGroup);
    });
  }, [mapEvents]);

  // Active events in view (API 28) — refetched per viewport.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    apiGetMapEvents({ minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() })
      .then(setMapEvents)
      .catch(() => setMapEvents([]));
  }, [viewportVersion]);

  // Weather overlay points (API 29) for the active layer, refetched on pan.
  useEffect(() => {
    if (!weatherLayer) {
      Promise.resolve().then(() => setWeatherPoints([]));
      return;
    }
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    apiGetMapWeather(
      { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() },
      WEATHER_OVERLAY_LAYER[weatherLayer],
    )
      .then((res) => setWeatherPoints(res.points))
      .catch(() => setWeatherPoints([]));
  }, [weatherLayer, viewportVersion]);

  // Draw the weather overlay: one soft circle per point, opacity scaled by value.
  useEffect(() => {
    const weatherGroup = weatherGroupRef.current;
    if (!weatherGroup) return;
    weatherGroup.clearLayers();
    if (!weatherLayer) return;
    const style = WEATHER_OVERLAY_STYLE[weatherLayer];
    weatherPoints.forEach((p) => {
      const intensity = Math.max(0, Math.min(1, p.value / style.max));
      L.circle([p.lat, p.lng], {
        pane: 'fws-overlays', // keep the soft overlay under stations
        radius: 26000,
        color: style.color,
        weight: 0,
        fillColor: style.color,
        fillOpacity: 0.08 + intensity * 0.24,
        interactive: false,
      }).addTo(weatherGroup);
    });
  }, [weatherLayer, weatherPoints]);

  // Selected station's 7-day forecast (API 38) + alert history (API 39). Keyed by id
  // only so it doesn't refire on pan; errors clear the panel rather than break it.
  useEffect(() => {
    let alive = true;
    if (selectedId == null) {
      Promise.resolve().then(() => {
        if (!alive) return;
        setSelForecast([]);
        setSelHistory([]);
      });
      return () => { alive = false; };
    }
    // Feeds the panel's 7-day risk bars; the scrubber's day count comes from the province series.
    apiGetStationForecast(selectedId)
      .then((f) => { if (alive) setSelForecast(f.series); })
      .catch(() => { if (alive) setSelForecast([]); });
    apiGetStationAlertHistory(selectedId)
      .then((h) => { if (alive) setSelHistory(h.data); })
      .catch(() => { if (alive) setSelHistory([]); });
    return () => { alive = false; };
  }, [selectedId]);

  // Locate a station selected from outside the map (e.g. ForecastView): fetch its
  // detail (API 13) as the panel fallback and fly past the cluster zoom so the
  // viewport refetch loads the enriched marker. Keyed by `selectedId` only and gated
  // on flownToRef (not a cleanup flag) so depending on `stations` can't cancel the
  // in-flight fetch mid-select. Runs once per selection.
  useEffect(() => {
    if (selectedId == null) {
      flownToRef.current = null;
      Promise.resolve().then(() => setSelDetail(null));
      return;
    }
    if (flownToRef.current === selectedId) return;
    // Already in view → the panel resolves from `stations`; no fetch/fly needed.
    if (stationsRef.current.some((s) => s.id === selectedId)) {
      flownToRef.current = selectedId;
      return;
    }
    flownToRef.current = selectedId; // claim before the async call to avoid re-fetch
    apiGetStation(selectedId)
      .then((s) => {
        if (flownToRef.current !== selectedId) return; // selection changed → stale
        setSelDetail(s);
        const map = mapRef.current;
        if (map && s.latitude != null && s.longitude != null) {
          map.flyTo([s.latitude, s.longitude], Math.max(map.getZoom(), 10), { duration: 0.8 });
        }
      })
      .catch(() => { if (flownToRef.current === selectedId) setSelDetail(null); });
  }, [selectedId]);

  // Selected station: prefer the enriched viewport copy, else the fetched detail.
  const selStation = stations.find((s) => s.id === selectedId) ?? (selDetail?.id === selectedId ? selDetail : null);
  const selProvinceId = selStation?.provinceId ?? null;
  // Province aggregate (API 37) — the scrubber's series; also syncs the play timer's
  // day count (5–7) and restarts at today. Keyed by province id so it doesn't refire on pan.
  useEffect(() => {
    let alive = true;
    if (selProvinceId == null) {
      Promise.resolve().then(() => {
        if (!alive) return;
        setProvForecast([]);
        patch({ scrubDayCount: 7, scrubDay: 0 }); // static placeholder scrubber
      });
      return () => { alive = false; };
    }
    apiGetProvinceForecast(selProvinceId)
      .then((p) => {
        if (!alive) return;
        setProvForecast(p.series);
        patch({ scrubDayCount: p.series.length || 7, scrubDay: 0 });
      })
      .catch(() => {
        if (!alive) return;
        setProvForecast([]);
        patch({ scrubDayCount: 7 });
      });
    return () => { alive = false; };
  }, [selProvinceId, patch]);

  // Viewport search (API 30): debounced free-text query against the DB, scoped to the
  // current rectangle so it works even when clustered.
  useEffect(() => {
    const term = searchText.trim();
    if (term.length < 2) {
      const t = setTimeout(() => setSearchResults([]), 0);
      return () => clearTimeout(t);
    }
    const timer = setTimeout(() => {
      const m = mapRef.current;
      if (!m) return;
      const b = m.getBounds();
      apiSearchMapStations(
        { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() },
        { q: term, limit: 6 },
      )
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  const flyTo = (s: Station) => {
    const map = mapRef.current;
    if (map && s.latitude != null && s.longitude != null) {
      map.flyTo([s.latitude, s.longitude], Math.max(map.getZoom(), 9), { duration: 0.8 });
      // After the fly settles, surface the station's tooltip (re-rendered by the refetch).
      const m = markerByIdRef.current[s.id];
      if (m) setTimeout(() => m.openTooltip(), 800);
    }
    patch({ selectedId: s.id, searchText: '' });
  };

  const alertStations = stations.filter((s) => s.riskStatus === 'WARNING' || s.riskStatus === 'DANGER')
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .map((s) => {
      const w = s.weather;
      const reason = w && w.rain > 15 ? `Mưa lớn ${w.rain}mm/h` : w && w.wind > 7 ? `Gió mạnh ${w.wind}m/s` : 'Tích nước lưu vực';
      return { ...s, reason, meta: riskMeta(s.riskStatus) };
    });

  const sel = selStation;
  const selMeta = sel ? riskMeta(sel.riskStatus) : null;

  // Scrubber source: the province aggregate (API 37), else static bars. Height ∝ rainfall.
  const activeSeries: ForecastPoint[] = provForecast;
  const scrubLive = activeSeries.length > 0;
  const scrubDays = scrubLive
    ? activeSeries.map((p) => ({ short: dayMonth(p.date), full: `${forecastDayLabel(p.date)} ${dayMonth(p.date)}`, height: rainBarHeight(p.rainfall) }))
    : SCRUB_HEIGHTS.map((h, i) => {
        // Placeholder days today → today+6. Build ISO from local parts to avoid a UTC day-shift in VN.
        const d = new Date();
        d.setDate(d.getDate() + i);
        const pad = (n: number) => String(n).padStart(2, '0');
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        return { short: dayMonth(iso), full: `${forecastDayLabel(iso)} ${dayMonth(iso)}`, height: h };
      });
  const dayCount = scrubDays.length;
  const activeDay = Math.min(scrubDay, dayCount - 1);
  const activePoint = scrubLive ? activeSeries[activeDay] ?? null : null;
  const dayPoint = activePoint ?? activeSeries[0] ?? null;
  const dayLabel = scrubLive ? scrubDays[activeDay]?.full ?? 'hôm nay' : 'hôm nay';
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

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mapNodeRef} style={{ position: 'absolute', inset: 0, background: '#E8EBEF' }} />

      {(loading || loadError) && (
        <div style={{ position: 'absolute', bottom: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 550, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 999, boxShadow: '0 4px 14px rgba(16,20,30,.16)', padding: '8px 16px', fontSize: 12.5, fontWeight: 600, color: loadError ? '#B4123A' : '#5B626B', border: loadError ? '1px solid #F7C6D2' : '1px solid #E8EAEE' }}>
          {!loadError && <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #FEE2E2', borderTopColor: '#EE0033', animation: 'fwsSpin 1s linear infinite' }} />}
          {loadError ?? 'Đang tải danh sách trạm…'}
        </div>
      )}

      {!loading && !loadError && (
        <div style={{ position: 'absolute', bottom: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 550, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', borderRadius: 999, boxShadow: '0 4px 14px rgba(16,20,30,.16)', padding: '6px 13px', fontSize: 12, fontWeight: 600, border: '1px solid #E8EAEE', color: rtStatus === 'connected' ? '#16794A' : '#9AA0A6' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: rtStatus === 'connected' ? '#16A34A' : '#CBD2DA', boxShadow: rtStatus === 'connected' ? '0 0 0 3px rgba(22,163,74,.18)' : 'none' }} />
          {rtStatus === 'connected' ? 'Trực tiếp · cập nhật rủi ro real-time' : rtStatus === 'connecting' ? 'Đang kết nối real-time…' : 'Mất kết nối real-time'}
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
                  {selMeta!.label}{sel.riskScore != null ? ` · ${sel.riskScore}` : ''}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 9, letterSpacing: -0.3 }}>{sel.name}</div>
                <div style={{ fontSize: 12.5, color: '#9AA0A6', marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{sel.stationCode} · {sel.province?.name ?? '—'}</div>
              </div>
              <button onClick={() => patch({ selectedId: null })} style={{ flex: 'none', width: 30, height: 30, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 9 }}>Dự báo · {dayLabel}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Nhiệt độ</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{dayPoint?.temperature ?? '—'}°</div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Mưa dự báo (ngày)</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{dayPoint?.rainfall ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> mm</span></div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Gió</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{dayPoint?.windSpeed ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> m/s</span></div>
              </div>
              <div style={{ background: '#FAFAFB', border: '1px solid #EEF0F3', borderRadius: 11, padding: '11px 12px' }}>
                <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600 }}>Mực nước sông</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{dayPoint?.riverWaterLevel ?? '—'}<span style={{ fontSize: 12, fontWeight: 500, color: '#9AA0A6' }}> m</span></div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', letterSpacing: 0.4, textTransform: 'uppercase', margin: '18px 0 9px' }}>Dự báo chỉ số ngập 7 ngày</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 78 }}>
              {selForecast.map((f, i) => (
                <button
                  key={f.date}
                  onClick={() => patch({ scrubDay: i })}
                  title={`${forecastDayLabel(f.date)} · Chỉ số ${f.riskScore}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
                >
                  <div style={{ width: '100%', borderRadius: '5px 5px 2px 2px', background: band(f.riskScore)[1], height: 8 + f.riskScore * 0.7, minHeight: 5, opacity: i === activeDay ? 1 : 0.5, outline: i === activeDay ? '2px solid #EE0033' : 'none', outlineOffset: 1 }} />
                  <div style={{ fontSize: 9.5, color: i === activeDay ? '#EE0033' : '#9AA0A6', fontWeight: i === activeDay ? 700 : 500, fontFamily: "'IBM Plex Mono',monospace" }}>{forecastDayLabel(f.date)}</div>
                </button>
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
        <div style={{ flex: 'none', minWidth: 196 }}>
          <div style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            Mốc dự báo
            {scrubLive && (
              <span title="Dự báo tổng hợp theo tỉnh/thành — trực tiếp (API 37)" style={{ fontSize: 9.5, fontWeight: 700, color: '#16794A', background: '#F3FBF6', border: '1px solid #CDEBD8', padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', flex: 'none' }} />
                {sel?.province?.name ?? '—'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{scrubDays[activeDay]?.full ?? '—'}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'flex-end', height: 40 }}>
          {scrubDays.map((d, i) => {
            const on = i === activeDay;
            const p = scrubLive ? activeSeries[i] : null;
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
