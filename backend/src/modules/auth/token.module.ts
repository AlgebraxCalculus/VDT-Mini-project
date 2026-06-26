import { Module } from '@nestjs/common';
import { TokenStoreService } from './token-store.service';

/**
 * Standalone module for the token store so BOTH AuthModule (issue/revoke) and
 * UsersModule (invalidate on role change) can use it without a circular import
 * between those two feature modules.
 */
@Module({
  providers: [TokenStoreService],
  exports: [TokenStoreService],
})
export class TokenModule {}
