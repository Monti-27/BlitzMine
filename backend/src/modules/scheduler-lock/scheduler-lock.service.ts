import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SchedulerLockService {
  private readonly logger = new Logger(SchedulerLockService.name);
  private readonly ownerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly inProcessRunning = new Set<string>();

  constructor(private readonly db: DatabaseService) {}

  async acquire(name: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    let updated;
    try {
      updated = await this.db.jobLease.updateMany({
        where: {
          name,
          OR: [{ expiresAt: { lt: now } }, { owner: this.ownerId }],
        },
        data: {
          owner: this.ownerId,
          expiresAt,
          heartbeatAt: now,
        },
      });
    } catch (err) {
      if (this.isPoolTimeout(err)) {
        this.logger.warn(`Skipped acquire for ${name} due to DB pool timeout`);
        return false;
      }
      throw err;
    }

    if (updated.count > 0) {
      return true;
    }

    try {
      await this.db.jobLease.create({
        data: {
          name,
          owner: this.ownerId,
          expiresAt,
          heartbeatAt: now,
        },
      });
      return true;
    } catch (err) {
      if (this.isPoolTimeout(err)) {
        this.logger.warn(`Skipped create-lease for ${name} due to DB pool timeout`);
      }
      return false;
    }
  }

  async renew(name: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    let updated;
    try {
      updated = await this.db.jobLease.updateMany({
        where: { name, owner: this.ownerId },
        data: {
          expiresAt,
          heartbeatAt: now,
        },
      });
    } catch (err) {
      if (this.isPoolTimeout(err)) {
        this.logger.warn(`Skipped renew for ${name} due to DB pool timeout`);
        return false;
      }
      throw err;
    }

    return updated.count > 0;
  }

  async release(name: string): Promise<void> {
    try {
      await this.db.jobLease.updateMany({
        where: { name, owner: this.ownerId },
        data: {
          expiresAt: new Date(),
        },
      });
    } catch (err) {
      if (this.isPoolTimeout(err)) {
        this.logger.warn(`Skipped release for ${name} due to DB pool timeout`);
        return;
      }
      throw err;
    }
  }

  async runWithLease<T>(
    name: string,
    ttlMs: number,
    task: () => Promise<T>,
  ): Promise<T | null> {
    if (this.inProcessRunning.has(name)) {
      return null;
    }
    this.inProcessRunning.add(name);

    let acquired = false;
    let renewTimer: ReturnType<typeof setInterval> | null = null;

    try {
      acquired = await this.acquire(name, ttlMs);
      if (!acquired) {
        return null;
      }

      const renewMs = Math.max(Math.floor(ttlMs / 2), 1000);
      renewTimer = setInterval(() => {
        this.renew(name, ttlMs)
          .then((ok) => {
            if (!ok) {
              this.logger.warn(`Lost lease ownership for ${name}`);
            }
          })
          .catch((err) => {
            this.logger.warn(`Lease renewal failed for ${name}: ${err.message}`);
          });
      }, renewMs);

      return await task();
    } finally {
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      if (acquired) {
        await this.release(name);
      }
      this.inProcessRunning.delete(name);
    }
  }

  private isPoolTimeout(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2024';
  }
}
