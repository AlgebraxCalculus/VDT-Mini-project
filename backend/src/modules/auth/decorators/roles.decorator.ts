import { SetMetadata } from '@nestjs/common';
import { RoleCode } from '../../users/entities/role.entity';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to one or more roles, e.g. @Roles('ADMIN', 'OPERATOR').
 * Read by RolesGuard. Used together with JwtAuthGuard (auth must run first).
 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
