import { Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { WebSocketService } from '../websocket/websocket.service';
import { MiningEventIngestionService } from './mining-event-ingestion.service';
import { toRealtimeDeployPayload } from './mining-payload';
import { SolanaService } from '../solana/solana.service';
import { RoundManagerService } from '../round-manager/round-manager.service';

type DeployReadinessReason =
  | 'READY'
  | 'ROUND_FINALIZING'
  | 'MINER_CHECKPOINT_REQUIRED'
  | 'ROUND_NOT_ACTIVE'
  | 'NO_ACTIVE_BOARD';

export interface DeployReadinessResponse {
  canDeploy: boolean;
  requiresCheckpoint: boolean;
  reason: DeployReadinessReason;
  roundId: number | null;
  startSlot: number | null;
  endSlot: number | null;
  currentSlot: number | null;
}

@Injectable()
export class MiningService {
  private readonly logger = new Logger(MiningService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly rateLimit: RateLimitService,
    private readonly ws: WebSocketService,
    private readonly ingest: MiningEventIngestionService,
    private readonly solana: SolanaService,
    private readonly roundManager: RoundManagerService,
  ) {}

  async getMiner(wallet: string) {
    return this.db.miner.findUnique({
      where: { wallet },
    });
  }

  async getMinerDeployments(wallet: string, limit: number = 20, before?: Date) {
    return this.db.deployment.findMany({
      where: {
        wallet,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { round: true },
    });
  }

  async getRoundDeployments(roundId: number) {
    return this.db.deployment.findMany({
      where: { roundId },
      orderBy: { createdAt: 'desc' },
      include: { miner: true },
    });
  }

  async recordDeployment(data: { roundId: number; wallet: string; squares: number[]; amount: bigint; txHash?: string }) {
    if (!data.txHash) {
      throw new Error('recordDeployment requires txHash');
    }
    const result = await this.ingest.ingestDeployment({
      roundId: data.roundId,
      wallet: data.wallet,
      squares: data.squares,
      amountLamports: data.amount,
      txHash: data.txHash,
      source: 'manual',
    });
    return result.deployment;
  }

  async reportDeploymentFromSignature(
    input: { wallet: string; signature: string; clientIp: string },
  ) {
    await Promise.all([
      this.rateLimit.assertRealtimeRateLimit(
        `wallet:${input.wallet}`,
        'mining_report_signature',
        30,
        60_000,
        {
          code: 'RATE_LIMITED',
          message: 'Too many deployment reports',
        },
      ),
      this.rateLimit.assertRealtimeRateLimit(
        `ip:${input.clientIp}`,
        'mining_report_signature',
        80,
        60_000,
        {
          code: 'RATE_LIMITED',
          message: 'Too many deployment reports',
        },
      ),
    ]);

    const result = await this.ingest.ingestFromSignature(input.signature, {
      expectedWallet: input.wallet,
      sourceOverride: 'report',
    });
    const payload = toRealtimeDeployPayload(result.deployment);

    if (result.created) {
      this.ws.broadcastNewDeploy(payload);
      this.logger.log(
        `Deployment reported via signature tx=${payload.txHash} wallet=${payload.wallet}`,
      );
    }

    return {
      created: result.created,
      deployment: payload,
    };
  }

  async getDeployReadiness(wallet: string): Promise<DeployReadinessResponse> {
    const round = await this.roundManager.getCurrentRound().catch(() => null);
    const board = round?.board;
    const roundId = this.toSafeNumberOrNull(board?.roundId);
    const startSlot = this.toSafeNumberOrNull(board?.startSlot);
    const endSlot = this.toSafeNumberOrNull(board?.endSlot);
    const currentSlot = this.toSafeNumberOrNull(board?.currentSlot);

    if (!board || roundId === null) {
      return {
        canDeploy: false,
        requiresCheckpoint: false,
        reason: 'NO_ACTIVE_BOARD',
        roundId: null,
        startSlot,
        endSlot,
        currentSlot,
      };
    }

    const roundCanDeploy = board.canDeploy === true;
    const roundRequiresCheckpoint = board.requiresCheckpoint === true;

    if (roundRequiresCheckpoint) {
      return {
        canDeploy: false,
        requiresCheckpoint: true,
        reason: 'ROUND_FINALIZING',
        roundId,
        startSlot,
        endSlot,
        currentSlot,
      };
    }

    if (!roundCanDeploy) {
      return {
        canDeploy: false,
        requiresCheckpoint: false,
        reason: 'ROUND_NOT_ACTIVE',
        roundId,
        startSlot,
        endSlot,
        currentSlot,
      };
    }

    let minerCheckpointRequired = false;
    try {
      const miner = await this.solana.fetchMiner(new PublicKey(wallet));
      if (miner) {
        const boardRoundId = BigInt(roundId);
        minerCheckpointRequired =
          miner.roundId !== boardRoundId &&
          miner.checkpointId !== miner.roundId;
      }
    } catch (error) {
      this.logger.warn(
        `Deploy readiness miner check failed for ${wallet}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (minerCheckpointRequired) {
      return {
        canDeploy: false,
        requiresCheckpoint: true,
        reason: 'MINER_CHECKPOINT_REQUIRED',
        roundId,
        startSlot,
        endSlot,
        currentSlot,
      };
    }

    return {
      canDeploy: true,
      requiresCheckpoint: false,
      reason: 'READY',
      roundId,
      startSlot,
      endSlot,
      currentSlot,
    };
  }

  async fundLocalWallet(wallet: string) {
    return this.solana.requestLocalAirdrop(new PublicKey(wallet));
  }

  private toSafeNumberOrNull(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === 'bigint') {
      return this.bigintToSafeNumber(value);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      return this.bigintToSafeNumber(BigInt(value));
    }
    return null;
  }

  private bigintToSafeNumber(value: bigint): number | null {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (value > max || value < min) return null;
    return Number(value);
  }

}
