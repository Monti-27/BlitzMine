import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { verifyWalletSignature } from '../../utils/crypto';
import { isValidSolanaAddress, isValidSignature } from '../../utils/validation';
import { AuthClaims } from './auth.types';

interface AuthTokenPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

interface VerifyOptions {
  issueSession: boolean;
}

interface PrivyWalletCacheEntry {
  wallet: string;
  expiresAtMs: number;
}

export interface SessionTokens {
  wallet: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly challengeTtlSec: number;
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;
  private readonly tokenSecret: string;
  private readonly isProduction: boolean;
  private readonly privyAppId: string;
  private readonly privyAppSecret: string;
  private readonly privyClient: PrivyClient | null;
  private readonly privyWalletCache = new Map<string, PrivyWalletCacheEntry>();
  private readonly privyWalletCacheTtlMs = 300_000;
  private readonly authDebug: boolean;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.challengeTtlSec = Number(this.config.get('AUTH_CHALLENGE_TTL_SEC') ?? 120);
    this.accessTtlSec = Number(
      this.config.get('AUTH_ACCESS_TTL_SEC') ?? this.config.get('AUTH_SESSION_TTL_SEC') ?? 900,
    );
    this.refreshTtlSec = Number(this.config.get('AUTH_REFRESH_TTL_SEC') ?? 604800);
    this.tokenSecret = this.config.get<string>('AUTH_TOKEN_SECRET') ?? '';
    this.isProduction = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
    this.privyAppId = this.config.get<string>('PRIVY_APP_ID') ?? '';
    this.privyAppSecret =
      this.config.get<string>('PRIVY_APP_SECRET') ??
      this.config.get<string>('PRIVY_SECRET') ??
      '';
    this.authDebug = (this.config.get<string>('AUTH_DEBUG') ?? '').toLowerCase() === 'true';

    if (!this.tokenSecret) {
      if (this.isProduction) {
        throw new Error('AUTH_TOKEN_SECRET must be set in production');
      }
      this.logger.warn('AUTH_TOKEN_SECRET is not set; dev-mode auth secret fallback is enabled');
    }

    if (this.authDebug) {
      this.logger.log(
        `Privy config loaded (nodeEnv=${process.env.NODE_ENV ?? 'unknown'}, appIdPresent=${Boolean(this.privyAppId)}, secretPresent=${Boolean(this.privyAppSecret)})`,
      );
    }

    if (!this.privyAppId || !this.privyAppSecret) {
      if (this.isProduction) {
        throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set in production');
      }
      this.logger.warn('PRIVY_APP_ID/PRIVY_APP_SECRET not set; Privy-backed auth exchange is disabled');
      this.privyClient = null;
    } else {
      this.privyClient = new PrivyClient(this.privyAppId, this.privyAppSecret);
      if (this.authDebug) {
        this.logger.log(
          `Privy auth initialized (appId=${this.privyAppId}, secretConfigured=${Boolean(this.privyAppSecret)})`,
        );
      }
    }
  }

  async exchangePrivyToken(privyToken: string, clientIp: string): Promise<SessionTokens> {
    if (!this.privyClient) {
      throw this.authError('PRIVY_NOT_CONFIGURED', 'Privy auth is not configured');
    }
    if (!privyToken || typeof privyToken !== 'string') {
      throw this.authError('MISSING_PRIVY_TOKEN', 'Missing Privy token');
    }

    await this.consumeRateLimit(`ip:${clientIp}`, 'auth_privy_exchange', 180, 60_000);

    if (this.authDebug) {
      this.logger.log('Privy session exchange requested');
    }

    let user:
      | {
          id?: string;
          wallet?: { address?: string; chainType?: string };
          linkedAccounts?: Array<{
            type?: string;
            address?: string;
            chainType?: string;
          }>;
        }
      | null
      | undefined;
    let tokenPath: 'id_token' | 'access_token' | 'none' = 'none';
    try {
      // Identity tokens from frontend must be verified using getUser({idToken}).
      user = await this.privyClient.getUser({ idToken: privyToken });
      tokenPath = 'id_token';
    } catch (error) {
      if (this.authDebug) {
        this.logger.warn(
          `Privy id token verification failed (privy_token_path=id_token): ${this.describePrivyVerificationError(error)}`,
        );
      }
    }

    if (!user) {
      try {
        const claims = await this.privyClient.verifyAuthToken(privyToken);
        const userId = (claims?.userId ?? '').trim();
        if (!userId) {
          throw new Error('Missing userId in Privy access token claims');
        }
        if (this.authDebug) {
          this.logger.log('Privy access token verified (privy_token_path=access_token)');
        }
        user = await this.privyClient.getUser(userId);
        tokenPath = 'access_token';
      } catch (error) {
        if (this.authDebug) {
          this.logger.error('Privy token verification failed (privy_token_path=none)');
        }
        throw this.authError('INVALID_PRIVY_TOKEN', 'Invalid Privy token');
      }
    }

    const wallet = await this.resolveWalletFromPrivyUser(user);
    if (this.authDebug) {
      this.logger.log(`Privy exchange resolved (privy_token_path=${tokenPath})`);
    }
    return this.createSession(wallet, null, null);
  }

  async exchangePrivyIdentityToken(privyIdentityToken: string, clientIp: string): Promise<SessionTokens> {
    return this.exchangePrivyToken(privyIdentityToken, clientIp);
  }

  async exchangePrivyAccessToken(privyAccessToken: string, clientIp: string): Promise<SessionTokens> {
    return this.exchangePrivyToken(privyAccessToken, clientIp);
  }

  async createChallenge(wallet: string, clientIp: string) {
    if (!isValidSolanaAddress(wallet)) {
      throw new BadRequestException('Invalid Solana wallet address');
    }

    await this.consumeRateLimit(`wallet:${wallet}`, 'auth_challenge', 10, 60_000);
    await this.consumeRateLimit(`ip:${clientIp}`, 'auth_challenge', 40, 60_000);

    const nowMs = Date.now();
    const expiresAtMs = nowMs + this.challengeTtlSec * 1000;
    const nonce = randomBytes(16).toString('hex');

    const message = [
      'BlitzMine Auth',
      `Wallet: ${wallet}`,
      `Nonce: ${nonce}`,
      `Issued At: ${nowMs}`,
      `Expires At: ${expiresAtMs}`,
    ].join('\n');

    const challenge = await this.db.walletChallenge.create({
      data: {
        wallet,
        message,
        expiresAt: new Date(expiresAtMs),
      },
      select: {
        id: true,
        message: true,
        expiresAt: true,
      },
    });

    return {
      challengeId: challenge.id,
      wallet,
      message: challenge.message,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async verifyAndIssueSession(
    wallet: string,
    challengeId: string,
    signature: string,
    clientIp: string,
  ) {
    await this.consumeRateLimit(`wallet:${wallet}`, 'auth_verify', 20, 60_000);
    await this.consumeRateLimit(`ip:${clientIp}`, 'auth_verify', 80, 60_000);

    return this.verifyChallengeInternal(wallet, challengeId, signature, {
      issueSession: true,
    });
  }

  async refreshSession(refreshToken: string, clientIp: string): Promise<SessionTokens> {
    await this.consumeRateLimit(`ip:${clientIp}`, 'auth_refresh', 120, 60_000);

    const parsed = this.parseRefreshToken(refreshToken);
    const now = new Date();
    const session = await this.db.authSession.findUnique({ where: { id: parsed.sessionId } });

    if (!session) {
      throw this.authError('SESSION_NOT_FOUND', 'Session not found');
    }

    if (session.replacedBySessionId) {
      await this.revokeSessionFamilyByFamilyId(session.familyId ?? session.id, 'refresh_reuse_detected');
      throw this.authError('REFRESH_TOKEN_REUSED', 'Refresh token already used');
    }

    if (session.revokedAt) {
      throw this.authError('SESSION_REVOKED', 'Session revoked');
    }

    if (!session.refreshTokenHash || !session.refreshExpiresAt) {
      throw this.authError('REFRESH_NOT_AVAILABLE', 'Refresh token not available for this session');
    }

    if (session.refreshExpiresAt.getTime() <= now.getTime()) {
      throw this.authError('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
    }

    await this.consumeRateLimit(`wallet:${session.wallet}`, 'auth_refresh', 60, 60_000);

    const expectedHash = this.hashRefreshSecret(parsed.secret);
    if (!this.secureStringEquals(expectedHash, session.refreshTokenHash)) {
      throw this.authError('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    }

    const nextSessionId = randomUUID();
    const nextFamilyId = session.familyId ?? session.id;
    const nextRefreshSecret = this.generateRefreshSecret();
    const nextRefreshHash = this.hashRefreshSecret(nextRefreshSecret);
    const nowSec = Math.floor(Date.now() / 1000);
    const accessExp = nowSec + this.accessTtlSec;
    const refreshExpDate = new Date(Date.now() + this.refreshTtlSec * 1000);

    try {
      await this.db.$transaction(async (tx) => {
        const replaced = await tx.authSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            replacedBySessionId: null,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: 'rotated',
            replacedBySessionId: nextSessionId,
          },
        });

        if (replaced.count === 0) {
          throw new Error('REFRESH_TOKEN_REUSED');
        }

        await tx.authSession.create({
          data: {
            id: nextSessionId,
            wallet: session.wallet,
            familyId: nextFamilyId,
            parentSessionId: session.id,
            expiresAt: new Date(accessExp * 1000),
            refreshExpiresAt: refreshExpDate,
            refreshTokenHash: nextRefreshHash,
          },
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'REFRESH_TOKEN_REUSED') {
        await this.revokeSessionFamilyByFamilyId(nextFamilyId, 'refresh_reuse_detected');
        throw this.authError('REFRESH_TOKEN_REUSED', 'Refresh token already used');
      }
      throw err;
    }

    return {
      wallet: session.wallet,
      accessToken: this.signToken({
        sub: session.wallet,
        sid: nextSessionId,
        iat: nowSec,
        exp: accessExp,
      }),
      accessTokenExpiresAt: new Date(accessExp * 1000).toISOString(),
      refreshToken: `${nextSessionId}.${nextRefreshSecret}`,
      refreshTokenExpiresAt: refreshExpDate.toISOString(),
    };
  }

  async verifyChallengeForSocket(wallet: string, challengeId: string, signature: string) {
    await this.verifyChallengeInternal(wallet, challengeId, signature, {
      issueSession: false,
    });

    return { wallet };
  }

  private async verifyChallengeInternal(
    wallet: string,
    challengeId: string,
    signature: string,
    options: VerifyOptions,
  ) {
    if (!isValidSolanaAddress(wallet)) {
      throw new BadRequestException('Invalid Solana wallet address');
    }
    if (!isValidSignature(signature)) {
      throw new BadRequestException('Invalid signature encoding');
    }

    const challenge = await this.db.walletChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw this.authError('CHALLENGE_NOT_FOUND', 'Challenge not found');
    }
    if (challenge.wallet !== wallet) {
      throw this.authError('CHALLENGE_WALLET_MISMATCH', 'Challenge wallet mismatch');
    }
    if (challenge.consumedAt) {
      throw this.authError('CHALLENGE_ALREADY_USED', 'Challenge already used');
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw this.authError('CHALLENGE_EXPIRED', 'Challenge expired');
    }

    const valid = verifyWalletSignature(challenge.message, signature, wallet);
    if (!valid) {
      throw this.authError('INVALID_SIGNATURE', 'Invalid wallet signature');
    }

    const consumeResult = await this.db.walletChallenge.updateMany({
      where: { id: challengeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumeResult.count === 0) {
      throw this.authError('CHALLENGE_ALREADY_USED', 'Challenge already used');
    }

    if (!options.issueSession) {
      return { wallet, challengeId };
    }

    return this.createSession(wallet, null, null);
  }

  async verifyAccessToken(token: string): Promise<AuthClaims> {
    const payload = this.decodeAndVerifyToken(token);
    await this.getActiveSession(payload.sid, payload.sub);
    const now = new Date();
    await this.bumpSessionLastSeen(payload.sid, now);

    return {
      wallet: payload.sub,
      sessionId: payload.sid,
      iat: payload.iat,
      exp: payload.exp,
    };
  }

  async assertSessionActive(sessionId: string, wallet: string): Promise<void> {
    await this.getActiveSession(sessionId, wallet);
    await this.bumpSessionLastSeen(sessionId, new Date());
  }

  private async bumpSessionLastSeen(sessionId: string, now: Date): Promise<void> {
    await this.db.authSession
      .updateMany({
        where: {
          id: sessionId,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - 60_000) } }],
        },
        data: { lastSeenAt: now },
      })
      .catch(() => {
        // Best-effort activity signal.
      });
  }

  private async getActiveSession(sessionId: string, wallet: string) {
    const session = await this.db.authSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw this.authError('SESSION_NOT_FOUND', 'Session not found');
    }
    if (session.wallet !== wallet) {
      throw this.authError('SESSION_WALLET_MISMATCH', 'Session wallet mismatch');
    }
    if (session.revokedAt) {
      throw this.authError('SESSION_REVOKED', 'Session revoked');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw this.authError('SESSION_EXPIRED', 'Session expired');
    }

    return session;
  }

  private async resolveWalletFromPrivyUser(
    user:
      | {
          id?: string;
          wallet?: { address?: string; chainType?: string };
          linkedAccounts?: Array<{
            type?: string;
            address?: string;
            chainType?: string;
          }>;
        }
      | null
      | undefined,
  ): Promise<string> {
    const userId = (user?.id ?? '').trim();
    const cached = userId ? this.privyWalletCache.get(userId) : undefined;
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.wallet;
    }

    const primaryWalletAddress =
      user?.wallet?.chainType === 'solana' ? user.wallet.address : undefined;
    const linkedWalletAddress = user?.linkedAccounts?.find(
      (account) =>
        account?.type === 'wallet' &&
        account?.chainType === 'solana' &&
        typeof account?.address === 'string',
    )?.address;

    const wallet = (primaryWalletAddress ?? linkedWalletAddress ?? '').trim();
    if (!wallet || !isValidSolanaAddress(wallet)) {
      throw this.authError('PRIVY_SOLANA_WALLET_REQUIRED', 'No valid Solana wallet linked to Privy user');
    }

    if (userId) {
      this.privyWalletCache.set(userId, {
        wallet,
        expiresAtMs: Date.now() + this.privyWalletCacheTtlMs,
      });
    }

    return wallet;
  }

  private describePrivyVerificationError(error: unknown): string {
    if (error instanceof Error) {
      const withCause = error as Error & { cause?: unknown };
      const cause =
        withCause.cause !== undefined
          ? `; cause=${this.safeJson(withCause.cause)}`
          : '';
      return `${error.name}: ${error.message}${cause}`;
    }
    if (typeof error === 'object' && error !== null) {
      return this.safeJson(error);
    }
    return typeof error === 'string' ? error : String(error);
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  async revokeSessionFamily(sessionId: string) {
    const session = await this.db.authSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const familyId = session.familyId ?? session.id;
    await this.revokeSessionFamilyByFamilyId(familyId, 'logout');
  }

  private async revokeSessionFamilyByFamilyId(familyId: string, reason: string) {
    await this.db.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });

    await this.db.authSession.updateMany({
      where: { id: familyId, familyId: null, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  private async createSession(
    wallet: string,
    familyId: string | null,
    parentSessionId: string | null,
  ): Promise<SessionTokens> {
    const sessionId = randomUUID();
    const effectiveFamilyId = familyId ?? sessionId;
    const refreshSecret = this.generateRefreshSecret();
    const refreshHash = this.hashRefreshSecret(refreshSecret);
    const now = Math.floor(Date.now() / 1000);
    const accessExp = now + this.accessTtlSec;
    const refreshExpDate = new Date(Date.now() + this.refreshTtlSec * 1000);

    await this.db.authSession.create({
      data: {
        id: sessionId,
        wallet,
        familyId: effectiveFamilyId,
        parentSessionId,
        expiresAt: new Date(accessExp * 1000),
        refreshExpiresAt: refreshExpDate,
        refreshTokenHash: refreshHash,
      },
    });

    return {
      wallet,
      accessToken: this.signToken({ sub: wallet, sid: sessionId, iat: now, exp: accessExp }),
      accessTokenExpiresAt: new Date(accessExp * 1000).toISOString(),
      refreshToken: `${sessionId}.${refreshSecret}`,
      refreshTokenExpiresAt: refreshExpDate.toISOString(),
    };
  }

  private generateRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  private parseRefreshToken(token: string): { sessionId: string; secret: string } {
    const [sessionId, secret] = token.split('.');
    if (!sessionId || !secret) {
      throw this.authError('MALFORMED_REFRESH_TOKEN', 'Malformed refresh token');
    }

    return { sessionId, secret };
  }

  private hashRefreshSecret(secret: string): string {
    return createHash('sha256')
      .update(`${this.tokenSecret || 'dev-fallback-secret'}:${secret}`)
      .digest('hex');
  }

  private secureStringEquals(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left, 'utf8');
    const rightBuf = Buffer.from(right, 'utf8');
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  }

  private async consumeRateLimit(
    identifier: string,
    actionType: string,
    maxCount: number,
    windowMs: number,
  ) {
    const now = new Date();
    const row = await this.db.rateLimit.findUnique({
      where: {
        wallet_actionType: {
          wallet: identifier,
          actionType,
        },
      },
    });

    let activeRow = row;

    if (!activeRow) {
      try {
        await this.db.rateLimit.create({
          data: {
            wallet: identifier,
            actionType,
            count: 1,
            windowStart: now,
          },
        });
        return;
      } catch (err) {
        if (!this.isUniqueConstraintError(err)) {
          throw err;
        }
        activeRow = await this.db.rateLimit.findUnique({
          where: {
            wallet_actionType: {
              wallet: identifier,
              actionType,
            },
          },
        });
        if (!activeRow) {
          throw err;
        }
      }
    }

    if (now.getTime() - activeRow.windowStart.getTime() > windowMs) {
      await this.db.rateLimit.update({
        where: {
          wallet_actionType: {
            wallet: identifier,
            actionType,
          },
        },
        data: {
          count: 1,
          windowStart: now,
        },
      });
      return;
    }

    if (activeRow.count >= maxCount) {
      throw new HttpException({
        code: 'AUTH_RATE_LIMITED',
        message: 'Too many authentication attempts',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.db.rateLimit.update({
      where: {
        wallet_actionType: {
          wallet: identifier,
          actionType,
        },
      },
      data: {
        count: { increment: 1 },
      },
    });
  }

  private authError(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ code, message });
  }

  private signToken(payload: AuthTokenPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64urlJson(header);
    const encodedPayload = this.base64urlJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const sig = createHmac('sha256', this.tokenSecret || 'dev-fallback-secret')
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${sig}`;
  }

  private decodeAndVerifyToken(token: string): AuthTokenPayload {
    const [encodedHeader, encodedPayload, encodedSig] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSig) {
      throw this.authError('MALFORMED_TOKEN', 'Malformed token');
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = createHmac('sha256', this.tokenSecret || 'dev-fallback-secret')
      .update(signingInput)
      .digest();

    const providedSig = Buffer.from(encodedSig, 'base64url');

    if (
      providedSig.length !== expectedSig.length ||
      !timingSafeEqual(providedSig, expectedSig)
    ) {
      throw this.authError('INVALID_TOKEN_SIGNATURE', 'Invalid token signature');
    }

    let payload: AuthTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      throw this.authError('INVALID_TOKEN_PAYLOAD', 'Invalid token payload');
    }

    if (!payload?.sub || !payload?.sid || !payload?.iat || !payload?.exp) {
      throw this.authError('INVALID_TOKEN_CLAIMS', 'Invalid token claims');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      throw this.authError('TOKEN_EXPIRED', 'Token expired');
    }

    return payload;
  }

  private base64urlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }
}
