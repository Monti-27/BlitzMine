import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IndexerService } from './indexer.service';

@ApiTags('indexer')
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get indexer status' })
  async getStatus() {
    return this.indexerService.getIndexerStatus();
  }
}
