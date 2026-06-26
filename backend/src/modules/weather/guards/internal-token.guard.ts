import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Minimal request shape — avoids depending on @types/express here. */
interface RequestWithHeader {
  header(name: string): string | undefined;
}

/**
 * Protects scheduler-only internal endpoints (API 34) with a shared secret in
 * the `X-Internal-Token` header. The route is also @Public() so the global JWT
 * guard skips it — this guard is the only gate. If INTERNAL_API_TOKEN is unset,
 * the endpoint is closed (deny by default).
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!expected) {
      throw new UnauthorizedException('Internal endpoint disabled');
    }
    const req = context.switchToHttp().getRequest<RequestWithHeader>();
    const provided = req.header('x-internal-token');
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}
