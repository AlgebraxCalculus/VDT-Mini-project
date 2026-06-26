import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleCode } from '../../users/entities/role.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.interface';

/**
 * RBAC authorization guard. Runs AFTER JwtAuthGuard, so `request.user` is set.
 * Reads the roles declared by @Roles(...) and lets the request through only if
 * the user's role is in the allowed set. Routes without @Roles are unrestricted
 * (any authenticated user) by design.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles on the route -> no role restriction.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!user) {
      throw new ForbiddenException('Missing authentication context');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Requires one of roles: ${requiredRoles.join(', ')}`,
      );
    }
    return true;
  }
}
