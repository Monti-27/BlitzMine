import { Module } from '@nestjs/common';
import { MiningService } from './mining.service';
import { MiningController } from './mining.controller';
import { MiningEventIngestionService } from './mining-event-ingestion.service';
import { RoundManagerModule } from '../round-manager/round-manager.module';

@Module({
  imports: [RoundManagerModule],
  providers: [MiningService, MiningEventIngestionService],
  controllers: [MiningController],
  exports: [MiningService, MiningEventIngestionService],
})
export class MiningModule {}
