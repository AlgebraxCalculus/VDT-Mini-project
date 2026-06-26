import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenModule } from './token.module';

@Module({
  imports: [
    // UsersService provides credential checks + user lookups.
    UsersModule,
    // Shared refresh/blacklist store.
    TokenModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Per-token secrets/TTLs are passed explicitly at sign/verify time
    // (access vs refresh use different secrets), so register without defaults.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
