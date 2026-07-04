import type { RoleCode } from './api';
import type { Account, Role, RouteKey } from '../types';

export const ROLE_ORDER: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

// --- Bridge between backend role codes and the FE role model ---

/** Backend RoleCode → FE Role (sidebar gating); VIEWER is the floor. */
export function roleFromCode(code: RoleCode | null): Role {
  if (code === 'ADMIN') return 'admin';
  if (code === 'OPERATOR') return 'operator';
  return 'viewer';
}

/** Backend RoleCode → the capitalised label shown on the accounts list. */
export function codeToAccountRole(code: RoleCode | null): Account['role'] {
  if (code === 'ADMIN') return 'Admin';
  if (code === 'OPERATOR') return 'Operator';
  return 'Viewer';
}

/** Accounts-list label → backend RoleCode (for create / change-role payloads). */
export function accountRoleToCode(role: Account['role']): RoleCode {
  if (role === 'Admin') return 'ADMIN';
  if (role === 'Operator') return 'OPERATOR';
  return 'VIEWER';
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  operator: 'Operator',
  admin: 'Quản trị viên',
};

export const ROLE_COLOR: Record<Role, string> = {
  viewer: '#0E7490',
  operator: '#B45309',
  admin: '#EE0033',
};

export const ROLE_USER_NAME: Record<Role, string> = {
  viewer: 'Lê Văn Cường',
  operator: 'Trần Thị Bình',
  admin: 'Nguyễn Văn An',
};

export const LOCK_MIN: Partial<Record<RouteKey, number>> = {
  stations: 1,
  import: 1,
  events: 1,
  accounts: 2,
  // Admin-only, matching API 35's @Roles(ADMIN).
  health: 2,
};

export function isLocked(role: Role, route: RouteKey): boolean {
  const min = LOCK_MIN[route];
  if (min == null) return false;
  return ROLE_ORDER[role] < min;
}

export const PAGE_TITLES: Record<RouteKey, [string, string]> = {
  login: ['', ''],
  map: ['Bản đồ trực tuyến', 'Giám sát thời gian thực · cập nhật qua WebSocket'],
  forecast: ['Dự báo nguy cơ ngập', 'Danh sách trạm rủi ro 5 ngày tới'],
  stations: ['Quản lý nhà trạm', 'Tạo, sửa, xóa và tra cứu nhà trạm'],
  import: ['Nhập trạm hàng loạt', 'Tải lên & xử lý bất đồng bộ theo lô'],
  events: ['Sự kiện thiên tai', 'Quản lý sự kiện & phạm vi ảnh hưởng'],
  accounts: ['Tài khoản & Phân quyền', 'Quản lý người dùng theo vai trò (RBAC)'],
  health: ['Tình trạng hệ thống', 'Kết nối API bên thứ 3 & tác vụ nền'],
};
