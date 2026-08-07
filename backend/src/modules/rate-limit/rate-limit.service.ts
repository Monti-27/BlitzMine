import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

interface MemoryWindow {
  count: number;
  windowStart: number;
}

interface RateLimitErrorOptions {
  code?: string;
  message?: string;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly isProduction: boolean;
  private readonly memoryWindows = new Map<string, MemoryWindow>();
  private redis: Redis | null = null;
  private redisReady = false;
  private warnedDbFallback = false;
  private warnedMemoryFallback = false;
  private warnedRedisError = false;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.isProduction = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
    this.initializeRedis();
  }

  async onModuleDestroy() {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async assertRateLimit(
    identifier: string,
    actionType: string,
    maxCount: number,
    windowMs: number,
    options: RateLimitErrorOptions = {},
  ) {
    const code = options.code ?? 'CHAT_RATE_LIMITED';
    const message = options.message ?? 'Too many requests';
    const key = `${actionType}:${identifier}`;

    if (this.redisReady && this.redis) {
      try {
        const allowed = await this.consumeRedisWindow(key, maxCount, windowMs);
        if (!allowed) {
          this.throwRateLimitError(code, message);
        }
        return;
      } catch (err) {
        this.redisReady = false;
        this.logger.warn(`Redis rate limit path failed; falling back (${(err as Error).message})`);
      }
    }

    if (!this.isProduction) {
      if (!this.warnedMemoryFallback) {
        this.warnedMemoryFallback = true;
        this.logger.warn('Rate limit service is using in-memory fallback (dev/local mode).');
      }
      const allowed = this.consumeMemoryWindow(key, maxCount, windowMs);
      if (!allowed) {
        this.throwRateLimitError(code, message);
      }
      return;
    }

    if (!this.warnedDbFallback) {
      this.warnedDbFallback = true;
      this.logger.warn('Rate limit service is using database fallback in production; configure Redis for best latency.');
    }
    const allowed = await this.consumeDatabaseWindow(identifier, actionType, maxCount, windowMs);
    if (!allowed) {
      this.throwRateLimitError(code, message);
    }
  }

  async assertRealtimeRateLimit(
    identifier: string,
    actionType: string,
    maxCount: number,
    windowMs: number,
    options: RateLimitErrorOptions = {},
  ) {
    const code = options.code ?? 'CHAT_RATE_LIMITED';
    const message = options.message ?? 'Too many requests';
    const key = `${actionType}:${identifier}`;

    if (this.redisReady && this.redis) {
      try {
        const allowed = await this.consumeRedisWindow(key, maxCount, windowMs);
        if (!allowed) {
          this.throwRateLimitError(code, message);
        }
        return;
      } catch (err) {
        this.redisReady = false;
        this.logger.warn(`Redis rate limit path failed; falling back (${(err as Error).message})`);
      }
    }

    if (!this.warnedMemoryFallback) {
      this.warnedMemoryFallback = true;
      this.logger.warn(
        'Realtime rate limit is using in-memory fallback. Configure Redis for strict multi-instance limits.',
      );
    }
    const allowed = this.consumeMemoryWindow(key, maxCount, windowMs);
    if (!allowed) {
      this.throwRateLimitError(code, message);
    }
  }

  private initializeRedis() {
    const redisUrl = (this.config.get<string>('REDIS_URL') ?? '').trim();
    if (!redisUrl) {
      return;
    }

    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    this.redis.on('ready', () => {
      this.redisReady = true;
      this.logger.log('Redis rate limiter connected');
    });

    this.redis.on('end', () => {
      this.redisReady = false;
    });

    this.redis.on('error', (err) => {
      this.redisReady = false;
      if (!this.warnedRedisError) {
        this.warnedRedisError = true;
        this.logger.warn(`Redis rate limiter error: ${this.formatError(err)}`);
      }
    });

    this.redis.connect().catch((err) => {
      this.redisReady = false;
      if (!this.warnedRedisError) {
        this.warnedRedisError = true;
        this.logger.warn(`Redis rate limiter unavailable at startup: ${this.formatError(err)}`);
      }
    });
  }

  private async consumeRedisWindow(key: string, maxCount: number, windowMs: number): Promise<boolean> {
    if (!this.redis) return false;

    const now = Date.now();
    const member = `${now}:${randomUUID()}`;
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local max = tonumber(ARGV[3])
      local member = ARGV[4]
      local cutoff = now - window

      redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
      local count = redis.call('ZCARD', key)
      if count >= max then
        redis.call('PEXPIRE', key, window)
        return 0
      end

      redis.call('ZADD', key, now, member)
      redis.call('PEXPIRE', key, window)
      return 1
    `;

    const result = await this.redis.eval(script, 1, key, String(now), String(windowMs), String(maxCount), member);
    return Number(result) === 1;
  }

  private consumeMemoryWindow(key: string, maxCount: number, windowMs: number): boolean {
    const now = Date.now();
    const current = this.memoryWindows.get(key);
    if (!current || now - current.windowStart > windowMs) {
      this.memoryWindows.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (current.count >= maxCount) {
      return false;
    }

    current.count += 1;
    this.memoryWindows.set(key, current);
    return true;
  }

  private async consumeDatabaseWindow(
    identifier: string,
    actionType: string,
    maxCount: number,
    windowMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const where = {
      wallet_actionType: {
        wallet: identifier,
        actionType,
      },
    };

    let row = await this.db.rateLimit.findUnique({ where });
    if (!row) {
      try {
        await this.db.rateLimit.create({
          data: {
            wallet: identifier,
            actionType,
            count: 1,
            windowStart: now,
          },
        });
        return true;
      } catch (err) {
        if (!this.isUniqueConstraintError(err)) {
          throw err;
        }
        row = await this.db.rateLimit.findUnique({ where });
      }
    }

    if (!row) {
      return false;
    }

    if (now.getTime() - row.windowStart.getTime() > windowMs) {
      await this.db.rateLimit.update({
        where,
        data: {
          count: 1,
          windowStart: now,
        },
      });
      return true;
    }

    if (row.count >= maxCount) {
      return false;
    }

    await this.db.rateLimit.update({
      where,
      data: {
        count: { increment: 1 },
      },
    });
    return true;
  }

  private isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private throwRateLimitError(code: string, message: string): never {
    throw new HttpException(
      {
        code,
        message,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) {
      const msg = err.message?.trim();
      if (msg) return msg;
      return err.name || 'unknown error';
    }
    if (typeof err === 'string') {
      return err || 'unknown error';
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }
}
