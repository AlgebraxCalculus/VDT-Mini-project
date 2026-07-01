import { useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { ApiError, apiLogin } from '../lib/api';
import { roleFromCode } from '../lib/role';

export default function Login() {
  const { patch } = useApp();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Call the real POST /auth/login, store tokens, then enter the app with the
  // role the backend assigned (drives the sidebar RBAC gating).
  const submit = async (u = username, p = password) => {
    if (loading) return;
    if (!u.trim() || !p) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await apiLogin(u.trim(), p, remember);
      patch({
        route: 'map',
        role: roleFromCode(res.user.role),
        currentUser: res.user,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? // The backend returns 401 for both wrong credentials and a locked
              // account ('Account is disabled'); only the message distinguishes
              // them, so branch on it to show the right reason.
              /disabled/i.test(err.message)
              ? 'Tài khoản đã bị khóa.'
              : 'Sai tên đăng nhập hoặc mật khẩu.'
            : err.message
          : 'Đăng nhập thất bại. Vui lòng thử lại.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#FAFAFA' }}>
      <div
        style={{
          width: '42%',
          minWidth: 380,
          background: 'linear-gradient(150deg,#EE0033 0%,#C20029 70%,#9E0021 100%)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px 52px',
          color: '#fff',
        }}
      >
        <div style={{ position: 'absolute', top: -120, right: -120, width: 420, height: 420, borderRadius: '50%', background: 'rgba(255,255,255,.07)' }} />
        <div style={{ position: 'absolute', bottom: -160, left: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,.05)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2.5C12 2.5 5 10 5 15a7 7 0 0 0 14 0c0-5-7-12.5-7-12.5Z" fill="#EE0033" />
              <path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: 0.3 }}>
              VTNet <span style={{ fontWeight: 500, opacity: 0.85 }}>FWS</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: 2, textTransform: 'uppercase' }}>Flood Warning System</div>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.12, letterSpacing: -0.5 }}>
            Quản lý rủi ro
            <br />
            thiên tai cho
            <br />
            mạng lưới nhà trạm
          </div>
          <div style={{ marginTop: 20, fontSize: 15, lineHeight: 1.6, opacity: 0.9, maxWidth: 420 }}>
            Giám sát thời tiết thời gian thực, cảnh báo nguy cơ ngập lụt và điều phối ứng cứu hạ tầng viễn thông trên toàn quốc.
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 32 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>10.000</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Nhà trạm giám sát</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,.25)' }} />
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>15</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Tỉnh / thành</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,.25)' }} />
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>24/7</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Trực giám sát</div>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', fontSize: 12, opacity: 0.7 }}>© 2026 VTNet · Tổng Công ty Mạng lưới Viettel</div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EE0033', letterSpacing: 1.5, textTransform: 'uppercase' }}>Đăng nhập hệ thống</div>
          <div style={{ fontSize: 27, fontWeight: 800, marginTop: 8, letterSpacing: -0.4 }}>Chào mừng trở lại</div>
          <div style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Sử dụng tài khoản nội bộ được cấp để truy cập.</div>

          <div style={{ marginTop: 30 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#3A3F47' }}>Tên đăng nhập</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, border: '1.5px solid #E2E5EA', borderRadius: 10, padding: '0 12px', background: '#fff', height: 46 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="3.4" stroke="#9AA0A6" strokeWidth="1.6" />
                <path d="M5 19c.8-3.2 3.6-5 7-5s6.2 1.8 7 5" stroke="#9AA0A6" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                placeholder="VD: nguyenvanan"
                autoFocus
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 14.5, color: '#16181D', background: 'transparent' }}
              />
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#3A3F47' }}>Mật khẩu</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, border: '1.5px solid #E2E5EA', borderRadius: 10, padding: '0 12px', background: '#fff', height: 46 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="10.5" width="14" height="9" rx="2" stroke="#9AA0A6" strokeWidth="1.6" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="#9AA0A6" strokeWidth="1.6" />
              </svg>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                type="password"
                placeholder="Mật khẩu"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 14.5, color: '#16181D', background: 'transparent', letterSpacing: 1 }}
              />
            </div>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 12px', background: '#FDE7EB', border: '1px solid #F7C3CD', borderRadius: 9, fontSize: 12.5, color: '#C20029' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#C20029" strokeWidth="1.6" /><path d="M12 7v6m0 3v.4" stroke="#C20029" strokeWidth="1.8" strokeLinecap="round" /></svg>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, fontSize: 13 }}>
            <label
              onClick={() => setRemember((v) => !v)}
              title="Lưu phiên trên trình duyệt này (localStorage). Bỏ chọn: chỉ giữ trong tab hiện tại."
              style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3A3F47', cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ width: 17, height: 17, borderRadius: 5, background: remember ? '#EE0033' : '#fff', border: remember ? 'none' : '1.5px solid #C4C8CE', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
                {remember && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5l4 4 10-10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              Ghi nhớ đăng nhập
            </label>
          </div>
          <button
            onClick={() => void submit()}
            disabled={loading}
            style={{ marginTop: 24, width: '100%', height: 48, border: 'none', borderRadius: 10, background: '#EE0033', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.75 : 1, boxShadow: '0 8px 20px rgba(238,0,51,.28)' }}
          >
            {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </div>
      </div>
    </div>
  );
}
