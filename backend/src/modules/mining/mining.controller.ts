import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MiningService } from './mining.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthRequestLike } from '../auth/auth.types';
import { ReportDeploymentDto } from './dto/report-deployment.dto';

@ApiTags('mining')
@Controller('mining')
export class MiningController {
  constructor(private readonly miningService: MiningService) {}

  private getClientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private parseLimit(value: string | undefined, fallback: number, max: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  private parseBefore(value?: string): Date | undefined {
    if (!value) return undefined;
    const asInt = Number.parseInt(value, 10);
    if (Number.isFinite(asInt) && String(asInt) === value.trim()) {
      const ms = asInt > 1_000_000_000_000 ? asInt : asInt * 1000;
      const parsed = new Date(ms);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid before timestamp');
      }
      return parsed;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid before timestamp');
    }
    return parsed;
  }

  @Get('miner/:wallet')
  @ApiOperation({ summary: 'Get miner data' })
  async getMiner(@Param('wallet') wallet: string) {
    return this.miningService.getMiner(wallet);
  }

  @Get('miner/:wallet/deployments')
  @ApiOperation({ summary: 'Get miner deployments' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false })
  async getMinerDeployments(
    @Param('wallet') wallet: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.miningService.getMinerDeployments(
      wallet,
      this.parseLimit(limit, 20, 200),
      this.parseBefore(before),
    );
  }

  @Get('round/:id/deployments')
  @ApiOperation({ summary: 'Get round deployments' })
  async getRoundDeployments(@Param('id', ParseIntPipe) id: number) {
    return this.miningService.getRoundDeployments(id);
  }

  @Get('deploy-readiness')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get wallet deploy readiness for current round' })
  async getDeployReadiness(@Req() req: AuthRequestLike) {
    const wallet = req.auth?.wallet;
    if (!wallet) {
      throw new BadRequestException('Missing authenticated wallet');
    }

    return this.miningService.getDeployReadiness(wallet);
  }

  @Post('deployments/report')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Report a deployment signature for canonical ingestion' })
  async reportDeployment(
    @Req() req: AuthRequestLike & { ip?: string; socket?: { remoteAddress?: string } },
    @Body() body: ReportDeploymentDto,
  ) {
    const wallet = req.auth?.wallet;
    if (!wallet) {
      throw new BadRequestException('Missing authenticated wallet');
    }

    return this.miningService.reportDeploymentFromSignature({
      wallet,
      signature: body.signature.trim(),
      clientIp: this.getClientIp(req),
    });
  }

  @Post('local-faucet')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Fund the authenticated wallet on local development' })
  async fundLocalWallet(@Req() req: AuthRequestLike) {
    const wallet = req.auth?.wallet;
    if (!wallet) {
      throw new BadRequestException('Missing authenticated wallet');
    }
    return this.miningService.fundLocalWallet(wallet);
  }
}
