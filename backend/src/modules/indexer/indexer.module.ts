import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { IndexerController } from './indexer.controller';
import { MiningModule } from '../mining/mining.module';

@Module({
  imports: [MiningModule],
  providers: [IndexerService],
  controllers: [IndexerController],
  exports: [IndexerService],
})
export class IndexerModule {}
