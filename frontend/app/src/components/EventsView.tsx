import type { CSSProperties } from 'react';
import { useApp } from '../state/AppStateContext';
import { EVENTS, STATIONS, EV_PROV_OPTIONS, EV_TYPE_OPTIONS, EV_SEV_OPTIONS, riskMeta } from '../data/mockData';
import type { EventState } from '../types';

const STATE_META: Record<EventState, [string, string, string]> = {
  draft: ['Nháp', '#94A3B8', '#F1F5F9'],
  active: ['Đang hoạt động', '#EE0033', '#FDE7EB'],
  monitor: ['Đang theo dõi', '#B45309', '#FEF3C7'],
  closed: ['Đã đóng', '#475569', '#F1F5F9'],
};

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

function evStepStyle(i: number, cur: number) {
  const active = i === cur;
  const done = i < cur;
  const on = active || done;
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
  const { eventTab, eventDrawerId, evForm } = state;

  const evFilter = { active: (e: typeof EVENTS[0]) => e.state === 'active' || e.state === 'monitor', closed: (e: typeof EVENTS[0]) => e.state === 'closed', all: () => true }[eventTab];
  const evRows = EVENTS.filter(evFilter).map((e) => {
    const [label, color, bg] = STATE_META[e.state];
    return { ...e, stateLabel: label, stateColor: color, stateBg: bg };
  });
  const evCountActive = EVENTS.filter((e) => e.state === 'active' || e.state === 'monitor').length;
  const evCountClosed = EVENTS.filter((e) => e.state === 'closed').length;

  const tabStyle = (k: typeof eventTab): CSSProperties => {
    const on = eventTab === k;
    return { padding: '8px 16px', border: 'none', background: 'transparent', borderBottom: `2px solid ${on ? '#EE0033' : 'transparent'}`, color: on ? '#EE0033' : '#6B7280', fontSize: 13.5, fontWeight: on ? 700 : 600, cursor: 'pointer' };
  };

  const evDraw = EVENTS.find((e) => e.id === eventDrawerId);
  let evDrawer: null | (typeof EVENTS[0] & { stateLabel: string; stateColor: string; stateBg: string; curIdx: number; affected: typeof STATIONS; affectedCount: number }) = null;
  if (evDraw) {
    const [label, color, bg] = STATE_META[evDraw.state];
    const curIdx = evDraw.state === 'closed' ? 2 : evDraw.state === 'draft' ? 0 : 1;
    const affected = STATIONS.filter((s) => evDraw.provinces.includes(s.province?.name ?? ''));
    evDrawer = { ...evDraw, stateLabel: label, stateColor: color, stateBg: bg, curIdx, affected, affectedCount: affected.length };
  }

  const openEvForm = () => patch({ evForm: { name: '', type: 'Bão', sev: 'Trung bình', source: 'GDACS', start: '', provinces: [], note: '' } });
  const closeEvForm = () => patch({ evForm: null });
  const closeEvDrawer = () => patch({ eventDrawerId: null });

  const setEv = (k: string, v: string) => patch((s) => (s.evForm ? { evForm: { ...s.evForm, [k]: v } } : {}));
  const toggleEvProv = (p: string) =>
    patch((s) => {
      if (!s.evForm) return {};
      const has = s.evForm.provinces.includes(p);
      return { evForm: { ...s.evForm, provinces: has ? s.evForm.provinces.filter((x) => x !== p) : [...s.evForm.provinces, p] } };
    });

  const efAffected = evForm ? STATIONS.filter((s) => evForm.provinces.includes(s.province?.name ?? '')).length : 0;

  const saveEvForm = () => {
    if (!evForm) return;
    if (!evForm.name.trim()) {
      showToast('Vui lòng nhập tên sự kiện.');
      return;
    }
    if (!evForm.provinces.length) {
      showToast('Vui lòng chọn ít nhất 1 tỉnh trong phạm vi ảnh hưởng.');
      return;
    }
    patch({ evForm: null });
    showToast(`Đã tạo sự kiện "${evForm.name}" (trạng thái: Nháp) · ${evForm.provinces.length} tỉnh · ${efAffected} trạm được gán.`);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 1260, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #EEF0F3' }}>
            <button onClick={() => patch({ eventTab: 'active' })} style={tabStyle('active')}>Đang hoạt động · {evCountActive}</button>
            <button onClick={() => patch({ eventTab: 'closed' })} style={tabStyle('closed')}>Lịch sử · {evCountClosed}</button>
            <button onClick={() => patch({ eventTab: 'all' })} style={tabStyle('all')}>Tất cả</button>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={openEvForm}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(238,0,51,.24)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
            Tạo sự kiện
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {evRows.map((e) => (
            <div key={e.id} style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, flex: 'none', background: e.stateBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 4l9 16H3L12 4Z" stroke={e.stateColor} strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 10v4m0 3v.4" stroke={e.stateColor} strokeWidth="1.8" strokeLinecap="round" /></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{e.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: e.stateColor, background: e.stateBg, padding: '3px 9px', borderRadius: 7 }}>{e.stateLabel}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#9AA0A6', marginTop: 4, fontFamily: "'IBM Plex Mono',monospace" }}>{e.id} · {e.type} · Bắt đầu {e.start}</div>
              </div>
              <div style={{ textAlign: 'center', flex: 'none' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>Mức độ</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: e.sevColor, marginTop: 2 }}>{e.sev}</div>
              </div>
              <div style={{ textAlign: 'center', flex: 'none', width: 90 }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>Vùng / Trạm</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{e.provinces.length} / {e.stations}</div>
              </div>
              <button
                onClick={() => patch({ eventDrawerId: e.id })}
                style={{ flex: 'none', height: 38, padding: '0 15px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}
              >
                Chi tiết &amp; phạm vi
              </button>
            </div>
          ))}
        </div>
        <div style={{ height: 24 }} />
      </div>

      {evDrawer && (
        <>
          <div onClick={closeEvDrawer} style={{ position: 'absolute', inset: 0, background: 'rgba(20,24,32,.32)', zIndex: 40 }} />
          <div className="fws-fade" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 460, background: '#fff', zIndex: 50, boxShadow: '-12px 0 40px rgba(16,20,30,.18)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: evDrawer.stateColor, background: evDrawer.stateBg, padding: '3px 9px', borderRadius: 7 }}>{evDrawer.stateLabel}</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 8 }}>{evDrawer.name}</div>
                <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{evDrawer.id} · {evDrawer.type}</div>
              </div>
              <button onClick={closeEvDrawer} style={{ width: 32, height: 32, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, flex: 'none' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 12 }}>Vòng đời sự kiện (state machine)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
                {(() => {
                  const s0 = evStepStyle(0, evDrawer.curIdx);
                  const s1 = evStepStyle(1, evDrawer.curIdx);
                  const s2 = evStepStyle(2, evDrawer.curIdx);
                  return (
                    <>
                      <div style={s0.dot}>1</div><span style={s0.txt}>Nháp</span>
                      <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
                      <div style={s1.dot}>2</div><span style={s1.txt}>Đang hoạt động</span>
                      <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
                      <div style={s2.dot}>3</div><span style={s2.txt}>Đã đóng</span>
                    </>
                  );
                })()}
              </div>

              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 }}>Phạm vi ảnh hưởng · {evDrawer.provinces.length} tỉnh/thành</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
                {evDrawer.provinces.map((p) => (
                  <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: '#FDE7EB', color: '#C8002B', padding: '5px 11px', borderRadius: 8 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21c4-3.5 6-6.7 6-10a6 6 0 1 0-12 0c0 3.3 2 6.5 6 10Z" fill="#EE0033" /></svg>
                    {p}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3 }}>Trạm bị tác động (N–N)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#EE0033' }}>{evDrawer.affectedCount} trạm</span>
              </div>
              <div style={{ border: '1px solid #EEF0F3', borderRadius: 11, overflow: 'hidden' }}>
                {evDrawer.affected.map((s) => {
                  const meta = riskMeta(s.riskStatus);
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #F2F3F5' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flex: 'none' }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                      <span style={{ fontSize: 11.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>{s.province?.name ?? '—'}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color, padding: '2px 7px', borderRadius: 6 }}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #EEF0F3', display: 'flex', gap: 10 }}>
              <button onClick={closeEvDrawer} style={{ flex: 1, height: 44, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Đóng</button>
              <button onClick={() => showToast('Đã lưu phạm vi ảnh hưởng & ánh xạ trạm bị tác động.')} style={{ flex: 1.4, height: 44, border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                Lưu phạm vi ảnh hưởng
              </button>
            </div>
          </div>
        </>
      )}

      {evForm && (
        <>
          <div onClick={closeEvForm} style={{ position: 'absolute', inset: 0, background: 'rgba(20,24,32,.32)', zIndex: 40 }} />
          <div className="fws-fade" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 460, background: '#fff', zIndex: 50, boxShadow: '-12px 0 40px rgba(16,20,30,.18)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Tạo sự kiện thiên tai</div>
                <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 2 }}>Khởi tạo ở trạng thái Nháp · kiểm tra chống trùng lặp</div>
              </div>
              <button onClick={closeEvForm} style={{ width: 32, height: 32, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, flex: 'none' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Tên sự kiện</label>
              <input value={evForm.name} onChange={(e) => setEv('name', e.target.value)} placeholder="VD: Bão số 4 — NORU" style={inputBase} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Loại sự kiện</label>
                  <select value={evForm.type} onChange={(e) => setEv('type', e.target.value)} style={{ width: '100%', height: 40, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '0 10px', fontSize: 13.5, background: '#fff', marginTop: 7, cursor: 'pointer' }}>
                    {EV_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Mức độ</label>
                  <select value={evForm.sev} onChange={(e) => setEv('sev', e.target.value)} style={{ width: '100%', height: 40, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '0 10px', fontSize: 13.5, background: '#fff', marginTop: 7, cursor: 'pointer' }}>
                    {EV_SEV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Nguồn dữ liệu</label>
                  <select value={evForm.source} onChange={(e) => setEv('source', e.target.value)} style={{ width: '100%', height: 40, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '0 10px', fontSize: 13.5, background: '#fff', marginTop: 7, cursor: 'pointer' }}>
                    <option value="GDACS">GDACS (tự động)</option>
                    <option value="Thủ công">Khai báo thủ công</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Thời điểm bắt đầu</label>
                  <input value={evForm.start} onChange={(e) => setEv('start', e.target.value)} placeholder="dd/mm/yyyy hh:mm" style={{ width: '100%', height: 40, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '0 12px', fontSize: 13.5, fontFamily: "'IBM Plex Mono',monospace", outline: 'none', marginTop: 7 }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Phạm vi ảnh hưởng (Tỉnh/thành)</label>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#EE0033' }}>~ {efAffected} trạm</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
                {EV_PROV_OPTIONS.map((p) => {
                  const on = evForm.provinces.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleEvProv(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${on ? '#EE0033' : '#E2E5EA'}`, background: on ? '#FDE7EB' : '#fff', color: on ? '#C8002B' : '#4A4F57' }}
                    >
                      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke="#EE0033" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      {p}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, padding: '10px 12px', background: '#F3F8FF', border: '1px solid #D6E6FB', borderRadius: 9 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke="#2563EB" strokeWidth="1.6" /><path d="M12 11v5m0-8v.4" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" /></svg>
                <span style={{ fontSize: 12, color: '#1E4FA3', lineHeight: 1.45 }}>Trạm trong các tỉnh đã chọn sẽ tự động được gán vào sự kiện theo quan hệ N–N (Sự kiện – Tỉnh – Trạm).</span>
              </div>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Mô tả / lý do</label>
              <textarea
                value={evForm.note}
                onChange={(e) => setEv('note', e.target.value)}
                placeholder="Ghi chú diễn biến, nguồn cảnh báo, mức độ ưu tiên…"
                style={{ width: '100%', height: 74, border: '1.5px solid #E2E5EA', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, outline: 'none', marginTop: 7, resize: 'none' }}
              />
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #EEF0F3', display: 'flex', gap: 10 }}>
              <button onClick={closeEvForm} style={{ flex: 1, height: 44, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Hủy</button>
              <button onClick={saveEvForm} style={{ flex: 1.4, height: 44, border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>Tạo sự kiện</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
