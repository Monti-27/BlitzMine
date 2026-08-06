import { RoundManagerService } from './round-manager.service';

describe('RoundManagerService', () => {
  const now = BigInt(Math.floor(Date.now() / 1000));

  function createService() {
    const db = {
      round: { findUnique: jest.fn() },
    };
    const solana = {
      ensureInitialized: jest.fn(),
      refreshGameConnection: jest.fn(),
      fetchBoard: jest.fn(),
      fetchRound: jest.fn(),
      fetchBaseRound: jest.fn(),
      fetchTreasury: jest.fn(),
      ensureCoreDelegated: jest.fn(),
      ensureRoundPreparedAndDelegated: jest.fn(),
      buildAndSendResetTx: jest.fn(),
      buildAndSendCancelRoundTx: jest.fn(),
      buildAndSendCommitGameTx: jest.fn(),
    };
    const schedulerLock = {
      runWithLease: jest.fn(
        async (_name: string, _leaseMs: number, task: () => Promise<unknown>) => task(),
      ),
    };
    const service = new RoundManagerService(
      db as never,
      solana as never,
      schedulerLock as never,
    );
    return { service, db, solana, schedulerLock };
  }

  function board(overrides: Record<string, unknown> = {}) {
    return {
      roundId: 4n,
      startTs: now - 10n,
      endTs: now + 50n,
      intermissionEndTs: now - 20n,
      epochId: 4n,
      vrfRequestedAt: 0n,
      requestNonce: 0n,
      vrfRequested: false,
      vrfFulfilled: false,
      ...overrides,
    };
  }

  it('returns the current on-chain round and phase', async () => {
    const { service, solana } = createService();
    solana.fetchBoard.mockResolvedValue(board());
    solana.fetchRound.mockResolvedValue({
      id: 4n,
      deployed: new Array(25).fill(0n),
      count: new Array(25).fill(0n),
      resolved: false,
    });
    solana.fetchTreasury.mockResolvedValue({ motherlode: 0n });

    const result = await service.getCurrentRound();

    expect(result?.phase).toBe('active');
    expect(result?.id).toBe(4);
    expect(result?.status).toBe('active');
    expect(result?.board.phase).toBe('ACTIVE');
    expect(result?.board.slotMs).toBe(1_000);
    expect(result?.treasury).toEqual({ motherlode: 0n });
  });

  it('allows the first deploy before the round timer starts', async () => {
    const { service, solana } = createService();
    solana.fetchBoard.mockResolvedValue(
      board({ startTs: 0n, endTs: 9223372036854775807n }),
    );
    solana.fetchRound.mockResolvedValue({
      id: 4n,
      deployed: new Array(25).fill(0n),
      count: new Array(25).fill(0n),
      resolved: false,
    });
    solana.fetchTreasury.mockResolvedValue({ motherlode: 0n });

    const result = await service.getCurrentRound();

    expect(result?.phase).toBe('waiting');
    expect(result?.status).toBe('active');
    expect(result?.board.canDeploy).toBe(true);
    expect(result?.board.timerActive).toBe(false);
  });

  it('prepares the future round and requests randomness after the deadline', async () => {
    const { service, solana } = createService();
    solana.fetchBoard.mockResolvedValue(board({ endTs: now - 1n }));
    solana.fetchBaseRound.mockResolvedValue({ resolved: true });
    solana.ensureRoundPreparedAndDelegated.mockResolvedValue(undefined);
    solana.buildAndSendResetTx.mockResolvedValue('vrf-request');

    await service.checkRoundStatus();

    expect(solana.ensureRoundPreparedAndDelegated).toHaveBeenCalledWith(5);
    expect(solana.ensureCoreDelegated).toHaveBeenCalledWith(4);
    expect(solana.buildAndSendResetTx).toHaveBeenCalledWith(4);
  });

  it('cancels a randomness request after its timeout', async () => {
    const { service, solana } = createService();
    solana.fetchBoard.mockResolvedValue(
      board({
        endTs: now - 40n,
        vrfRequested: true,
        vrfRequestedAt: now - 31n,
      }),
    );
    solana.fetchBaseRound.mockResolvedValue({ resolved: true });
    solana.ensureRoundPreparedAndDelegated.mockResolvedValue(undefined);
    solana.buildAndSendCancelRoundTx.mockResolvedValue('cancel-request');

    await service.checkRoundStatus();

    expect(solana.buildAndSendCancelRoundTx).toHaveBeenCalledWith(4);
    expect(solana.buildAndSendResetTx).not.toHaveBeenCalled();
  });
});
