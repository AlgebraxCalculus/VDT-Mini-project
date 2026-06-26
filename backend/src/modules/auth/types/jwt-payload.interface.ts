import { RoleCode } from '../../users/entities/role.entity';

/**
 * Claims packed into the access token. RBAC is enforced offline from the token
 * itself (role + permissions), so guards never hit the DB on the hot path.
 */
export interface AccessTokenPayload {
  /** Subject = user id. */
  sub: number;
  username: string;
  role: RoleCode;
  /** Permission codes copied from roles.permissions (JSONB). */
  permissions: string[];
  /** Token type discriminator — guards reject refresh tokens used as access. */
  type: 'access';
  /** Standard JWT claims, populated by @nestjs/jwt. */
  iat?: number;
  exp?: number;
}

/** Refresh token carries the minimum needed to rotate + a unique id (jti). */
export interface RefreshTokenPayload {
  sub: number;
  /** Unique token id used to whitelist/revoke a single refresh token. */
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

/**
 * Shape attached to `request.user` after JwtStrategy validates an access token.
 * This is what @CurrentUser() and RolesGuard read.
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: RoleCode;
  permissions: string[];
}
