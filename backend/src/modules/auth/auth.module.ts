import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { WalletOwnerGuard } from './guards/wallet-owner.guard';

@Global()
@Module({
  providers: [AuthService, AuthGuard, WalletOwnerGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard, WalletOwnerGuard],
})
export class AuthModule {}
