import { IndexerService } from './indexer.service';
import { PublicKey } from '@solana/web3.js';

describe('IndexerService', () => {
  function createService() {
    const connection = {
      onLogs: jest.fn().mockReturnValueOnce(11).mockReturnValueOnce(12),
      removeOnLogsListener: jest.fn(),
      getSignaturesForAddress: jest.fn(),
      getTransaction: jest.fn(),
    };
    const db = {
      indexerCursor: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      round: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const solana = {
      getConnection: jest.fn().mockReturnValue(connection),
      getProgramId: jest
        .fn()
        .mockReturnValue(new PublicKey('CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F')),
      getVrfProgramId: jest
        .fn()
        .mockReturnValue(new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz')),
      onProgramAccountChange: jest.fn(),
    };
    const ws = {
      broadcastNewDeploy: jest.fn(),
      broadcastBoardUpdate: jest.fn(),
      broadcastRoundUpdate: jest.fn(),
      broadcastRoundEnd: jest.fn(),
    };
    const miningIngest = {
      decodeSquaresFromMask: jest.fn(),
      ingestDeployment: jest.fn(),
      ingestFromSignature: jest.fn(),
    };

    const service = new IndexerService(
      db as never,
      solana as never,
      ws as never,
      miningIngest as never,
    );

    return { service, db, solana, connection, ws };
  }

  it('listens to both game and VRF transactions', () => {
    const { service, solana, connection } = createService();

    (
      service as unknown as {
        startLogListening: () => void;
      }
    ).startLogListening();

    expect(connection.onLogs).toHaveBeenCalledTimes(2);
    expect(connection.onLogs.mock.calls[0]?.[0].toBase58()).toBe(
      solana.getProgramId().toBase58(),
    );
    expect(connection.onLogs.mock.calls[1]?.[0].toBase58()).toBe(
      solana.getVrfProgramId().toBase58(),
    );
  });

  it('persists and broadcasts a fulfillment only once', async () => {
    const { service, db, ws } = createService();
    db.round.findUnique.mockResolvedValue({ winningSquare: null });
    db.round.updateMany.mockResolvedValue({ count: 1 });
    const fulfill = {
      roundId: 4,
      winningSquare: 7,
      totalWinnings: 9_000_000n,
      timestampSec: 1_700_000_000,
    };
    const applyFulfillEvent = (
      service as unknown as {
        applyFulfillEvent: (event: typeof fulfill, signature: string) => Promise<void>;
      }
    ).applyFulfillEvent.bind(service);

    await Promise.all([
      applyFulfillEvent(fulfill, 'resolution-signature'),
      applyFulfillEvent(fulfill, 'resolution-signature'),
    ]);

    expect(db.round.updateMany).toHaveBeenCalledTimes(1);
    expect(ws.broadcastRoundEnd).toHaveBeenCalledTimes(1);
    expect(ws.broadcastRoundEnd).toHaveBeenCalledWith({
      roundId: 4,
      resolutionTxHash: 'resolution-signature',
      winningBlock: 8,
      totalWinningsLamports: '9000000',
    });
  });

  it('recovers a missed fulfillment from VRF transaction history', async () => {
    const { service, db, connection, ws } = createService();
    const signature = 'historical-resolution-signature';
    db.round.findMany.mockResolvedValue([{ id: 0 }]);
    db.round.findUnique.mockResolvedValue({ winningSquare: null });
    db.round.updateMany.mockResolvedValue({ count: 1 });
    connection.getSignaturesForAddress.mockResolvedValue([
      { signature, slot: 16150, err: null },
    ]);
    connection.getTransaction.mockResolvedValue({
      slot: 16150,
      meta: {
        err: null,
        logMessages: [
          'Program Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz invoke [1]',
          'Program CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F invoke [2]',
          'Program log: Instruction: CallbackResolveRound',
          'Program data: PwQBOpK2g1cAAAAAAAAAAAAAAAAAAAAAAB5mAwAAAAAAAAAAAAAAAABPDHJqAAAAAA==',
          'Program CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F success',
          'Program Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz success',
        ],
      },
    });

    await (
      service as unknown as {
        reconcileMissingRoundEnds: () => Promise<void>;
      }
    ).reconcileMissingRoundEnds();

    expect(db.round.findMany).toHaveBeenCalledWith({
      where: { status: 'completed', winningSquare: null },
      orderBy: { id: 'desc' },
      take: 100,
      select: { id: true },
    });
    expect(db.round.updateMany).toHaveBeenCalledWith({
      where: { id: 0 },
      data: expect.objectContaining({
        winningSquare: 0,
        totalWinnings: 57_024_000n,
        status: 'completed',
      }),
    });
    expect(ws.broadcastRoundEnd).toHaveBeenCalledWith({
      roundId: 0,
      resolutionTxHash: signature,
      winningBlock: 1,
      totalWinningsLamports: '57024000',
    });
  });

  it('does not crash when indexer cursor table is missing (P2021)', async () => {
    const { service, db } = createService();
    const warnSpy = jest
      .spyOn((service as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    db.indexerCursor.findUnique.mockRejectedValue({
      code: 'P2021',
      meta: { table: 'public.indexer_cursors' },
    });

    await expect(service.backfillMissedDeployLogs()).resolves.toBeUndefined();
    await expect(service.backfillMissedDeployLogs()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('rethrows unexpected errors from cursor read', async () => {
    const { service, db } = createService();
    db.indexerCursor.findUnique.mockRejectedValue(new Error('boom'));

    await expect(service.backfillMissedDeployLogs()).rejects.toThrow('boom');
  });
});
