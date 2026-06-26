import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../state/AppStateContext';
import { apiLogout } from '../lib/api';
import { isLocked, ROLE_COLOR, ROLE_USER_NAME } from '../lib/role';
import type { RouteKey } from '../types';

interface NavItem {
  key: RouteKey;
  label: string;
  icon: ReactNode;
  badge?: string;
}

const NAV_TOP: NavItem[] = [
  {
    key: 'map',
    label: 'Bản đồ trực tuyến',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9 4v13M15 6.5v13" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    key: 'forecast',
    label: 'Dự báo nguy cơ ngập',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M4 18l4.5-5 3.5 3.5L20 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 8h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    badge: '8',
  },
];

const NAV_MANAGE: NavItem[] = [
  {
    key: 'stations',
    label: 'Nhà trạm',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M12 21c4-3.5 6-6.7 6-10a6 6 0 1 0-12 0c0 3.3 2 6.5 6 10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="12" cy="11" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    key: 'import',
    label: 'Nhập hàng loạt',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'events',
    label: 'Sự kiện thiên tai',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M12 4l9 16H3L12 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 10v4m0 3v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    badge: '2',
  },
];

const NAV_SYSTEM: NavItem[] = [
  {
    key: 'accounts',
    label: 'Tài khoản & Phân quyền',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3 19c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16 4.5a3 3 0 0 1 0 6M18.5 19c-.3-1.6-1-2.9-2-3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'health',
    label: 'Tình trạng hệ thống',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M3 12h4l2 5 4-12 2 7h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const lockIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default function Sidebar() {
  const { state, patch } = useApp();
  const { sidebarOpen, role, route, currentUser } = state;

  // Revoke tokens server-side, then drop the session and return to login.
  const logout = () => {
    void apiLogout();
    patch({ route: 'login', currentUser: null });
  };

  const navBtn = (item: NavItem): CSSProperties => {
    const locked = isLocked(role, item.key);
    const active = route === item.key;
    const base: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      width: '100%',
      border: 'none',
      borderRadius: 10,
      padding: '10px 11px',
      marginBottom: 3,
      fontSize: 13.5,
      fontWeight: 600,
      textAlign: 'left',
      cursor: locked ? 'not-allowed' : 'pointer',
      background: 'transparent',
      color: '#4A4F57',
    };
    if (active) return { ...base, background: '#FDE7EB', color: '#EE0033' };
    if (locked) return { ...base, color: '#C4C8CE' };
    return base;
  };

  const goTo = (item: NavItem) => {
    if (isLocked(role, item.key)) return;
    patch({ route: item.key, selectedId: null });
  };

  const section = (title: string, items: NavItem[]) => (
    <>
      {sidebarOpen && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#A7ADB5', letterSpacing: 1.2, textTransform: 'uppercase', padding: '14px 10px 6px' }}>{title}</div>
      )}
      {items.map((item) => {
        const locked = isLocked(role, item.key);
        return (
          <button key={item.key} onClick={() => goTo(item)} title={item.label} style={navBtn(item)}>
            <span style={{ flex: 'none', display: 'flex' }}>{item.icon}</span>
            {sidebarOpen && <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
            {sidebarOpen && item.badge && !locked && (
              <span style={{ flex: 'none', minWidth: 19, height: 19, padding: '0 5px', borderRadius: 9, background: '#EE0033', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {item.badge}
              </span>
            )}
            {locked && <span style={{ flex: 'none', display: 'flex', opacity: 0.6 }}>{lockIcon}</span>}
          </button>
        );
      })}
    </>
  );

  const userName = currentUser?.fullName ?? currentUser?.username ?? ROLE_USER_NAME[role];
  const roleColor = ROLE_COLOR[role];
  const userInitial = userName.split(' ').pop()![0];

  return (
    <aside style={{ width: sidebarOpen ? 236 : 72, flex: 'none', background: '#fff', borderRight: '1px solid #E8EAEE', display: 'flex', flexDirection: 'column', transition: 'width .2s', zIndex: 30 }}>
      <div style={{ height: 60, flex: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '0 18px', borderBottom: '1px solid #EEF0F3' }}>
        <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 9, background: '#EE0033', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M12 2.5C12 2.5 5 10 5 15a7 7 0 0 0 14 0c0-5-7-12.5-7-12.5Z" fill="#fff" />
            <path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" stroke="#EE0033" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        {sidebarOpen && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: 0.2, lineHeight: 1 }}>
              VTNet <span style={{ color: '#EE0033' }}>FWS</span>
            </div>
            <div style={{ fontSize: 10, color: '#9AA0A6', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 3 }}>Cảnh báo lũ</div>
          </div>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
        {section('Bản đồ & Cảnh báo', NAV_TOP)}
        {section('Quản lý', NAV_MANAGE)}
        {section('Hệ thống', NAV_SYSTEM)}
      </nav>

      <div style={{ flex: 'none', borderTop: '1px solid #EEF0F3', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10, background: '#FAFAFB' }}>
          <div style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: roleColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
            {userInitial}
          </div>
          {sidebarOpen && (
            <>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
                <div style={{ fontSize: 11, color: roleColor, fontWeight: 600 }}>{role === 'viewer' ? 'Viewer' : role === 'operator' ? 'Operator' : 'Quản trị viên'}</div>
              </div>
              <button
                onClick={logout}
                title="Đăng xuất"
                style={{ flex: 'none', width: 30, height: 30, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9AA0A6' }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M10 12h10m0 0l-3-3m3 3l-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
