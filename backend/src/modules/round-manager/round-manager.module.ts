import { Module } from '@nestjs/common';
import { RoundManagerService } from './round-manager.service';
import { RoundManagerController } from './round-manager.controller';

@Module({
  providers: [RoundManagerService],
  controllers: [RoundManagerController],
  exports: [RoundManagerService],
})
export class RoundManagerModule {}
