import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useApp } from '../state/AppStateContext';
import { riskMeta, thresholdAt } from '../data/mockData';
import {
  ApiError,
  apiCreateStation,
  apiDeleteStation,
  apiListProvinces,
  apiListStations,
  apiSetStationThresholds,
  apiUpdateStation,
} from '../lib/api';
import type { ThresholdInput } from '../lib/api';
import type { ProvinceRef, Station } from '../types';

const PAGE_SIZE = 20;

const inputBase: CSSProperties = {
  width: '100%',
  height: 40,
  border: '1.5px solid #E2E5EA',
  borderRadius: 9,
  padding: '0 12px',
  fontSize: 14,
  outline: 'none',
  margin: '7px 0 16px',
};

// Vietnam bounding box (mainland + offshore islands) — matches the backend
// CreateStationDto / UpdateStationDto bounds so FE and BE reject the same coords.
const LAT_MIN = 6;
const LAT_MAX = 24;
const LNG_MIN = 102;
const LNG_MAX = 118;

const TIER_LABEL: Record<1 | 2 | 3, string> = { 1: 'Chú ý', 2: 'Cảnh báo', 3: 'Nguy hiểm' };

type DrawerStringKey = 'stationCode' | 'name' | 'lat' | 'lng' | 'elevation' | 'th1' | 'th2' | 'th3';

const fmt1 = (v: number | null) => (v == null ? '—' : v.toFixed(1));

export default function StationsView() {
  const { state, patch, showToast } = useApp();
  const { stnQuery, stnProv, drawer, role } = state;
  const canWrite = role !== 'viewer';

  const [rows, setRows] = useState<Station[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [saving, setSaving] = useState(false);
  const [pageInput, setPageInput] = useState('1');

  const reload = () => setReloadKey((k) => k + 1);

  // Province reference list for the filter dropdown (loaded once).
  useEffect(() => {
    apiListProvinces()
      .then(setProvinces)
      .catch(() => setProvinces([]));
  }, []);

  // Fetch the station page whenever filters / page change. The free-text query
  // is debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const provinceId = stnProv === 'all' ? undefined : Number(stnProv);
    const q = stnQuery.trim() || undefined;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      apiListStations({ provinceId, q, page, size: PAGE_SIZE })
        .then((res) => {
          if (cancelled) return;
          setRows(res.data);
          setTotal(res.total);
        })
        .catch((e) => {
          if (cancelled) return;
          setRows([]);
          setTotal(0);
          setError(e instanceof ApiError ? e.message : 'Không tải được danh sách trạm.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stnQuery, stnProv, page, reloadKey]);

  const onSearch = (v: string) => {
    patch({ stnQuery: v });
    setPage(1);
  };
  const onProvince = (v: string) => {
    patch({ stnProv: v });
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Keep the page input in sync when page changes via arrows / filters.
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  // Jump to the page typed in the input, clamped to [1, totalPages].
  const commitPage = () => {
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) {
      setPageInput(String(page));
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, n));
    setPage(clamped);
    setPageInput(String(clamped));
  };

  const viewRows = rows.map((s, i) => {
    const meta = riskMeta(s.riskStatus);
    const coord =
      s.latitude != null && s.longitude != null
        ? `${s.latitude.toFixed(3)}, ${s.longitude.toFixed(3)}`
        : '—';
    const elevText =
      s.elevation == null
        ? '—'
        : `${s.elevation >= 1000 ? s.elevation.toLocaleString('en-US') : s.elevation} m`;
    const thrText = `${fmt1(thresholdAt(s.thresholds, 1))} / ${fmt1(thresholdAt(s.thresholds, 2))} / ${fmt1(thresholdAt(s.thresholds, 3))}`;
    return { ...s, stt: (page - 1) * PAGE_SIZE + i + 1, riskLabel: meta.label, riskColor: meta.color, coord, elevText, thrText };
  });

  const openDrawer = (mode: 'add' | 'edit', s?: Station) => {
    patch({
      drawer: {
        mode,
        s: s
          ? {
              id: s.id,
              stationCode: s.stationCode,
              name: s.name,
              lat: s.latitude != null ? String(s.latitude) : '',
              lng: s.longitude != null ? String(s.longitude) : '',
              elevation: s.elevation != null ? String(s.elevation) : '',
              th1: String(thresholdAt(s.thresholds, 1) ?? ''),
              th2: String(thresholdAt(s.thresholds, 2) ?? ''),
              th3: String(thresholdAt(s.thresholds, 3) ?? ''),
            }
          : { id: null, stationCode: '', name: '', lat: '', lng: '', elevation: '', th1: '5.0', th2: '7.0', th3: '8.5' },
      },
    });
  };

  const closeDrawer = () => patch({ drawer: null });

  const setDr = (k: DrawerStringKey, v: string) => {
    patch((s) => (s.drawer ? { drawer: { ...s.drawer, s: { ...s.drawer.s, [k]: v } } } : {}));
  };

  const dr = drawer;
  const latNum = dr ? parseFloat(dr.s.lat) : NaN;
  const lngNum = dr ? parseFloat(dr.s.lng) : NaN;
  const latErr = !!dr && dr.s.lat !== '' && (isNaN(latNum) || latNum < LAT_MIN || latNum > LAT_MAX);
  const lngErr = !!dr && dr.s.lng !== '' && (isNaN(lngNum) || lngNum < LNG_MIN || lngNum > LNG_MAX);

  const buildTiers = (): ThresholdInput[] => {
    if (!dr) return [];
    const defs: [1 | 2 | 3, string][] = [
      [1, dr.s.th1],
      [2, dr.s.th2],
      [3, dr.s.th3],
    ];
    return defs
      .filter(([, v]) => v.trim() !== '' && !isNaN(parseFloat(v)))
      .map(([alertLevel, v]) => ({ alertLevel, thresholdValue: parseFloat(v), label: TIER_LABEL[alertLevel] }));
  };

  const saveDrawer = async () => {
    if (!dr || saving) return;
    if (!dr.s.stationCode.trim()) return showToast('Vui lòng nhập mã trạm.');
    if (!dr.s.name.trim()) return showToast('Vui lòng nhập tên trạm.');
    if (dr.s.lat === '' || dr.s.lng === '' || latErr || lngErr) {
      return showToast('Tọa độ không hợp lệ. Vui lòng kiểm tra lại.');
    }
    const elevation = dr.s.elevation.trim() ? parseFloat(dr.s.elevation) : undefined;
    const tiers = buildTiers();
    setSaving(true);
    try {
      if (dr.mode === 'edit' && dr.s.id != null) {
        await apiUpdateStation(dr.s.id, {
          name: dr.s.name.trim(),
          latitude: latNum,
          longitude: lngNum,
          elevation,
        });
        // station_code is immutable; tiers are managed by a dedicated endpoint.
        await apiSetStationThresholds(dr.s.id, tiers);
        showToast('Đã cập nhật nhà trạm.');
      } else {
        await apiCreateStation({
          stationCode: dr.s.stationCode.trim(),
          name: dr.s.name.trim(),
          latitude: latNum,
          longitude: lngNum,
          elevation,
          thresholds: tiers.length ? tiers : undefined,
        });
        showToast('Đã tạo nhà trạm mới (tỉnh tự gán qua ST_Contains).');
      }
      patch({ drawer: null });
      reload();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Lưu nhà trạm thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const removeStation = useCallback(
    async (s: Station) => {
      try {
        await apiDeleteStation(s.id);
        showToast(`Đã chuyển trạm "${s.name}" (${s.stationCode}) vào thùng rác (soft-delete).`);
        reload();
      } catch (e) {
        showToast(e instanceof ApiError ? e.message : 'Xóa trạm thất bại.');
      }
    },
    [showToast],
  );

  const latInputStyle: CSSProperties = { ...inputBase, margin: 0, marginTop: 7, border: `1.5px solid ${latErr ? '#EE0033' : '#E2E5EA'}`, fontFamily: "'IBM Plex Mono',monospace" };
  const lngInputStyle: CSSProperties = { ...inputBase, margin: 0, marginTop: 7, border: `1.5px solid ${lngErr ? '#EE0033' : '#E2E5EA'}`, fontFamily: "'IBM Plex Mono',monospace" };

  // STT · Mã trạm · Tên · Tỉnh · Tọa độ · Độ cao · Ngưỡng · Rủi ro · Thao tác
  const colTemplate = '42px 120px 1fr 130px 134px 74px 120px 96px 70px';

  const pageBtn = (disabled: boolean): CSSProperties => ({
    width: 30,
    height: 30,
    border: '1px solid #EAECEF',
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 1260, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 40, padding: '0 12px', border: '1.5px solid #E2E5EA', borderRadius: 10, background: '#fff', width: 300 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#9AA0A6" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="#9AA0A6" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input
              value={stnQuery}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Tìm theo tên trạm, tỉnh, mã…"
              style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13.5, background: 'transparent' }}
            />
          </div>
          <select
            value={stnProv}
            onChange={(e) => onProvince(e.target.value)}
            style={{ height: 40, border: '1.5px solid #E2E5EA', borderRadius: 10, padding: '0 12px', fontSize: 13.5, background: '#fff', color: '#3A3F47', cursor: 'pointer' }}
          >
            <option value="all">Tất cả tỉnh/thành</option>
            {provinces.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 12.5, color: '#9AA0A6' }}>{total} trạm</div>
          <div style={{ flex: 1 }} />
          {canWrite && (
            <button
              onClick={() => openDrawer('add')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(238,0,51,.24)' }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
              Thêm trạm
            </button>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: colTemplate, gap: 10, padding: '11px 18px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 11, fontWeight: 700, color: '#8A9099', letterSpacing: 0.2, textTransform: 'uppercase', alignItems: 'center' }}>
            <span style={{ textAlign: 'center' }}>STT</span><span>Mã trạm</span><span>Tên trạm</span><span>Tỉnh / thành</span><span>Tọa độ</span><span>Độ cao</span><span>Ngưỡng ngập (m)</span><span>Rủi ro</span><span style={{ textAlign: 'right' }}>Thao tác</span>
          </div>

          {loading && (
            <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Đang tải danh sách trạm…</div>
          )}
          {!loading && error && (
            <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: '#EE0033' }}>
              {error} <button onClick={reload} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#2563EB', fontWeight: 600, cursor: 'pointer' }}>Thử lại</button>
            </div>
          )}
          {!loading && !error && viewRows.length === 0 && (
            <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Không có trạm nào khớp bộ lọc.</div>
          )}

          {!loading && !error && viewRows.map((s) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: colTemplate, gap: 10, padding: '10px 18px', borderBottom: '1px solid #F2F3F5', alignItems: 'center' }}>
              <span style={{ textAlign: 'center', fontSize: 12.5, fontFamily: "'IBM Plex Mono',monospace", color: '#9AA0A6' }}>{s.stt}</span>
              <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{s.stationCode}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span style={{ fontSize: 12.5, color: '#6B7280' }}>{s.province?.name ?? '—'}</span>
              <span style={{ fontSize: 12, color: '#6B7280', fontFamily: "'IBM Plex Mono',monospace" }}>{s.coord}</span>
              <span style={{ fontSize: 12, color: '#475569', fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{s.elevText}</span>
              <span style={{ fontSize: 11.5, color: '#6B7280', fontFamily: "'IBM Plex Mono',monospace" }}>{s.thrText}</span>
              <span><span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, color: '#fff', background: s.riskColor, padding: '2px 7px', borderRadius: 6 }}>{s.riskLabel}</span></span>
              <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                {canWrite ? (
                  <>
                    <button onClick={() => openDrawer('edit', s)} title="Sửa" style={{ width: 30, height: 30, border: '1px solid #EAECEF', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                    </button>
                    <button onClick={() => removeStation(s)} title="Xóa" style={{ width: 30, height: 30, border: '1px solid #EAECEF', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5h4v2m-7 0 1 13h8l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: '#C2C6CC' }}>—</span>
                )}
              </span>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', fontSize: 12.5, color: '#9AA0A6' }}>
            <span>Hiển thị {viewRows.length} / {total} trạm</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span onClick={() => page > 1 && setPage(page - 1)} style={pageBtn(page <= 1)}>‹</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#3A3F47' }}>
                Trang
                <input
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  onBlur={commitPage}
                  title="Nhập số trang rồi Enter để nhảy tới"
                  style={{ width: 56, height: 30, textAlign: 'center', border: '1.5px solid #E2E5EA', borderRadius: 7, fontSize: 12.5, fontFamily: "'IBM Plex Mono',monospace", outline: 'none', color: '#16181D' }}
                />
                / {totalPages}
              </span>
              <span onClick={() => page < totalPages && setPage(page + 1)} style={pageBtn(page >= totalPages)}>›</span>
            </span>
          </div>
        </div>
        <div style={{ height: 24 }} />
      </div>

      {dr && (
        <>
          <div onClick={closeDrawer} style={{ position: 'absolute', inset: 0, background: 'rgba(20,24,32,.32)', zIndex: 40 }} />
          <div className="fws-fade" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 420, background: '#fff', zIndex: 50, boxShadow: '-12px 0 40px rgba(16,20,30,.18)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{dr.mode === 'edit' ? 'Chỉnh sửa nhà trạm' : 'Thêm nhà trạm mới'}</div>
                <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 2 }}>Validate tọa độ · tỉnh tự gán (ST_Contains) · soft-delete</div>
              </div>
              <button onClick={closeDrawer} style={{ width: 32, height: 32, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Mã trạm{dr.mode === 'edit' && <span style={{ color: '#9AA0A6', fontWeight: 500 }}> (không đổi)</span>}</label>
              <input value={dr.s.stationCode} disabled={dr.mode === 'edit'} onChange={(e) => setDr('stationCode', e.target.value)} placeholder="VD: VTS-HN-001" style={{ ...inputBase, fontFamily: "'IBM Plex Mono',monospace", background: dr.mode === 'edit' ? '#F4F5F7' : '#fff', color: dr.mode === 'edit' ? '#9AA0A6' : '#16181D' }} />
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Tên trạm</label>
              <input value={dr.s.name} onChange={(e) => setDr('name', e.target.value)} placeholder="VD: Trạm Cầu Giấy" style={inputBase} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Vĩ độ (lat)</label>
                  <input value={dr.s.lat} onChange={(e) => setDr('lat', e.target.value)} placeholder={`${LAT_MIN} – ${LAT_MAX}`} style={latInputStyle} />
                  {latErr && <div style={{ fontSize: 11, color: '#EE0033', marginTop: 4 }}>Vĩ độ phải trong khoảng {LAT_MIN}–{LAT_MAX}°</div>}
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Kinh độ (lng)</label>
                  <input value={dr.s.lng} onChange={(e) => setDr('lng', e.target.value)} placeholder={`${LNG_MIN} – ${LNG_MAX}`} style={lngInputStyle} />
                  {lngErr && <div style={{ fontSize: 11, color: '#EE0033', marginTop: 4 }}>Kinh độ phải trong khoảng {LNG_MIN}–{LNG_MAX}°</div>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '14px 0 16px', padding: '10px 12px', background: '#F3F8FF', border: '1px solid #D6E6FB', borderRadius: 9 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', marginTop: 1 }}><path d="M12 21c4-3.5 6-6.7 6-10a6 6 0 1 0-12 0c0 3.3 2 6.5 6 10Z" stroke="#2563EB" strokeWidth="1.6" /><circle cx="12" cy="11" r="2" stroke="#2563EB" strokeWidth="1.6" /></svg>
                <span style={{ fontSize: 12, color: '#1E4FA3', lineHeight: 1.45 }}>Tỉnh/thành được hệ thống tự động xác định bằng <strong>ST_Contains</strong> theo tọa độ khi lưu — không nhập tay.</span>
              </div>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>
                Độ cao thực tế <span style={{ color: '#9AA0A6', fontWeight: 500 }}>(m so với mực nước biển)</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0 16px' }}>
                <input value={dr.s.elevation} onChange={(e) => setDr('elevation', e.target.value)} placeholder="VD: 12.5" style={{ flex: 'none', width: 130, height: 40, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '0 12px', fontSize: 14, fontFamily: "'IBM Plex Mono',monospace", outline: 'none' }} />
                <span style={{ fontSize: 12, color: '#9AA0A6', lineHeight: 1.4, flex: 1 }}>Đầu vào tính chỉ số rủi ro ngập cùng lượng mưa &amp; mực nước sông.</span>
              </div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>
                Ngưỡng ngập theo cấp <span style={{ color: '#9AA0A6', fontWeight: 500 }}>(mực nước, đơn vị m)</span>
              </label>
              <div style={{ border: '1.5px solid #E2E5EA', borderRadius: 10, overflow: 'hidden', margin: '8px 0 16px' }}>
                {[
                  { key: 'th1' as const, color: '#16A34A', label: 'Cấp 1 · Chú ý', placeholder: '5.0' },
                  { key: 'th2' as const, color: '#EAB308', label: 'Cấp 2 · Cảnh báo', placeholder: '7.0' },
                  { key: 'th3' as const, color: '#EE0033', label: 'Cấp 3 · Nguy hiểm', placeholder: '8.5' },
                ].map((row, i) => (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: i < 2 ? '1px solid #EEF0F3' : 'none' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: row.color, flex: 'none' }} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>{row.label}</span>
                    <input
                      value={dr.s[row.key]}
                      onChange={(e) => setDr(row.key, e.target.value)}
                      placeholder={row.placeholder}
                      style={{ flex: 'none', width: 80, height: 34, border: '1.5px solid #E2E5EA', borderRadius: 8, padding: '0 10px', fontSize: 13.5, fontFamily: "'IBM Plex Mono',monospace", outline: 'none', textAlign: 'right' }}
                    />
                    <span style={{ fontSize: 12, color: '#9AA0A6', width: 12 }}>m</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #EEF0F3', display: 'flex', gap: 10 }}>
              <button onClick={closeDrawer} style={{ flex: 1, height: 44, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Hủy</button>
              <button onClick={saveDrawer} disabled={saving} style={{ flex: 1.4, height: 44, border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Đang lưu…' : 'Lưu nhà trạm'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
