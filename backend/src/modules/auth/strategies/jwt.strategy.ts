import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/jwt-payload.interface';
import { TokenStoreService } from '../token-store.service';

/**
 * Validates the Bearer access token on every protected request.
 * Passport verifies the signature/expiry; we add two checks:
 *   1. the token is an "access" token (not a refresh token replayed here);
 *   2. it hasn't been invalidated (logout / role change) via TokenStore.
 * The returned object becomes `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly tokenStore: TokenStoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Reject tokens issued before the user's last invalidation cut-off.
    if (!(await this.tokenStore.isTokenStillValid(payload.sub, payload.iat))) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
  }
}
