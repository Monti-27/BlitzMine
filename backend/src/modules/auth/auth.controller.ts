import {
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { AuthRequestLike } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  @Post('privy/session')
  @ApiOperation({ summary: 'Exchange a Privy token for backend session tokens' })
  async exchangePrivySession(@Req() req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader || Array.isArray(authHeader)) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    return this.authService.exchangePrivyToken(token, this.getClientIp(req));
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Revoke current auth session' })
  async logout(@Req() req: AuthRequestLike) {
    const sessionId = req.auth?.sessionId;
    if (!sessionId) {
      throw new UnauthorizedException('Session not found');
    }
    await this.authService.revokeSessionFamily(sessionId);
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get current auth identity' })
  async me(@Req() req: AuthRequestLike) {
    return {
      wallet: req.auth?.wallet ?? null,
      sessionId: req.auth?.sessionId ?? null,
      exp: req.auth?.exp ?? null,
    };
  }
}
