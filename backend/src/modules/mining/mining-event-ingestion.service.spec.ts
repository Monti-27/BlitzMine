import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MiningEventIngestionService } from './mining-event-ingestion.service';
import { DatabaseService } from '../database/database.service';
import { SolanaService } from '../solana/solana.service';

const mockTx = {
  deployment: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  round: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  miner: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  roundParticipant: {
    createMany: jest.fn(),
  },
};

const mockDb = {
  deployment: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
};

const mockSolana = {
  getConnection: jest.fn(),
  getProgramId: jest.fn(),
};

describe('MiningEventIngestionService', () => {
  let service: MiningEventIngestionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MiningEventIngestionService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: SolanaService, useValue: mockSolana },
      ],
    }).compile();

    service = module.get<MiningEventIngestionService>(MiningEventIngestionService);
  });

  it('returns existing deployment when tx hash is already indexed', async () => {
    const existing = {
      id: 1,
      roundId: 12,
      wallet: 'wallet-1',
      squares: [1, 2],
      amount: 2000n,
      txHash: 'sig-1',
      slot: 100n,
      source: 'manual',
      createdAt: new Date(),
    };

    mockDb.deployment.findUnique.mockResolvedValue(existing);

    const result = await service.ingestDeployment({
      roundId: 12,
      wallet: 'wallet-1',
      squares: [1, 2],
      amountLamports: 2000n,
      txHash: 'sig-1',
      source: 'manual',
    });

    expect(result).toEqual({ created: false, deployment: existing });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('creates deployment and increments roundsPlayed only on first participation', async () => {
    mockDb.deployment.findUnique.mockResolvedValue(null);
    mockTx.deployment.findUnique.mockResolvedValue(null);
    mockTx.round.findUnique.mockResolvedValue({ id: 7 });
    mockTx.roundParticipant.createMany.mockResolvedValue({ count: 1 });

    const created = {
      id: 11,
      roundId: 7,
      wallet: 'wallet-abc',
      squares: [1, 5],
      amount: 4000n,
      txHash: 'sig-abc',
      slot: 200n,
      source: 'manual',
      createdAt: new Date(),
    };
    mockTx.deployment.create.mockResolvedValue(created);

    const result = await service.ingestDeployment({
      roundId: 7,
      wallet: 'wallet-abc',
      squares: [1, 5],
      amountLamports: 4000n,
      txHash: 'sig-abc',
      slot: 200n,
      source: 'manual',
    });

    expect(result.created).toBe(true);
    expect(result.deployment).toEqual(created);
    expect(mockTx.roundParticipant.createMany).toHaveBeenCalled();
    expect(mockTx.miner.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wallet: 'wallet-abc' },
        data: expect.objectContaining({
          lifetimeDeployed: { increment: 4000n },
          roundsPlayed: { increment: 1 },
        }),
      }),
    );
  });

  it('rejects ingestFromSignature when authenticated wallet does not match event wallet/signer', async () => {
    jest
      .spyOn(service, 'resolveDeploymentFromSignature')
      .mockResolvedValue({
        roundId: 3,
        wallet: 'wallet-authority',
        signer: 'wallet-signer',
        squares: [1],
        amountLamports: 1000n,
        txHash: 'sig-x',
        slot: 12n,
        createdAt: new Date(),
        source: 'manual',
      });

    await expect(
      service.ingestFromSignature('sig-x', {
        expectedWallet: 'wallet-other',
        sourceOverride: 'report',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns existing deployment after tx_hash race (P2002) without querying aborted tx client', async () => {
    const existing = {
      id: 91,
      roundId: 9,
      wallet: 'wallet-race',
      squares: [4],
      amount: 5000n,
      txHash: 'sig-race',
      slot: 999n,
      source: 'manual',
      createdAt: new Date(),
    };

    mockDb.deployment.findUnique
      .mockResolvedValueOnce(null) // preflight check
      .mockResolvedValueOnce(existing); // post-transaction retry lookup
    mockTx.deployment.findUnique.mockResolvedValue(null);
    mockTx.round.findUnique.mockResolvedValue({ id: 9 });
    mockTx.roundParticipant.createMany.mockResolvedValue({ count: 1 });
    mockTx.deployment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.ingestDeployment({
      roundId: 9,
      wallet: 'wallet-race',
      squares: [4],
      amountLamports: 5000n,
      txHash: 'sig-race',
      source: 'manual',
    });

    expect(result).toEqual({ created: false, deployment: existing });
    expect(mockTx.deployment.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.deployment.findUnique).toHaveBeenCalledTimes(2);
  });
});
