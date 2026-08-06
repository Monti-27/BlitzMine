import { Global, Module } from '@nestjs/common';
import { SchedulerLockService } from './scheduler-lock.service';

@Global()
@Module({
  providers: [SchedulerLockService],
  exports: [SchedulerLockService],
})
export class SchedulerLockModule {}
