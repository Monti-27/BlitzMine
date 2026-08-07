import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './modules/database/database.module';
import { SolanaModule } from './modules/solana/solana.module';
import { IndexerModule } from './modules/indexer/indexer.module';
import { RoundManagerModule } from './modules/round-manager/round-manager.module';
import { ChatModule } from './modules/chat/chat.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { MiningModule } from './modules/mining/mining.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RetentionModule } from './modules/retention/retention.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SchedulerLockModule } from './modules/scheduler-lock/scheduler-lock.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import databaseConfig from './config/database.config';
import solanaConfig from './config/solana.config';
import redisConfig from './config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, solanaConfig, redisConfig],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RateLimitModule,
    SchedulerLockModule,
    AuthModule,
    SolanaModule,
    WebSocketModule,
    IndexerModule,
    RoundManagerModule,
    ChatModule,
    MiningModule,
    AnalyticsModule,
    ProfileModule,
    RetentionModule,
    HealthModule,
  ],
})
export class AppModule {}
