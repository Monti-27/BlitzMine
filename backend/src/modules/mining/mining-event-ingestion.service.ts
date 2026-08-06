import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { SolanaService } from '../solana/solana.service';
import { parseDeployEventsFromLogs, U64_MAX } from '../indexer/program-event-parser';

export type DeploymentIngestSource = 'manual' | 'auto' | 'backfill' | 'report';

export interface IngestDeploymentInput {
  roundId: number;
  wallet: string;
  squares: number[];
  amountLamports: bigint;
  txHash: string;
  slot?: bigint | null;
  source: DeploymentIngestSource;
  createdAt?: Date;
}

export interface IngestDeploymentResult {
  created: boolean;
  deployment: {
    id: number;
    roundId: number;
    wallet: string;
    squares: unknown;
    amount: bigint;
    txHash: string | null;
    slot: bigint | null;
    source: string;
    createdAt: Date;
  };
}

export interface SignatureResolvedDeployment {
  roundId: number;
  wallet: string;
  signer: string;
  squares: number[];
  amountLamports: bigint;
  txHash: string;
  slot: bigint;
  createdAt: Date;
  source: DeploymentIngestSource;
}

@Injectable()
export class MiningEventIngestionService {
  private readonly logger = new Logger(MiningEventIngestionService.name);
  private readonly deploymentSelect = {
    id: true,
    roundId: true,
    wallet: true,
    squares: true,
    amount: true,
    txHash: true,
    slot: true,
    source: true,
    createdAt: true,
  } as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly solana: SolanaService,
  ) {}

  decodeSquaresFromMask(mask: bigint, expectedSquares?: number): number[] {
    const decoded: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      if ((mask & (1n << BigInt(i))) !== 0n) {
        decoded.push(i + 1);
      }
    }

    if (
      typeof expectedSquares === 'number' &&
      Number.isFinite(expectedSquares) &&
      expectedSquares > 0 &&
      expectedSquares < decoded.length
    ) {
      return decoded.slice(0, expectedSquares);
    }

    return decoded;
  }

  async resolveDeploymentFromSignature(
    signature: string,
  ): Promise<SignatureResolvedDeployment> {
    const tx = await this.solana.getConnection().getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    const logs = tx.meta?.logMessages ?? [];
    const events = parseDeployEventsFromLogs(this.solana.getProgramId(), logs);
    if (events.length === 0) {
      throw new NotFoundException('No deploy event found for signature');
    }

    const event = events[0];
    const squares = this.decodeSquaresFromMask(event.mask, event.totalSquares);
    const totalSquares = event.totalSquares > 0 ? event.totalSquares : squares.length;
    const amountLamports = event.amount * BigInt(totalSquares);

    const source: DeploymentIngestSource =
      event.strategy === U64_MAX ? 'manual' : 'auto';

    return {
      roundId: event.roundId,
      wallet: event.authority,
      signer: event.signer,
      squares,
      amountLamports,
      txHash: signature,
      slot: BigInt(tx.slot),
      createdAt: this.resolveEventTimestamp(tx.blockTime ?? null, event.timestampSec ?? null),
      source,
    };
  }

  async ingestFromSignature(
    signature: string,
    options?: {
      expectedWallet?: string;
      sourceOverride?: DeploymentIngestSource;
    },
  ): Promise<IngestDeploymentResult & { resolved: SignatureResolvedDeployment }> {
    const resolved = await this.resolveDeploymentFromSignature(signature);

    if (
      options?.expectedWallet &&
      resolved.wallet !== options.expectedWallet &&
      resolved.signer !== options.expectedWallet
    ) {
      throw new ForbiddenException('Transaction wallet mismatch');
    }

    const result = await this.ingestDeployment({
      roundId: resolved.roundId,
      wallet: resolved.wallet,
      squares: resolved.squares,
      amountLamports: resolved.amountLamports,
      txHash: resolved.txHash,
      slot: resolved.slot,
      source: options?.sourceOverride ?? resolved.source,
      createdAt: resolved.createdAt,
    });

    return {
      ...result,
      resolved,
    };
  }

  async ingestDeployment(input: IngestDeploymentInput): Promise<IngestDeploymentResult> {
    const txHash = input.txHash.trim();
    if (!txHash) {
      throw new NotFoundException('Missing transaction signature');
    }

    const existing = await this.db.deployment.findUnique({
      where: { txHash },
      select: this.deploymentSelect,
    });
    if (existing) {
      return { created: false, deployment: existing };
    }

    const normalizedSquares = this.normalizeSquares(input.squares);
    const amountLamports = this.normalizeAmount(input.amountLamports);
    const now = input.createdAt ?? new Date();

    let result: IngestDeploymentResult;
    try {
      result = await this.db.$transaction(async (tx) => {
        const duplicate = await tx.deployment.findUnique({
          where: { txHash },
          select: this.deploymentSelect,
        });
        if (duplicate) {
          return { created: false as const, deployment: duplicate };
        }

        const roundExists = await tx.round.findUnique({
          where: { id: input.roundId },
          select: { id: true },
        });
        if (!roundExists) {
          await tx.round.create({
            data: {
              id: input.roundId,
              deployed: new Array(25).fill(0),
              count: new Array(25).fill(0),
              status: 'active',
              startedAt: now,
            },
          });
        }

        await tx.miner.upsert({
          where: { wallet: input.wallet },
          create: {
            wallet: input.wallet,
            lastActive: now,
          },
          update: {
            lastActive: now,
          },
        });

        const participantCreated = await tx.roundParticipant.createMany({
          data: [
            {
              roundId: input.roundId,
              wallet: input.wallet,
              createdAt: now,
            },
          ],
          skipDuplicates: true,
        });

        const minerUpdate: Prisma.MinerUpdateInput = {
          lifetimeDeployed: { increment: amountLamports },
          lastActive: now,
        };
        if (participantCreated.count > 0) {
          minerUpdate.roundsPlayed = { increment: 1 };
        }

        await tx.miner.update({
          where: { wallet: input.wallet },
          data: minerUpdate,
        });

        const deployment = await tx.deployment.create({
          data: {
            roundId: input.roundId,
            wallet: input.wallet,
            squares: normalizedSquares,
            amount: amountLamports,
            txHash,
            slot: input.slot ?? null,
            source: input.source,
            createdAt: now,
          },
          select: this.deploymentSelect,
        });

        return { created: true as const, deployment };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingByHash = await this.findDeploymentByHashWithRetry(txHash);
        if (existingByHash) {
          return { created: false, deployment: existingByHash };
        }
      }
      throw error;
    }

    if (result.created) {
      this.logger.log(
        `Ingested deployment tx=${txHash} round=${result.deployment.roundId} wallet=${result.deployment.wallet}`,
      );
    }

    return result;
  }

  private normalizeSquares(squares: number[]): number[] {
    const normalized = Array.from(
      new Set(
        squares
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 25),
      ),
    ).sort((a, b) => a - b);

    if (normalized.length === 0) {
      throw new NotFoundException('No valid squares found in deployment');
    }

    return normalized;
  }

  private normalizeAmount(amountLamports: bigint): bigint {
    if (amountLamports <= 0n) {
      throw new NotFoundException('Deployment amount must be positive');
    }
    return amountLamports;
  }

  private resolveEventTimestamp(
    blockTimeSec: number | null,
    eventTimestampSec: number | null,
  ): Date {
    if (typeof eventTimestampSec === 'number' && Number.isFinite(eventTimestampSec) && eventTimestampSec > 0) {
      return new Date(eventTimestampSec * 1000);
    }
    if (typeof blockTimeSec === 'number' && Number.isFinite(blockTimeSec) && blockTimeSec > 0) {
      return new Date(blockTimeSec * 1000);
    }
    return new Date();
  }

  private async findDeploymentByHashWithRetry(
    txHash: string,
    attempts = 5,
    delayMs = 120,
  ): Promise<IngestDeploymentResult['deployment'] | null> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const deployment = await this.db.deployment.findUnique({
        where: { txHash },
        select: this.deploymentSelect,
      });
      if (deployment) {
        return deployment;
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }
}
