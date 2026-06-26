import { useEffect, useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { NOTIFS } from '../data/mockData';
import { PAGE_TITLES, ROLE_COLOR } from '../lib/role';
import { apiGetIntegrationsHealth, apiRefreshWeather, ApiError } from '../lib/api';
import type { Role } from '../types';

// Nhãn hiển thị gọn cho từng vai trò trên Topbar.
const ROLE_CHIP_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  operator: 'Operator',
  admin: 'Admin',
};

// Primary data sources (per product decision): Open-Meteo for forecast, NASA
// EONET for disaster events. The other 3 (OWM, WeatherAPI, GDACS) are fallback,
// so the Topbar health chip reflects ONLY these — fallback being down is fine.
const PRIMARY_SOURCES = ['OpenMeteo', 'EONET'];
const HEALTH_POLL_MS = 60_000;

type ChipState = 'ok' | 'degraded' | 'unknown';

const CHIP: Record<ChipState, { dot: string; text: string; bg: string; border: string; label: string }> = {
  ok: { dot: '#16A34A', text: '#16794A', bg: '#F3FBF6', border: '#CDEBD8', label: 'Nguồn chính: Ổn định' },
  degraded: { dot: '#EE0033', text: '#B4123A', bg: '#FDE7EB', border: '#F7C6D2', label: 'Nguồn chính: Gián đoạn' },
  unknown: { dot: '#9AA0A6', text: '#6B7280', bg: '#F1F2F4', border: '#E2E5EA', label: 'Nguồn chính: Đang kiểm tra' },
};

export default function Topbar() {
  const { state, patch, doSync, showToast } = useApp();
  const { route, role, syncing, notifOpen } = state;

  const [title, subtitle] = PAGE_TITLES[route];

  // Group F — poll API 35 (Admin-only endpoint) and reduce it to the health of
  // the primary sources only. Runs only for admins (the chip is admin-gated too),
  // so non-admins never hit the 403. setState happens only in async callbacks to
  // avoid the synchronous-setState-in-effect pitfall.
  const [chipState, setChipState] = useState<ChipState>('unknown');
  useEffect(() => {
    if (role !== 'admin') return;
    let cancelled = false;
    const poll = () => {
      apiGetIntegrationsHealth()
        .then((sources) => {
          if (cancelled) return;
          const primary = sources.filter((s) => PRIMARY_SOURCES.includes(s.code));
          if (primary.length === 0) return setChipState('unknown');
          setChipState(primary.every((s) => s.status === 'UP') ? 'ok' : 'degraded');
        })
        .catch(() => {
          if (!cancelled) setChipState('unknown');
        });
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [role]);

  // Group F — API 31 manual weather refresh. Admin-only on the UI (see the
  // gated block below); the server also enforces Operator/Admin + a debounce
  // lock (429 when a refresh is already in flight).
  const onSync = async () => {
    if (syncing) return;
    doSync(); // spinner visual (auto-clears)
    try {
      const { jobId } = await apiRefreshWeather();
      showToast(`Đã kích hoạt đồng bộ thời tiết · job ${jobId.slice(0, 8)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429)
        showToast('Đang có một lượt đồng bộ chạy, vui lòng đợi.');
      else if (e instanceof ApiError) showToast(e.message);
      else showToast('Không kích hoạt được đồng bộ.');
    }
  };

  return (
    <header style={{ height: 60, flex: 'none', background: '#fff', borderBottom: '1px solid #E8EAEE', display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', zIndex: 20 }}>
      <button
        onClick={() => patch((s) => ({ sidebarOpen: !s.sidebarOpen }))}
        style={{ width: 34, height: 34, flex: 'none', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4A4F57' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#9AA0A6', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Group F controls (primary-source health chip + manual refresh) — Admin only. */}
      {role === 'admin' && (
        <>
          <div title="Nguồn chính: Open-Meteo, NASA EONET" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderRadius: 9, background: CHIP[chipState].bg, border: `1px solid ${CHIP[chipState].border}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CHIP[chipState].dot, boxShadow: chipState === 'ok' ? '0 0 0 3px rgba(22,163,74,.18)' : undefined }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: CHIP[chipState].text }}>{CHIP[chipState].label}</span>
          </div>

          <button
            onClick={onSync}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', borderRadius: 9, border: '1.5px solid #E2E5EA', background: '#fff', cursor: syncing ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, color: '#3A3F47' }}
          >
            <span style={{ display: 'flex', animation: syncing ? 'fwsSpin 1s linear infinite' : undefined }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M20 12a8 8 0 1 0-2.3 5.6M20 12V7m0 5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {syncing ? 'Đang đồng bộ…' : 'Đồng bộ dữ liệu'}
          </button>
        </>
      )}

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => patch((s) => ({ notifOpen: !s.notifOpen }))}
          style={{ position: 'relative', width: 38, height: 38, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4A4F57' }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: '#EE0033', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
            {NOTIFS.length}
          </span>
        </button>

        {notifOpen && (
          <>
            <div onClick={() => patch({ notifOpen: false })} style={{ position: 'fixed', inset: 0, zIndex: 990 }} />
            <div className="fws-fade" style={{ position: 'absolute', top: 46, right: 0, width: 380, background: '#fff', borderRadius: 14, boxShadow: '0 16px 44px rgba(16,20,30,.22)', zIndex: 1000, overflow: 'hidden', border: '1px solid #EEF0F3' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #EEF0F3' }}>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>Thông báo</div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#EE0033', background: '#FDE7EB', padding: '3px 9px', borderRadius: 7 }}>{NOTIFS.length} mới</span>
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {NOTIFS.map((n, i) => (
                  <div key={i} style={{ display: 'flex', gap: 11, padding: '13px 16px', borderBottom: '1px solid #F2F3F5', cursor: 'pointer' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', background: n.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4l9 16H3L12 4Z" stroke={n.color} strokeWidth="1.7" strokeLinejoin="round" />
                        <path d="M12 10v4m0 3v.4" stroke={n.color} strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: '#5B626B', lineHeight: 1.45, marginTop: 3 }}>{n.body}</div>
                      <div style={{ fontSize: 11, color: '#9AA0A6', marginTop: 5, fontFamily: "'IBM Plex Mono',monospace" }}>{n.time}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button style={{ width: '100%', padding: 12, border: 'none', background: '#FAFBFC', borderTop: '1px solid #EEF0F3', fontSize: 12.5, fontWeight: 700, color: '#EE0033', cursor: 'pointer' }}>
                Xem tất cả thông báo
              </button>
            </div>
          </>
        )}
      </div>

      <div
        title="Vai trò đăng nhập hiện tại"
        style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 13px', background: '#F1F2F4', borderRadius: 9 }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLOR[role] }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ROLE_COLOR[role] }}>{ROLE_CHIP_LABEL[role]}</span>
      </div>
    </header>
  );
}
