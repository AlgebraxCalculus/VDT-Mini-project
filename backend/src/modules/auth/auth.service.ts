import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { RoleCode } from '../users/entities/role.entity';
import { UsersService } from '../users/users.service';
import {
  AccessTokenPayload,
  AuthenticatedUser,
  RefreshTokenPayload,
} from './types/jwt-payload.interface';
import { TokenStoreService } from './token-store.service';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: string;
}

export interface LoginResult extends AuthTokens {
  user: {
    id: number;
    username: string;
    email: string;
    fullName: string | null;
    role: RoleCode | null;
    permissions: string[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
  ) {}

  /** Verify credentials, reject inactive accounts, mint tokens, stamp last login. */
  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.usersService.findByUsernameWithSecret(username);

    // One generic message for no-user and wrong-password so usernames don't leak.
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    const tokens = await this.issueTokens(user);
    await this.usersService.touchLastLogin(user.id);

    return {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role?.code ?? null,
        permissions: user.role?.permissions ?? [],
      },
    };
  }

  /**
   * Rotating refresh: verify the token, ensure its jti is still whitelisted, revoke
   * it, reload the user (role may have changed), and mint a fresh pair.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.config.get<string>('JWT_REFRESH_SECRET') },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // One-time-use: the jti must still be whitelisted.
    if (!(await this.tokenStore.isRefreshTokenValid(payload.jti, payload.sub))) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Also honor the global invalidation epoch.
    if (!(await this.tokenStore.isTokenStillValid(payload.sub, payload.iat))) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.usersService.findEntityById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer active');
    }

    await this.tokenStore.revokeRefreshToken(payload.jti);
    return this.issueTokens(user);
  }

  /** Revoke the refresh token and bump the user's epoch so the access token dies too. */
  async logout(userId: number, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
          refreshToken,
          { secret: this.config.get<string>('JWT_REFRESH_SECRET') },
        );
        if (payload.type === 'refresh') {
          await this.tokenStore.revokeRefreshToken(payload.jti);
        }
      } catch {
        // Malformed/expired refresh token on logout is non-fatal.
      }
    }
    await this.tokenStore.invalidateUser(userId);
  }

  /** GET /auth/me — re-reads the user so the FE gets the current role/permissions. */
  async getProfile(userId: number): Promise<LoginResult['user']> {
    const user = await this.usersService.findEntityById(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role?.code ?? null,
      permissions: user.role?.permissions ?? [],
    };
  }

  // --- Token minting ---

  /** Build + sign the access/refresh pair and whitelist the refresh jti. */
  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      role: (user.role?.code as RoleCode) ?? RoleCode.VIEWER,
      permissions: user.role?.permissions ?? [],
      type: 'access',
    };

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti,
      type: 'refresh',
    };

    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '900s';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';

    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ]);

    await this.tokenStore.saveRefreshToken(jti, user.id);

    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: accessTtl,
    };
  }

  buildAuthenticatedUser(payload: AccessTokenPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions,
    };
  }
}
