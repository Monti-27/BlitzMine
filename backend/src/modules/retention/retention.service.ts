import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly db: DatabaseService) {}

  // delete chat messages older than 90 days
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanChatMessages() {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await this.db.chatMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} chat messages older than 90 days`);
    }
  }

  // delete expired rate limit windows
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanRateLimits() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const result = await this.db.rateLimit.deleteMany({
      where: { windowStart: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} expired rate limit records`);
    }
  }

  // delete resolved/failed transactions older than 7 days
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanFailedTransactions() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.db.failedTransaction.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ['resolved', 'failed'] },
      },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} old failed transactions`);
    }
  }

  // delete expired or consumed challenges
  @Cron(CronExpression.EVERY_30_MINUTES)
  async cleanWalletChallenges() {
    const now = new Date();
    const result = await this.db.walletChallenge.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          {
            consumedAt: {
              not: null,
              lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} expired/consumed wallet challenges`);
    }
  }

  // delete revoked or expired auth sessions
  @Cron(CronExpression.EVERY_HOUR)
  async cleanAuthSessions() {
    const now = new Date();
    const result = await this.db.authSession.deleteMany({
      where: {
        OR: [
          { refreshExpiresAt: { not: null, lt: now } },
          { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          {
            revokedAt: {
              not: null,
              lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} expired/revoked auth sessions`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanJobLeases() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.db.jobLease.deleteMany({
      where: {
        expiresAt: { lt: cutoff },
      },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} stale scheduler lock leases`);
    }
  }
}
