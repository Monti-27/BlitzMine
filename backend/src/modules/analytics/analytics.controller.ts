import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  private parseLimit(value: string | undefined, fallback: number, max: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  @Get('global')
  @ApiOperation({ summary: 'Get global stats' })
  async getGlobalStats() {
    return this.analyticsService.getGlobalStats();
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get mining leaderboard' })
  @ApiQuery({ name: 'limit', required: false })
  async getLeaderboard(@Query('limit') limit?: string) {
    return this.analyticsService.getLeaderboard(this.parseLimit(limit, 25, 200));
  }

  @Get('miner/:wallet')
  @ApiOperation({ summary: 'Get miner stats' })
  async getMinerStats(@Param('wallet') wallet: string) {
    return this.analyticsService.getMinerStats(wallet);
  }

  @Get('round/:id')
  @ApiOperation({ summary: 'Get round analytics' })
  async getRoundAnalytics(@Param('id', ParseIntPipe) id: number) {
    return this.analyticsService.getRoundAnalytics(id);
  }

  @Get('rounds/recent')
  @ApiOperation({ summary: 'Get recent rounds' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecentRounds(@Query('limit') limit?: string) {
    return this.analyticsService.getRecentRounds(this.parseLimit(limit, 10, 200));
  }

  @Get('trends')
  @ApiOperation({ summary: 'Get daily/weekly trends' })
  @ApiQuery({ name: 'days', required: false })
  async getTrends(@Query('days') days?: string) {
    return this.analyticsService.getDailyStats(this.parseLimit(days, 7, 90));
  }

  @Get('miner/:wallet/rewards')
  @ApiOperation({ summary: 'Get miner reward history' })
  @ApiQuery({ name: 'limit', required: false })
  async getMinerRewards(@Param('wallet') wallet: string, @Query('limit') limit?: string) {
    return this.analyticsService.getRewardHistory(wallet, this.parseLimit(limit, 20, 200));
  }
}
