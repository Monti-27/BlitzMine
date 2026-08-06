import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { SolanaService } from '../solana/solana.service';
import { SchedulerLockService } from '../scheduler-lock/scheduler-lock.service';
import { bigintToSafeInt } from '../../common/numeric/u64';

const I64_MAX = 9223372036854775807n;
const VRF_TIMEOUT_SECONDS = 30n;

@Injectable()
export class RoundManagerService {
  private readonly logger = new Logger(RoundManagerService.name);
  private running = false;
  private observedRoundId: number | null = null;
  private readonly preparedRounds = new Set<number>();
  private readonly committedRounds = new Set<number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly solana: SolanaService,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async checkRoundStatus(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedulerLock.runWithLease('cron:blitzmine:lifecycle', 8_000, async () => {
        await this.advanceLifecycle();
      });
    } catch (error) {
      this.logger.error(
        `Round lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async getCurrentRound() {
    await this.solana.refreshGameConnection();
    const board = await this.solana.fetchBoard();
    if (!board) return null;
    const roundId = bigintToSafeInt(board.roundId, 'board.roundId');
    const [round, treasury] = await Promise.all([
      this.solana.fetchRound(roundId),
      this.solana.fetchTreasury(),
    ]);
    if (!round) return null;
    const serverTs = Math.floor(Date.now() / 1000);
    const phase = this.getPhase(board.endTs, board.intermissionEndTs, board.vrfRequested);
    const endTs = board.endTs === I64_MAX ? null : bigintToSafeInt(board.endTs, 'board.endTs');
    const startTs = bigintToSafeInt(board.startTs, 'board.startTs');
    const timerActive = phase === 'active';
    const canDeploy = phase === 'waiting' || timerActive;
    const timeRemainingSec = endTs === null ? 0 : Math.max(0, endTs - serverTs);
    const boardView = {
      ...board,
      roundId,
      startSlot: startTs,
      endSlot: endTs,
      currentSlot: serverTs,
      slotMs: 1_000,
      timerActive,
      timeRemainingSec,
      displayTimerSec: timerActive ? timeRemainingSec : null,
      waitingMessage: timerActive ? null : this.getWaitingMessage(phase),
      phase: phase === 'active' ? 'ACTIVE' : phase === 'intermission' ? 'INTERMISSION' : 'PENDING_DEPLOY',
      transitionToken: `${roundId}:${board.requestNonce.toString()}:${phase}`,
      updatedAt: new Date(serverTs * 1_000).toISOString(),
      isFresh: true,
      roundStartMs: startTs * 1_000,
      roundEndMs: endTs === null ? null : endTs * 1_000,
      canDeploy,
      requiresCheckpoint: phase === 'randomness_pending' || phase === 'ready_to_resolve',
    };
    return {
      ...round,
      id: roundId,
      status: round.resolved ? 'completed' : canDeploy ? 'active' : 'pending',
      winningSquare: null,
      board: boardView,
      treasury,
      blocks: round.deployed.map((solDeployed, blockNumber) => ({
        blockNumber,
        solDeployed,
        minerCount: bigintToSafeInt(round.count[blockNumber] ?? 0n, `round.count.${blockNumber}`),
      })),
      phase,
      serverTs,
    };
  }

  async getRound(id: number) {
    const onChain = await this.solana.fetchRound(id);
    if (onChain) return onChain;
    return this.db.round.findUnique({ where: { id } });
  }

  private async advanceLifecycle(): Promise<void> {
    await this.solana.ensureInitialized();
    await this.solana.refreshGameConnection();
    let board = await this.solana.fetchBoard();
    if (!board) return;

    const roundId = bigintToSafeInt(board.roundId, 'board.roundId');
    await this.solana.ensureCoreDelegated(roundId);
    await this.solana.refreshGameConnection();
    board = (await this.solana.fetchBoard()) ?? board;
    await this.ensureFutureRound(roundId + 1);

    if (this.observedRoundId === null && roundId > 0) {
      await this.commitCompletedRound(roundId - 1);
    } else if (this.observedRoundId !== null && roundId > this.observedRoundId) {
      for (let completed = this.observedRoundId; completed < roundId; completed += 1) {
        await this.commitCompletedRound(completed);
      }
    }
    this.observedRoundId = roundId;

    if (board.endTs === I64_MAX) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < board.endTs) return;

    if (!board.vrfRequested) {
      const signature = await this.solana.buildAndSendResetTx(roundId);
      this.logger.log(`Requested VRF for round ${roundId}: ${signature}`);
      return;
    }

    if (
      !board.vrfFulfilled &&
      now >= board.vrfRequestedAt + VRF_TIMEOUT_SECONDS
    ) {
      const signature = await this.solana.buildAndSendCancelRoundTx(roundId);
      this.logger.warn(`Canceled timed-out VRF for round ${roundId}: ${signature}`);
    }
  }

  private async ensureFutureRound(roundId: number): Promise<void> {
    if (this.preparedRounds.has(roundId)) return;
    await this.solana.ensureRoundPreparedAndDelegated(roundId);
    this.preparedRounds.add(roundId);
    this.logger.log(`Prepared and delegated round ${roundId}`);
  }

  private async commitCompletedRound(roundId: number): Promise<void> {
    if (this.committedRounds.has(roundId)) return;
    const baseRound = await this.solana.fetchBaseRound(roundId);
    if (baseRound?.resolved) {
      this.committedRounds.add(roundId);
      return;
    }
    const signature = await this.solana.buildAndSendCommitGameTx(roundId);
    this.committedRounds.add(roundId);
    this.logger.log(`Committed round ${roundId} to Solana: ${signature}`);
  }

  private getPhase(endTs: bigint, intermissionEndTs: bigint, vrfRequested: boolean): string {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < intermissionEndTs) return 'intermission';
    if (endTs === I64_MAX) return 'waiting';
    if (now < endTs) return 'active';
    return vrfRequested ? 'randomness_pending' : 'ready_to_resolve';
  }

  private getWaitingMessage(phase: string): string {
    if (phase === 'intermission') return 'Next round starting…';
    if (phase === 'randomness_pending') return 'Resolving the round…';
    if (phase === 'ready_to_resolve') return 'Requesting randomness…';
    return 'Waiting for deploy…';
  }
}
