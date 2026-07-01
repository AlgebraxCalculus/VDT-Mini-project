import { useEffect, useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { PAGE_TITLES, ROLE_COLOR } from '../lib/role';
import { apiGetIntegrationsHealth, apiRefreshWeather, ApiError } from '../lib/api';
import type { Role } from '../types';

// Nhãn hiển thị gọn cho từng vai trò trên Topbar.
const ROLE_CHIP_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  operator: 'Operator',
  admin: 'Admin',
};

// Primary data sources (per product decision): Open-Meteo for forecast, GDACS
// for disaster events. The other 3 (OWM, WeatherAPI, EONET) are fallback, so the
// Topbar health chip reflects ONLY these — fallback being down is fine.
const PRIMARY_SOURCES = ['OpenMeteo', 'GDACS'];
const HEALTH_POLL_MS = 60_000;

type ChipState = 'ok' | 'degraded' | 'unknown';

const CHIP: Record<ChipState, { dot: string; text: string; bg: string; border: string; label: string }> = {
  ok: { dot: '#16A34A', text: '#16794A', bg: '#F3FBF6', border: '#CDEBD8', label: 'Nguồn chính: Ổn định' },
  degraded: { dot: '#EE0033', text: '#B4123A', bg: '#FDE7EB', border: '#F7C6D2', label: 'Nguồn chính: Gián đoạn' },
  unknown: { dot: '#9AA0A6', text: '#6B7280', bg: '#F1F2F4', border: '#E2E5EA', label: 'Nguồn chính: Đang kiểm tra' },
};

export default function Topbar() {
  const { state, patch, doSync, showToast } = useApp();
  const { route, role, syncing } = state;

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
          <div title="Nguồn chính: Open-Meteo, GDACS" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderRadius: 9, background: CHIP[chipState].bg, border: `1px solid ${CHIP[chipState].border}` }}>
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
