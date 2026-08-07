import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

@Module({
  providers: [RetentionService],
})
export class RetentionModule {}
