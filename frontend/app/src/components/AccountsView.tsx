import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useApp } from '../state/AppStateContext';
import {
  ApiError,
  apiChangeRole,
  apiCreateUser,
  apiDeleteUser,
  apiListRoles,
  apiListUsers,
  apiUpdateUser,
  type ApiRole,
  type ApiUser,
} from '../lib/api';
import { accountRoleToCode, codeToAccountRole } from '../lib/role';
import type { Account } from '../types';

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

// 3 vai trò RBAC + màu + mô tả phạm vi quyền (khớp data/roles.csv).
const ROLE_META: { key: Account['role']; color: string; desc: string }[] = [
  { key: 'Admin', color: '#EE0033', desc: 'Toàn quyền: quản lý tài khoản, healthcheck API và mọi quyền của Operator.' },
  { key: 'Operator', color: '#B45309', desc: 'Vận hành: CRUD trạm/sự kiện, làm mới thời tiết thủ công, xuất báo cáo.' },
  { key: 'Viewer', color: '#0E7490', desc: 'Chỉ đọc: tra cứu, xem bản đồ, tải báo cáo có sẵn.' },
];

const ROLE_COLOR: Record<Account['role'], string> = {
  Admin: '#EE0033',
  Operator: '#B45309',
  Viewer: '#0E7490',
};

// Khung dropdown chỉnh nhanh vai trò / trạng thái ngay trên danh sách.
const menuWrap: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 30,
  background: '#fff',
  border: '1px solid #E8EAEE',
  borderRadius: 10,
  boxShadow: '0 12px 32px rgba(16,20,30,.18)',
  padding: 5,
  minWidth: 156,
};

const menuItem = (on: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  border: 'none',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 12.5,
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  background: on ? '#F5F6F8' : 'transparent',
  color: '#3A3F47',
});

const checkIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 'auto' }}>
    <path d="M5 12.5l4 4 10-10" stroke="#16A34A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const caretIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 1 }}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AccountsView() {
  const { state, patch, showToast } = useApp();
  const { acctForm } = state;

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Dropdown chỉnh nhanh đang mở (theo dòng + loại trường).
  const [menu, setMenu] = useState<{ id: number; type: 'role' | 'status' } | null>(null);

  // Load the account list (GET /users) + the RBAC catalog (GET /roles).
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        apiListUsers({ size: 100 }),
        apiListRoles(),
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách tài khoản.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch: sync the list/roles from the backend (legitimate effect use).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const roleIdOf = (role: Account['role']) =>
    roles.find((r) => r.code === accountRoleToCode(role))?.id;

  const accRows = users.map((u) => {
    const roleLabel = codeToAccountRole(u.role?.code ?? null);
    const name = u.fullName?.trim() || u.username;
    return {
      id: u.id,
      name,
      user: u.username,
      role: roleLabel,
      roleColor: ROLE_COLOR[roleLabel],
      isActive: u.isActive,
      statusLabel: u.isActive ? 'Hoạt động' : 'Đã khóa',
      statusColor: u.isActive ? '#16A34A' : '#94A3B8',
      statusBg: u.isActive ? '#ECFDF3' : '#F1F5F9',
      initial: (name.split(' ').pop() ?? '?')[0],
      last: fmtDate(u.lastLoginAt),
    };
  });

  const openAcctForm = () =>
    patch({ acctForm: { name: '', user: '', email: '', password: '', role: 'Viewer' } });
  const closeAcctForm = () => patch({ acctForm: null });
  const setAcct = (k: string, v: string) =>
    patch((s) => (s.acctForm ? { acctForm: { ...s.acctForm, [k]: v } } : {}));

  // Validation realtime (chỉ báo khi field đã nhập, giống pattern toạ độ ở StationsView).
  const af = acctForm;
  const emailErr = !!af && af.email !== '' && !emailOk(af.email);
  const pwErr = !!af && af.password !== '' && af.password.length < 8;
  const roleDesc = af ? ROLE_META.find((r) => r.key === af.role)!.desc : '';

  // POST /users (auto-hash Bcrypt). Trạng thái "khóa" -> PATCH isActive=false sau khi tạo.
  const saveAcctForm = async () => {
    if (!af || saving) return;
    if (!af.name.trim()) return showToast('Vui lòng nhập họ tên hiển thị.');
    if (!af.user.trim()) return showToast('Vui lòng nhập tên đăng nhập.');
    if (!emailOk(af.email)) return showToast('Email không hợp lệ. Vui lòng kiểm tra lại.');
    if (af.password.length < 8) return showToast('Mật khẩu phải có tối thiểu 8 ký tự.');

    const roleId = roleIdOf(af.role);
    if (!roleId) return showToast('Không xác định được nhóm quyền. Thử tải lại trang.');

    setSaving(true);
    try {
      // Tài khoản mới luôn ở trạng thái Hoạt động (khóa sau bằng cột trạng thái).
      await apiCreateUser({
        username: af.user.trim(),
        email: af.email.trim(),
        password: af.password,
        fullName: af.name.trim(),
        roleId,
      });
      patch({ acctForm: null });
      showToast(`Đã tạo tài khoản "${af.name.trim()}" · vai trò ${af.role} · mật khẩu đã hash bằng Bcrypt.`);
      void reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Tên đăng nhập hoặc email đã tồn tại.');
      } else {
        showToast(err instanceof ApiError ? err.message : 'Tạo tài khoản thất bại.');
      }
    } finally {
      setSaving(false);
    }
  };

  // DELETE /users/{id} — backend chặn xóa admin cuối / tự xóa (403).
  const removeUser = async (id: number, name: string) => {
    if (!window.confirm(`Xóa tài khoản "${name}"? Hành động này không thể hoàn tác.`)) return;
    try {
      await apiDeleteUser(id);
      showToast(`Đã xóa tài khoản "${name}".`);
      void reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Xóa tài khoản thất bại.');
    }
  };

  // PUT /users/{id}/role — đổi nhóm quyền sang vai trò admin chọn (revoke token user đó).
  const changeRole = async (id: number, current: Account['role'], next: Account['role'], name: string) => {
    setMenu(null);
    if (next === current) return;
    const roleId = roleIdOf(next);
    if (!roleId) return showToast('Không xác định được nhóm quyền. Thử tải lại trang.');
    try {
      await apiChangeRole(id, roleId);
      showToast(`Đã đổi vai trò "${name}" → ${next} · token của tài khoản đã bị thu hồi.`);
      void reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Đổi vai trò thất bại.');
    }
  };

  // PATCH /users/{id} — khóa / mở khóa tài khoản (đổi isActive).
  const changeStatus = async (id: number, current: boolean, next: boolean, name: string) => {
    setMenu(null);
    if (next === current) return;
    try {
      await apiUpdateUser(id, { isActive: next });
      showToast(`Đã ${next ? 'mở khóa' : 'khóa'} tài khoản "${name}".`);
      void reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Cập nhật trạng thái thất bại.');
    }
  };

  const emailStyle: CSSProperties = { ...inputBase, border: `1.5px solid ${emailErr ? '#EE0033' : '#E2E5EA'}` };
  const pwStyle: CSSProperties = { ...inputBase, marginBottom: pwErr ? 4 : 16, border: `1.5px solid ${pwErr ? '#EE0033' : '#E2E5EA'}` };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      {menu && <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Tài khoản người dùng</div>
          <span style={{ fontSize: 12, color: '#9AA0A6' }}>{loading ? 'đang tải…' : `${users.length} tài khoản`}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={openAcctForm}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px', border: 'none', background: '#EE0033', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
            Thêm
          </button>
        </div>

        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#FDE7EB', border: '1px solid #F7C3CD', borderRadius: 12, fontSize: 13, color: '#C20029' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#C20029" strokeWidth="1.6" /><path d="M12 7v6m0 3v.4" stroke="#C20029" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => void reload()} style={{ height: 32, padding: '0 12px', border: '1px solid #F2A9B6', background: '#fff', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#C20029', cursor: 'pointer' }}>Thử lại</button>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14 }}>
            {loading && (
              <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Đang tải danh sách tài khoản…</div>
            )}
            {!loading && accRows.length === 0 && (
              <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: '#9AA0A6' }}>Chưa có tài khoản nào.</div>
            )}
            {!loading && accRows.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #F2F3F5' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: a.roleColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' }}>{a.initial}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace" }}>{a.user} · đăng nhập {a.last}</div>
                </div>
                <div style={{ position: 'relative', flex: 'none' }}>
                  <button
                    onClick={() => setMenu((m) => (m?.id === a.id && m.type === 'role' ? null : { id: a.id, type: 'role' }))}
                    title="Đổi nhóm quyền (PUT /users/:id/role)"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: a.roleColor, padding: '3px 8px 3px 10px', borderRadius: 7, border: 'none', cursor: 'pointer' }}
                  >
                    {a.role}
                    {caretIcon}
                  </button>
                  {menu?.id === a.id && menu.type === 'role' && (
                    <div style={menuWrap}>
                      {ROLE_META.map((r) => (
                        <button key={r.key} onClick={() => void changeRole(a.id, a.role, r.key, a.name)} style={menuItem(r.key === a.role)}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flex: 'none' }} />
                          {r.key}
                          {r.key === a.role && checkIcon}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative', flex: 'none', width: 96 }}>
                  <button
                    onClick={() => setMenu((m) => (m?.id === a.id && m.type === 'status' ? null : { id: a.id, type: 'status' }))}
                    title="Khóa / mở khóa tài khoản (PATCH /users/:id)"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: a.statusColor, background: a.statusBg, padding: '4px 9px', borderRadius: 7, width: '100%', border: 'none', cursor: 'pointer', justifyContent: 'center' }}
                  >
                    {a.statusLabel}
                    {caretIcon}
                  </button>
                  {menu?.id === a.id && menu.type === 'status' && (
                    <div style={menuWrap}>
                      <button onClick={() => void changeStatus(a.id, a.isActive, true, a.name)} style={menuItem(a.isActive)}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A', flex: 'none' }} />
                        Hoạt động
                        {a.isActive && checkIcon}
                      </button>
                      <button onClick={() => void changeStatus(a.id, a.isActive, false, a.name)} style={menuItem(!a.isActive)}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94A3B8', flex: 'none' }} />
                        Đã khóa
                        {!a.isActive && checkIcon}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void removeUser(a.id, a.name)}
                  title="Xóa tài khoản"
                  style={{ width: 30, height: 30, border: '1px solid #F3C9D1', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#D11A3A', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '11px 14px', background: '#F3F8FF', border: '1px solid #D6E6FB', borderRadius: 10, fontSize: 12, color: '#1E4FA3' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#2563EB" strokeWidth="1.6" /><path d="M12 11v5m0-8v.4" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" /></svg>
          Xác thực bằng JWT · đổi vai trò sẽ thu hồi token của tài khoản đó tức thì.
        </div>
      </div>
      <div style={{ height: 24 }} />

      {af && (
        <>
          <div onClick={closeAcctForm} style={{ position: 'absolute', inset: 0, background: 'rgba(20,24,32,.32)', zIndex: 40 }} />
          <div className="fws-fade" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 420, background: '#fff', zIndex: 50, boxShadow: '-12px 0 40px rgba(16,20,30,.18)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Thêm tài khoản mới</div>
                <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 2 }}>Hash mật khẩu (Bcrypt) · gán vai trò RBAC</div>
              </div>
              <button onClick={closeAcctForm} style={{ width: 32, height: 32, border: 'none', background: '#F1F2F4', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Họ tên hiển thị</label>
              <input value={af.name} onChange={(e) => setAcct('name', e.target.value)} placeholder="VD: Nguyễn Văn An" style={inputBase} />

              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Tên đăng nhập</label>
              <input value={af.user} onChange={(e) => setAcct('user', e.target.value)} placeholder="VD: an.nv" style={{ ...inputBase, fontFamily: "'IBM Plex Mono',monospace" }} />

              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Email</label>
              <input value={af.email} onChange={(e) => setAcct('email', e.target.value)} placeholder="VD: an.nv@hsms.vn" style={emailStyle} />
              {emailErr && <div style={{ fontSize: 11, color: '#EE0033', marginTop: -12, marginBottom: 16 }}>Email không đúng định dạng.</div>}

              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>
                Mật khẩu <span style={{ color: '#9AA0A6', fontWeight: 500 }}>(tối thiểu 8 ký tự)</span>
              </label>
              <input type="password" value={af.password} onChange={(e) => setAcct('password', e.target.value)} placeholder="••••••••" style={pwStyle} />
              {pwErr && <div style={{ fontSize: 11, color: '#EE0033', marginTop: 0, marginBottom: 16 }}>Mật khẩu phải có tối thiểu 8 ký tự.</div>}

              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#3A3F47' }}>Nhóm quyền (RBAC)</label>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0 10px' }}>
                {ROLE_META.map((r) => {
                  const on = af.role === r.key;
                  return (
                    <button
                      key={r.key}
                      onClick={() => setAcct('role', r.key)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${on ? r.color : '#E2E5EA'}`, background: on ? r.color : '#fff', color: on ? '#fff' : '#4A4F57' }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? '#fff' : r.color, flex: 'none' }} />
                      {r.key}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, padding: '10px 12px', background: '#F3F8FF', border: '1px solid #D6E6FB', borderRadius: 9 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke="#2563EB" strokeWidth="1.6" /><path d="M12 11v5m0-8v.4" stroke="#2563EB" strokeWidth="1.7" strokeLinecap="round" /></svg>
                <span style={{ fontSize: 12, color: '#1E4FA3', lineHeight: 1.45 }}>{roleDesc}</span>
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #EEF0F3', display: 'flex', gap: 10 }}>
              <button onClick={closeAcctForm} style={{ flex: 1, height: 44, border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Hủy</button>
              <button onClick={() => void saveAcctForm()} disabled={saving} style={{ flex: 1.4, height: 44, border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#fff', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.75 : 1 }}>{saving ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
