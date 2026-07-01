import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useApp } from '../state/AppStateContext';
import { riskMeta } from '../lib/display';
import {
  ApiError,
  apiAssignImpact,
  apiGetEventStations,
  apiListEvents,
  apiListProvinces,
} from '../lib/api';
import type { ApiEvent, EventScope, EventStatus } from '../lib/api';
import type { ProvinceRef } from '../types';

// Backend lifecycle is only ONGOING/CLOSED (disaster_events.status) — no draft/monitor.
const STATUS_META: Record<EventStatus, { label: string; color: string; bg: string }> = {
  ONGOING: { label: 'Đang hoạt động', color: '#EE0033', bg: '#FDE7EB' },
  CLOSED: { label: 'Đã đóng', color: '#475569', bg: '#F1F5F9' },
};

const typeName = (e: ApiEvent) => e.disasterType?.name ?? e.disasterType?.code ?? '—';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

function evStepStyle(i: number, cur: number) {
  const active = i === cur;
  const on = active || i < cur;
  const dot: CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    flex: 'none',
    background: on ? '#EE0033' : '#EDEFF2',
    color: on ? '#fff' : '#9AA0A6',
  };
  const txt: CSSProperties = { fontSize: 12.5, fontWeight: active ? 700 : 600, color: on ? '#16181D' : '#9AA0A6' };
  return { dot, txt };
}

export default function EventsView() {
  const { state, patch, showToast } = useApp();
  const { eventTab, eventDrawerId, role } = state;
  const canWrite = role !== 'viewer'; // Operator/Admin per the RBAC matrix (API 25)

  // Event list (API 20). Loaded once per reloadKey; tabs/counts derived client-side.
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Province reference for the scope multiselect (API 25 entry).
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);

  // Drawer scope (API 26) + the editable province selection.
  const [scope, setScope] = useState<EventScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [selProvinceIds, setSelProvinceIds] = useState<number[]>([]);
  const [savingScope, setSavingScope] = useState(false);

  // --- Loaders --------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    apiListEvents({ size: 100 })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.data);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setEvents([]);
        setError(e instanceof ApiError ? e.message : 'Không tải được danh sách sự kiện.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    apiListProvinces().then(setProvinces).catch(() => setProvinces([]));
  }, []);

  // Scope (API 26) for the open drawer; resets when closed. setState stays in the
  // resolved-promise callbacks (not the effect body) to respect the lint baseline.
  useEffect(() => {
    let cancelled = false;
    if (!eventDrawerId) {
      Promise.resolve().then(() => {
        if (cancelled) return;
        setScope(null);
        setScopeError(null);
        setSelProvinceIds([]);
      });
      return () => { cancelled = true; };
    }
    apiGetEventStations(eventDrawerId, { size: 100 })
      .then((sc) => {
        if (cancelled) return;
        setScope(sc);
        setSelProvinceIds(sc.provinces.map((p) => p.id));
        setScopeError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setScope(null);
        setScopeError(e instanceof ApiError ? e.message : 'Không tải được phạm vi ảnh hưởng.');
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventDrawerId]);

  // --- Derived --------------------------------------------------------------

  const countActive = events.filter((e) => e.status === 'ONGOING').length;
  const countClosed = events.filter((e) => e.status === 'CLOSED').length;
  const filtered = events.filter((e) =>
    eventTab === 'active' ? e.status === 'ONGOING' : eventTab === 'closed' ? e.status === 'CLOSED' : true,
  );

  const drawerEvent = events.find((e) => e.id === eventDrawerId) ?? null;
  const drawerStatus = drawerEvent?.status ?? null;
  const editableScope = canWrite && drawerStatus === 'ONGOING';

  // --- Actions --------------------------------------------------------------

  const reload = () => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const openDrawer = (id: string) => {
    setScope(null);
    setScopeError(null);
    setScopeLoading(true);
    patch({ eventDrawerId: id });
  };
  const closeDrawer = () => patch({ eventDrawerId: null });

  const toggleProvince = (id: number) =>
    setSelProvinceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const saveScope = async () => {
    if (!eventDrawerId || savingScope) return;
    if (selProvinceIds.length === 0) {
      showToast('Vui lòng chọn ít nhất 1 tỉnh trong phạm vi ảnh hưởng.');
      return;
    }
    setSavingScope(true);
    try {
      const sc = await apiAssignImpact(eventDrawerId, { provinceIds: selProvinceIds });
      setScope(sc);
      setSelProvinceIds(sc.provinces.map((p) => p.id));
      // Update the card's counts in place (no full reload → no drawer flicker).
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventDrawerId
            ? { ...e, provinceCount: sc.provinces.length, stationCount: sc.stations.total }
            : e,
        ),
      );
      showToast(`Đã gán phạm vi: ${sc.provinces.length} tỉnh · ${sc.stations.total} trạm (kích hoạt Risk Engine).`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Gán phạm vi ảnh hưởng thất bại.');
    } finally {
      setSavingScope(false);
    }
  };

  // --- Render ---------------------------------------------------------------

  const tabStyle = (k: typeof eventTab): CSSProperties => {
    const on = eventTab === k;
    return { padding: '8px 16px', border: 'none', background: 'transparent', borderBottom: `2px solid ${on ? '#EE0033' : 'transparent'}`, color: on ? '#EE0033' : '#6B7280', fontSize: 13.5, fontWeight: on ? 700 : 600, cursor: 'pointer' };
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 1260, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #EEF0F3' }}>
            <button onClick={() => patch({ eventTab: 'active' })} style={tabStyle('active')}>Đang hoạt động · {countActive}</button>
            <button onClick={() => patch({ eventTab: 'closed' })} style={tabStyle('closed')}>Lịch sử · {countClosed}</button>
            <button onClick={() => patch({ eventTab: 'all' })} style={tabStyle('all')}>Tất cả</button>
          </div>
          <div style={{ flex: 1 }} />
          {/* Events are tracked automatically from the 3rd-party disaster chain — no manual creation. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px', borderRadius: 9, background: '#EEF6FF', border: '1px solid #D6E6FB', color: '#1E4FA3', fontSize: 12.5, fontWeight: 600 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" /></svg>
            Tự động cập nhật từ GDACS · ReliefWeb · EONET
          </div>
        </div>

        {loading && (
          <div style={{ padding: '40px 18px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Đang tải danh sách sự kiện…</div>
        )}
        {!loading && error && (
          <div style={{ padding: '34px 18px', textAlign: 'center', fontSize: 13, color: '#EE0033' }}>
            {error} <button onClick={reload} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#2563EB', fontWeight: 600, cursor: 'pointer' }}>Thử lại</button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: '40px 18px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Chưa có sự kiện thiên tai nào được ghi nhận.</div>
        )}

        {!loading && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((e) => {
              const meta = STATUS_META[e.status];
              return (
                <div key={e.id} style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 11, flex: 'none', background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 4l9 16H3L12 4Z" stroke={meta.color} strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 10v4m0 3v.4" stroke={meta.color} strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{e.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: '3px 9px', borderRadius: 7 }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#9AA0A6', marginTop: 4, fontFamily: "'IBM Plex Mono',monospace" }}>{e.eventCode} · {typeName(e)} · Bắt đầu {fmtDate(e.startTime)}</div>
                  </div>
                  <div style={{ textAlign: 'center', flex: 'none', width: 90 }}>
                    <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>Vùng / Trạm</div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{e.provinceCount} / {e.stationCount}</div>
                  </div>
                  <button
                    onClick={() => openDrawer(e.id)}
                    style={{ flex: 'none', height: 38, padding: '0 15px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}
                  >
                    Chi tiết &amp; phạm vi
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>

      {drawerEvent && (
        <>
          <div onClick={closeDrawer} style={{ position: 'absolute', inset: 0, background: 'rgba(20,24,32,.32)', zIndex: 40 }} />
          <div className="fws-fade" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 460, background: '#fff', zIndex: 50, boxShadow: '-12px 0 40px rgba(16,20,30,.18)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: STATUS_META[drawerEvent.status].color, background: STATUS_META[drawerEvent.status].bg, padding: '3px 9px', borderRadius: 7 }}>{STATUS_META[drawerEvent.status].label}</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 8 }}>{drawerEvent.name}</div>
                <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{drawerEvent.eventCode} · {typeName(drawerEvent)}</div>
                {drawerEvent.description && (
                  <div style={{ fontSize: 11.5, color: '#8A9099', marginTop: 4 }}>{drawerEvent.description}</div>
                )}
              </div>
              <button onClick={closeDrawer} style={{ width: 32, height: 32, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, flex: 'none' }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 12 }}>Vòng đời sự kiện (state machine)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
                {(() => {
                  const cur = drawerEvent.status === 'CLOSED' ? 1 : 0;
                  const s0 = evStepStyle(0, cur);
                  const s1 = evStepStyle(1, cur);
                  return (
                    <>
                      <div style={s0.dot}>1</div><span style={s0.txt}>Đang hoạt động</span>
                      <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
                      <div style={s1.dot}>2</div><span style={s1.txt}>Đã đóng</span>
                    </>
                  );
                })()}
              </div>

              {scopeLoading && (
                <div style={{ fontSize: 12.5, color: '#9AA0A6', padding: '8px 0' }}>Đang tải phạm vi ảnh hưởng…</div>
              )}
              {!scopeLoading && scopeError && (
                <div style={{ fontSize: 12.5, color: '#EE0033', padding: '8px 0' }}>{scopeError}</div>
              )}

              {!scopeLoading && !scopeError && scope && (
                <>
                  {/* Province scope — editable multiselect for Operator/Admin on ONGOING events (API 25). */}
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 }}>
                    Phạm vi ảnh hưởng {editableScope ? `· ${selProvinceIds.length} tỉnh đã chọn` : `· ${scope.provinces.length} tỉnh/thành`}
                  </div>

                  {editableScope ? (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12, maxHeight: 168, overflowY: 'auto', padding: 2 }}>
                        {provinces.map((p) => {
                          const on = selProvinceIds.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProvince(p.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${on ? '#EE0033' : '#E2E5EA'}`, background: on ? '#FDE7EB' : '#fff', color: on ? '#C8002B' : '#4A4F57' }}
                            >
                              {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke="#EE0033" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, padding: '10px 12px', background: '#F3F8FF', border: '1px solid #D6E6FB', borderRadius: 9 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke="#2563EB" strokeWidth="1.6" /><path d="M12 11v5m0-8v.4" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" /></svg>
                        <span style={{ fontSize: 12, color: '#1E4FA3', lineHeight: 1.45 }}>Lưu phạm vi sẽ <strong>thay thế</strong> phạm vi hiện tại: trạm trong các tỉnh đã chọn được gán theo quan hệ N–N và Risk Engine tính lại rủi ro.</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
                      {scope.provinces.length === 0 && <span style={{ fontSize: 12.5, color: '#9AA0A6' }}>Chưa khoanh vùng tỉnh/thành nào.</span>}
                      {scope.provinces.map((p) => (
                        <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: '#FDE7EB', color: '#C8002B', padding: '5px 11px', borderRadius: 8 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21c4-3.5 6-6.7 6-10a6 6 0 1 0-12 0c0 3.3 2 6.5 6 10Z" fill="#EE0033" /></svg>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3 }}>Trạm bị tác động (N–N)</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#EE0033' }}>{scope.stations.total} trạm</span>
                  </div>
                  <div style={{ border: '1px solid #EEF0F3', borderRadius: 11, overflow: 'hidden' }}>
                    {scope.stations.data.length === 0 && (
                      <div style={{ padding: '12px', fontSize: 12.5, color: '#9AA0A6' }}>Chưa có trạm nào trong phạm vi.</div>
                    )}
                    {scope.stations.data.map((s) => {
                      const meta = riskMeta(s.riskStatus);
                      return (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #F2F3F5' }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flex: 'none' }} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                          <span style={{ fontSize: 11.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>{s.provinceName ?? '—'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color, padding: '2px 7px', borderRadius: 6 }}>{meta.label}</span>
                        </div>
                      );
                    })}
                    {scope.stations.total > scope.stations.data.length && (
                      <div style={{ padding: '9px 12px', fontSize: 11.5, color: '#9AA0A6', textAlign: 'center' }}>… và {scope.stations.total - scope.stations.data.length} trạm khác</div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid #EEF0F3', display: 'flex', gap: 10 }}>
              <button onClick={closeDrawer} style={{ flex: 1, height: 44, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Đóng</button>
              {editableScope && (
                <button
                  onClick={saveScope}
                  disabled={savingScope}
                  style={{ flex: 1.4, height: 44, border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#fff', cursor: savingScope ? 'default' : 'pointer', opacity: savingScope ? 0.6 : 1 }}
                >
                  {savingScope ? 'Đang lưu…' : 'Lưu phạm vi ảnh hưởng'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
