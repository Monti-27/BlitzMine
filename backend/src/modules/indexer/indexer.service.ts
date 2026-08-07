import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PublicKey, AccountInfo, Context, Logs } from '@solana/web3.js';
import { DatabaseService } from '../database/database.service';
import { SolanaService, RoundAccount, BoardAccount, MinerAccount } from '../solana/solana.service';
import { WebSocketService } from '../websocket/websocket.service';
import {
  parseDeployEventsFromLogs,
  parseFulfillRoundEventsFromLogs,
  ParsedFulfillRoundEvent,
  U64_MAX,
} from './program-event-parser';
import { MiningEventIngestionService } from '../mining/mining-event-ingestion.service';
import { toRealtimeDeployPayload } from '../mining/mining-payload';
import { bigintToSafeInt, u64LikeToBigInt } from '../../common/numeric/u64';

const SPLIT_ADDRESS = 'SpLiT11111111111111111111111111111111111112';
const NUM_SQUARES = 25;
const ROUND_STATE_PERSIST_THROTTLE_MS = 2_000;

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private readonly deployCursorKey = 'deploy_logs';
  private subscriptionId: number | null = null;
  private logSubscriptionIds: number[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private logReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;
  private logReconnectDelay = 2000;
  private warnedMissingIndexerCursorTable = false;
  private readonly roundStatePersistedAt = new Map<number, number>();
  private readonly resolvedWinners = new Map<number, number>();
  private readonly processedRoundEnds = new Set<string>();
  private recoveryRunning = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly solana: SolanaService,
    private readonly ws: WebSocketService,
    private readonly miningIngest: MiningEventIngestionService,
  ) {}

  private safeInt(value: unknown, label: string, fallback = 0): number {
    try {
      return bigintToSafeInt(u64LikeToBigInt(value), label);
    } catch {
      return fallback;
    }
  }

  async onModuleInit() {
    this.startListening();
    this.startLogListening();
    void this.recoverMissedLogs();
  }

  onModuleDestroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.logReconnectTimer) clearTimeout(this.logReconnectTimer);
    if (this.subscriptionId !== null) {
      this.solana.getConnection().removeAccountChangeListener(this.subscriptionId);
    }
    for (const subscriptionId of this.logSubscriptionIds) {
      this.solana.getConnection().removeOnLogsListener(subscriptionId);
    }
    this.logSubscriptionIds = [];
  }

  private startListening() {
    try {
      this.subscriptionId = this.solana.onProgramAccountChange(
        (accountInfo, context, pubkey) => {
          this.processAccountChange(accountInfo, context, pubkey).catch((err) =>
            this.logger.error(`Failed to process account change: ${err.message}`),
          );
        },
      );
      this.reconnectDelay = 2000;
      this.logger.log(`Indexer listening for program changes`);
    } catch (err) {
      this.logger.error(`Failed to start listener: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.logger.log(`Reconnecting indexer (delay: ${this.reconnectDelay}ms)...`);
      this.startListening();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private startLogListening() {
    const connection = this.solana.getConnection();
    const subscriptionIds: number[] = [];
    try {
      const targets = [this.solana.getProgramId(), this.solana.getVrfProgramId()];
      for (const target of targets) {
        subscriptionIds.push(
          connection.onLogs(
            target,
            (logs, context) => {
              this.processProgramLogs(logs, context).catch((err) =>
                this.logger.error(`Failed to process program logs: ${err.message}`),
              );
            },
            'confirmed',
          ),
        );
      }
      this.logSubscriptionIds = subscriptionIds;
      this.logReconnectDelay = 2000;
      this.logger.log('Indexer listening for game and VRF logs');
    } catch (err) {
      for (const subscriptionId of subscriptionIds) {
        void connection.removeOnLogsListener(subscriptionId);
      }
      this.logger.error(`Failed to start log listener: ${err.message}`);
      this.scheduleLogReconnect();
    }
  }

  private scheduleLogReconnect() {
    this.logReconnectTimer = setTimeout(() => {
      this.logger.log(`Reconnecting indexer logs (delay: ${this.logReconnectDelay}ms)...`);
      this.startLogListening();
    }, this.logReconnectDelay);
    this.logReconnectDelay = Math.min(this.logReconnectDelay * 2, 30000);
  }

  private async processAccountChange(
    accountInfo: AccountInfo<Buffer>,
    context: Context,
    pubkey: PublicKey,
  ) {
    const accountType = this.solana.identifyAccount(accountInfo.data);
    if (!accountType) return;

    switch (accountType) {
      case 'Board':
        await this.handleBoardChange(accountInfo.data);
        break;
      case 'Round':
        await this.handleRoundChange(accountInfo.data, pubkey);
        break;
      case 'Miner':
        await this.handleMinerChange(accountInfo.data);
        break;
    }
  }

  private async processProgramLogs(
    logs: Logs,
    context: Context,
    deploymentSourceOverride?: 'backfill',
    roundEndFilter?: ReadonlySet<number>,
  ) {
    if (logs.err) return;

    const deployEvents = parseDeployEventsFromLogs(this.solana.getProgramId(), logs.logs);
    for (const event of deployEvents) {
      const squares = this.miningIngest.decodeSquaresFromMask(event.mask, event.totalSquares);
      const totalSquares = event.totalSquares > 0 ? event.totalSquares : squares.length;
      if (totalSquares <= 0) continue;

      const amountLamports = event.amount * BigInt(totalSquares);
      const createdAt =
        event.timestampSec && event.timestampSec > 0
          ? new Date(event.timestampSec * 1000)
          : new Date();
      const source = deploymentSourceOverride ?? (event.strategy === U64_MAX ? 'manual' : 'auto');

      const ingestResult = await this.miningIngest.ingestDeployment({
        roundId: event.roundId,
        wallet: event.authority,
        squares,
        amountLamports,
        txHash: logs.signature,
        slot: BigInt(context.slot),
        source,
        createdAt,
      });

      if (ingestResult.created) {
        this.ws.broadcastNewDeploy(toRealtimeDeployPayload(ingestResult.deployment));
      }
    }

    const fulfillEvents = parseFulfillRoundEventsFromLogs(
      this.solana.getProgramId(),
      logs.logs,
    );
    for (const event of fulfillEvents) {
      if (roundEndFilter && !roundEndFilter.has(event.roundId)) continue;
      await this.applyFulfillEvent(event, logs.signature);
    }

    if (deployEvents.length > 0 || fulfillEvents.length > 0) {
      await this.upsertDeployCursor(BigInt(context.slot), logs.signature);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async recoverMissedLogs() {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;
    try {
      await this.backfillMissedDeployLogs();
      await this.reconcileMissingRoundEnds();
    } finally {
      this.recoveryRunning = false;
    }
  }

  async backfillMissedDeployLogs() {
    let cursor: { signature: string | null; slot: bigint } | null = null;
    try {
      cursor = await this.db.indexerCursor.findUnique({
        where: { key: this.deployCursorKey },
        select: { signature: true, slot: true },
      });
    } catch (error) {
      if (this.isMissingIndexerCursorTableError(error)) {
        this.warnMissingIndexerCursorTableOnce();
        return;
      }
      throw error;
    }

    const until = cursor?.signature ?? undefined;
    const limit = 100;
    const maxPages = 20;
    let before: string | undefined;
    let page = 0;

    while (page < maxPages) {
      const signatures = await this.solana.getConnection().getSignaturesForAddress(
        this.solana.getProgramId(),
        {
          before,
          until,
          limit,
        },
        'confirmed',
      );

      if (signatures.length === 0) break;

      const ordered = [...signatures].reverse();
      for (const item of ordered) {
        if (item.err) continue;

        try {
          await this.processSignature(item.signature, 'backfill');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.debug(`Backfill skipped signature ${item.signature}: ${message}`);
        } finally {
          const cursorUpdated = await this.upsertDeployCursor(BigInt(item.slot), item.signature);
          if (!cursorUpdated) {
            return;
          }
        }
      }

      if (signatures.length < limit) break;
      before = signatures[signatures.length - 1]?.signature;
      page += 1;
    }
  }

  private async reconcileMissingRoundEnds() {
    const missingRounds = await this.db.round.findMany({
      where: { status: 'completed', winningSquare: null },
      orderBy: { id: 'desc' },
      take: 100,
      select: { id: true },
    });
    const unresolved = new Set<number>(missingRounds.map((round) => round.id));
    if (unresolved.size === 0) return;

    const connection = this.solana.getConnection();
    const limit = 100;
    const maxPages = 20;
    let before: string | undefined;

    for (let page = 0; page < maxPages && unresolved.size > 0; page += 1) {
      const signatures = await connection.getSignaturesForAddress(
        this.solana.getVrfProgramId(),
        { before, limit },
        'confirmed',
      );
      if (signatures.length === 0) break;

      for (const item of signatures) {
        if (item.err) continue;
        const events = await this.processSignature(item.signature, undefined, unresolved);
        for (const event of events) {
          unresolved.delete(event.roundId);
        }
        if (unresolved.size === 0) break;
      }

      if (signatures.length < limit) break;
      before = signatures[signatures.length - 1]?.signature;
    }
  }

  private async processSignature(
    signature: string,
    deploymentSourceOverride?: 'backfill',
    roundEndFilter?: ReadonlySet<number>,
  ): Promise<ParsedFulfillRoundEvent[]> {
    const transaction = await this.solana.getConnection().getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const logMessages = transaction?.meta?.logMessages;
    if (!transaction || !logMessages) return [];

    const fulfillEvents = parseFulfillRoundEventsFromLogs(
      this.solana.getProgramId(),
      logMessages,
    );
    await this.processProgramLogs(
      {
        signature,
        err: transaction.meta?.err ?? null,
        logs: logMessages,
      },
      { slot: transaction.slot },
      deploymentSourceOverride,
      roundEndFilter,
    );
    return fulfillEvents;
  }

  private async applyFulfillEvent(event: ParsedFulfillRoundEvent, signature: string) {
    if (event.winningSquare === null) return;
    const eventKey = `${event.roundId}:${signature}`;
    if (this.processedRoundEnds.has(eventKey)) return;
    this.processedRoundEnds.add(eventKey);

    try {
      const knownWinner = this.resolvedWinners.get(event.roundId);
      if (knownWinner !== undefined && knownWinner !== event.winningSquare) {
        throw new Error(`Conflicting winner for round ${event.roundId}`);
      }

      const existing = await this.db.round.findUnique({
        where: { id: event.roundId },
        select: { winningSquare: true },
      });
      if (
        existing?.winningSquare !== null &&
        existing?.winningSquare !== undefined &&
        existing.winningSquare !== event.winningSquare
      ) {
        throw new Error(`Conflicting persisted winner for round ${event.roundId}`);
      }

      this.resolvedWinners.set(event.roundId, event.winningSquare);
      await this.db.round.updateMany({
        where: { id: event.roundId },
        data: {
          winningSquare: event.winningSquare,
          totalWinnings: event.totalWinnings,
          status: 'completed',
          endedAt:
            event.timestampSec && event.timestampSec > 0
              ? new Date(event.timestampSec * 1000)
              : new Date(),
        },
      });
      this.ws.broadcastRoundEnd({
        roundId: event.roundId,
        resolutionTxHash: signature,
        winningBlock: event.winningSquare + 1,
        totalWinningsLamports: event.totalWinnings.toString(),
      });
      this.logger.log(
        `Round ${event.roundId} resolved on block ${event.winningSquare + 1} (${signature})`,
      );
    } catch (error) {
      this.processedRoundEnds.delete(eventKey);
      throw error;
    }
  }

  private async upsertDeployCursor(slot: bigint, signature: string): Promise<boolean> {
    try {
      await this.db.indexerCursor.upsert({
        where: { key: this.deployCursorKey },
        create: {
          key: this.deployCursorKey,
          slot,
          signature,
        },
        update: {
          slot,
          signature,
        },
      });
      return true;
    } catch (error) {
      if (this.isMissingIndexerCursorTableError(error)) {
        this.warnMissingIndexerCursorTableOnce();
        return false;
      }
      throw error;
    }
  }

  private isMissingIndexerCursorTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const code = (error as { code?: unknown }).code;
    if (code !== 'P2021') {
      return false;
    }
    const tableValue = (error as { meta?: { table?: unknown } }).meta?.table;
    const table = typeof tableValue === 'string' ? tableValue : '';
    return table.includes('indexer_cursors');
  }

  private warnMissingIndexerCursorTableOnce() {
    if (this.warnedMissingIndexerCursorTable) {
      return;
    }
    this.warnedMissingIndexerCursorTable = true;
    this.logger.warn(
      'Indexer cursor table missing (indexer_cursors). Skipping deploy-log backfill until Prisma migration is applied.',
    );
  }

  private async handleBoardChange(data: Buffer) {
    const board = this.solana.decodeAccount<BoardAccount>('Board', data);
    const endTs = u64LikeToBigInt(board.endTs);
    const sanitizedEndTs = endTs === 9223372036854775807n ? null : this.safeInt(endTs, 'board.endTs', 0);
    this.ws.broadcastBoardUpdate({
      roundId: this.safeInt(board.roundId, 'board.roundId', 0),
      startTs: this.safeInt(board.startTs, 'board.startTs', 0),
      endTs: sanitizedEndTs,
      intermissionEndTs: this.safeInt(board.intermissionEndTs, 'board.intermissionEndTs', 0),
      epochId: this.safeInt(board.epochId, 'board.epochId', 0),
      vrfRequested: board.vrfRequested,
    });
  }

  private async handleRoundChange(data: Buffer, _pubkey: PublicKey) {
    const round = this.solana.decodeAccount<RoundAccount>('Round', data);
    const roundId = this.safeInt(round.id, 'round.id');
    const deployed = round.deployed.map((value, index) =>
      this.safeInt(value, `round.deployed[${index}]`),
    );
    const count = round.count.map((value, index) =>
      this.safeInt(value, `round.count[${index}]`),
    );
    const randomnessBytes = this.toSlotHashBuffer(
      round.randomness,
      `round.randomness(round=${roundId})`,
    );
    const isFinalized = round.resolved;

    // Compute winning square if finalized
    let winningSquare: number | null = this.resolvedWinners.get(roundId) ?? null;
    let isSplitReward = false;
    let didHitMotherlode = false;
    const topMiner = PublicKey.default.toBase58();
    const rentPayer = this.normalizeOptionalPubkey(
      round.rentPayer,
      `round.rentPayer(round=${roundId})`,
    );

    didHitMotherlode = isFinalized && round.motherlode > 0n;

    const status = isFinalized ? 'completed' : 'active';
    const totalMiners = this.safeInt(round.totalMiners, 'round.totalMiners');

    const roundPayload = {
      id: roundId,
      deployed,
      count,
      totalDeployed: round.totalDeployed.toString(),
      totalMiners,
      totalWinnings: round.totalWinnings.toString(),
      motherlode: round.motherlode.toString(),
      topMiner,
      // Gameplay reveal must be driven exclusively by round_end.
      winningSquare: null,
      status,
      expiresAt: round.expiresAt.toString(),
    };
    this.ws.broadcastRoundUpdate(roundPayload);

    if (!this.shouldPersistRoundState(roundId, isFinalized)) {
      return;
    }

    try {
      await this.db.round.upsert({
        where: { id: roundId },
        create: {
          id: roundId,
          deployed: deployed,
          count: count,
          slotHash: isFinalized ? randomnessBytes.toString('hex') : null,
          totalDeployed: BigInt(round.totalDeployed.toString()),
          totalMiners,
          totalVaulted: BigInt(round.totalVaulted.toString()),
          totalWinnings: BigInt(round.totalWinnings.toString()),
          motherlode: BigInt(round.motherlode.toString()),
          topMiner,
          topMinerReward: 0n,
          winningSquare,
          isSplitReward,
          didHitMotherlode,
          expiresAt: BigInt(round.expiresAt.toString()),
          rentPayer,
          status,
        },
        update: {
          deployed: deployed,
          count: count,
          slotHash: isFinalized ? randomnessBytes.toString('hex') : undefined,
          totalDeployed: BigInt(round.totalDeployed.toString()),
          totalMiners,
          totalVaulted: BigInt(round.totalVaulted.toString()),
          totalWinnings: BigInt(round.totalWinnings.toString()),
          motherlode: BigInt(round.motherlode.toString()),
          topMiner,
          topMinerReward: 0n,
          winningSquare: winningSquare ?? undefined,
          isSplitReward: isFinalized ? isSplitReward : undefined,
          didHitMotherlode: isFinalized ? didHitMotherlode : undefined,
          expiresAt: BigInt(round.expiresAt.toString()),
          rentPayer: rentPayer ?? undefined,
          status,
        },
      });

      const roundBlockOps = Array.from({ length: NUM_SQUARES }, (_, i) =>
        this.db.roundBlock.upsert({
          where: { roundId_blockNumber: { roundId, blockNumber: i } },
          create: {
            roundId,
            blockNumber: i,
            solDeployed: BigInt(round.deployed[i].toString()),
            minerCount: this.safeInt(round.count[i], `round.count[${i}]`),
          },
          update: {
            solDeployed: BigInt(round.deployed[i].toString()),
            minerCount: this.safeInt(round.count[i], `round.count[${i}]`),
          },
        }),
      );
      await this.db.$transaction(roundBlockOps);
    } catch (err) {
      this.logger.error(
        `Round ${roundId} state persistence failed (ws already emitted): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private shouldPersistRoundState(roundId: number, isFinalized: boolean): boolean {
    const now = Date.now();
    if (isFinalized) {
      this.roundStatePersistedAt.set(roundId, now);
      return true;
    }
    const lastPersistAt = this.roundStatePersistedAt.get(roundId) ?? 0;
    if (now - lastPersistAt < ROUND_STATE_PERSIST_THROTTLE_MS) {
      return false;
    }
    this.roundStatePersistedAt.set(roundId, now);
    return true;
  }

  private normalizePubkey(value: unknown, label: string, fallback: string): string {
    if (value instanceof PublicKey) {
      return value.toBase58();
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (value && typeof value === 'object' && 'toBase58' in value) {
      try {
        const encoded = (value as { toBase58: () => string }).toBase58();
        if (typeof encoded === 'string' && encoded.trim()) {
          return encoded;
        }
      } catch {
        // ignore and fallback
      }
    }
    this.logger.warn(`Invalid pubkey shape for ${label}; using fallback`);
    return fallback;
  }

  private normalizeOptionalPubkey(value: unknown, label: string): string | null {
    const fallback = PublicKey.default.toBase58();
    const normalized = this.normalizePubkey(value, label, fallback);
    return normalized === fallback ? null : normalized;
  }

  private async handleMinerChange(data: Buffer) {
    const miner = this.solana.decodeAccount<MinerAccount>('Miner', data);
    const wallet = miner.authority.toBase58();

    await this.db.miner.upsert({
      where: { wallet },
      create: {
        wallet,
        rewardsSol: BigInt(miner.rewardsSol.toString()),
        lifetimeRewardsSol: BigInt(miner.lifetimeRewardsSol.toString()),
        lifetimeDeployed: BigInt(miner.lifetimeDeployed.toString()),
        lastActive: new Date(),
      },
      update: {
        rewardsSol: BigInt(miner.rewardsSol.toString()),
        lifetimeRewardsSol: BigInt(miner.lifetimeRewardsSol.toString()),
        lifetimeDeployed: BigInt(miner.lifetimeDeployed.toString()),
        lastActive: new Date(),
      },
    });
  }

  async getIndexerStatus() {
    const slot = await this.solana.getCurrentSlot();
    return {
      currentSlot: slot,
      programId: this.solana.getProgramId().toBase58(),
      listening: this.subscriptionId !== null,
    };
  }

  private toSlotHashBuffer(raw: unknown, label: string): Buffer {
    if (Buffer.isBuffer(raw)) {
      return raw;
    }

    if (raw instanceof Uint8Array) {
      return Buffer.from(raw);
    }

    if (!Array.isArray(raw)) {
      this.logger.warn(`Invalid slot hash payload for ${label}; expected byte array`);
      return Buffer.alloc(32);
    }

    const bytes: number[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const normalized = u64LikeToBigInt(raw[i]);
      if (normalized < 0n || normalized > 255n) {
        this.logger.warn(
          `Invalid slot hash byte for ${label} at index ${i}: ${String(raw[i])}`,
        );
        return Buffer.alloc(32);
      }
      bytes.push(Number(normalized));
    }

    return Buffer.from(bytes);
  }
}
