import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthRequestLike } from '../auth.types';

@Injectable()
export class WalletOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequestLike>();
    const authWallet = req.auth?.wallet;
    const paramWallet = req.params?.wallet;
    const bodyWallet = typeof req.body?.wallet === 'string' ? req.body.wallet : undefined;
    const requestedWallet = paramWallet ?? bodyWallet;

    if (!authWallet || !requestedWallet || authWallet !== requestedWallet) {
      throw new ForbiddenException('Wallet mismatch');
    }

    return true;
  }
}
