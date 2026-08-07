import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { SolanaService } from '../solana/solana.service';
import { Response } from 'express';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly solana: SolanaService,
  ) {}

  // healthCheck
  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, unknown> = { status: 'ok' };

    try {
      await this.db.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      checks.status = 'degraded';
    }

    try {
      await this.solana.getCurrentSlot();
      checks.solana = 'ok';
      checks.runtime = await this.solana.getRuntimeNetwork();
    } catch {
      checks.solana = 'error';
      checks.status = 'degraded';
    }

    if (checks.status !== 'ok') {
      res.status(503);
    }

    return checks;
  }
}
