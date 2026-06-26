import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenModule } from '../auth/token.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [
    // Repository layer for User + Role.
    TypeOrmModule.forFeature([User, Role]),
    // Needed to invalidate tokens on role change / deletion.
    TokenModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so AuthModule can verify credentials & mint tokens.
  exports: [UsersService],
})
export class UsersModule {}
