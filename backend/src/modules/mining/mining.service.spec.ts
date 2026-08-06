import { Test, TestingModule } from '@nestjs/testing';
import { MiningService } from './mining.service';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { WebSocketService } from '../websocket/websocket.service';
import { MiningEventIngestionService } from './mining-event-ingestion.service';
import { SolanaService } from '../solana/solana.service';
import { RoundManagerService } from '../round-manager/round-manager.service';

const mockDb = {
  round: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  miner: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  deployment: { findMany: jest.fn(), create: jest.fn() },
  chatMessage: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
};

const mockRateLimit = {
  assertRealtimeRateLimit: jest.fn(),
};

const mockWs = {
  broadcastNewDeploy: jest.fn(),
};

const mockIngest = {
  ingestDeployment: jest.fn(),
  ingestFromSignature: jest.fn(),
};

const mockSolana = {
  fetchMiner: jest.fn(),
  buildAndSendCheckpointTx: jest.fn(),
};

const mockRoundManager = {
  getCurrentRound: jest.fn(),
};

describe('MiningService', () => {
  let service: MiningService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MiningService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: RateLimitService, useValue: mockRateLimit },
        { provide: WebSocketService, useValue: mockWs },
        { provide: MiningEventIngestionService, useValue: mockIngest },
        { provide: SolanaService, useValue: mockSolana },
        { provide: RoundManagerService, useValue: mockRoundManager },
      ],
    }).compile();

    service = module.get<MiningService>(MiningService);
  });

  describe('getMiner', () => {
    it('should return the miner record', async () => {
      const mockMiner = {
        wallet: 'walletABC',
        lifetimeRewardsSol: BigInt(100),
      };
      mockDb.miner.findUnique.mockResolvedValue(mockMiner);

      const result = await service.getMiner('walletABC');

      expect(result).toEqual(mockMiner);
      expect(mockDb.miner.findUnique).toHaveBeenCalledWith({
        where: { wallet: 'walletABC' },
      });
    });
  });

  describe('getMinerDeployments', () => {
    it('should return deployments for a wallet with the default limit of 20', async () => {
      const mockDeployments = [
        { id: 1, wallet: 'walletABC', roundId: 5, round: { id: 5 } },
        { id: 2, wallet: 'walletABC', roundId: 4, round: { id: 4 } },
      ];
      mockDb.deployment.findMany.mockResolvedValue(mockDeployments);

      const result = await service.getMinerDeployments('walletABC');

      expect(result).toEqual(mockDeployments);
      expect(mockDb.deployment.findMany).toHaveBeenCalledWith({
        where: { wallet: 'walletABC' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { round: true },
      });
    });
  });

  describe('getRoundDeployments', () => {
    it('should return all deployments for a given round with miner relation', async () => {
      const mockDeployments = [
        { id: 10, roundId: 7, wallet: 'w1', miner: { wallet: 'w1' } },
        { id: 11, roundId: 7, wallet: 'w2', miner: { wallet: 'w2' } },
      ];
      mockDb.deployment.findMany.mockResolvedValue(mockDeployments);

      const result = await service.getRoundDeployments(7);

      expect(result).toEqual(mockDeployments);
      expect(mockDb.deployment.findMany).toHaveBeenCalledWith({
        where: { roundId: 7 },
        orderBy: { createdAt: 'desc' },
        include: { miner: true },
      });
    });
  });

  describe('recordDeployment', () => {
    it('should upsert the miner and create a deployment record', async () => {
      const deploymentData = {
        roundId: 5,
        wallet: 'walletXYZ',
        squares: [0, 3, 12],
        amount: BigInt(1000),
        txHash: 'tx123abc',
      };

      const mockCreatedDeployment = {
        id: 99,
        roundId: 5,
        wallet: 'walletXYZ',
        squares: [1, 4, 13],
        amount: BigInt(1000),
        txHash: 'tx123abc',
      };
      mockIngest.ingestDeployment.mockResolvedValue({
        created: true,
        deployment: mockCreatedDeployment,
      });

      const result = await service.recordDeployment(deploymentData);

      expect(result).toEqual(mockCreatedDeployment);
      expect(mockIngest.ingestDeployment).toHaveBeenCalledWith({
        roundId: 5,
        wallet: 'walletXYZ',
        squares: [0, 3, 12],
        amountLamports: BigInt(1000),
        txHash: 'tx123abc',
        source: 'manual',
      });
    });
  });

  describe('getDeployReadiness', () => {
    beforeEach(() => {
      mockSolana.buildAndSendCheckpointTx.mockResolvedValue('checkpoint_sig');
    });

    it('returns checkpoint-required when round is finalizing', async () => {
      mockRoundManager.getCurrentRound.mockResolvedValue({
        board: {
          roundId: 42,
          startSlot: 1_000,
          endSlot: 1_150,
          currentSlot: 1_150,
          canDeploy: false,
          requiresCheckpoint: true,
        },
      });

      const result = await service.getDeployReadiness('E6Rj1zQTtrrGz8C5cNYZDofUHHAhfizRaoqZ1sTkZYXs');
      expect(result).toEqual({
        canDeploy: false,
        requiresCheckpoint: true,
        reason: 'ROUND_FINALIZING',
        roundId: 42,
        startSlot: 1_000,
        endSlot: 1_150,
        currentSlot: 1_150,
      });
    });

    it('returns miner checkpoint-required when miner is behind board round', async () => {
      mockRoundManager.getCurrentRound.mockResolvedValue({
        board: {
          roundId: 42,
          startSlot: 1_000,
          endSlot: 1_150,
          currentSlot: 1_020,
          canDeploy: true,
          requiresCheckpoint: false,
        },
      });
      mockSolana.fetchMiner.mockResolvedValue({
        roundId: 41n,
        checkpointId: 40n,
      });

      const result = await service.getDeployReadiness('E6Rj1zQTtrrGz8C5cNYZDofUHHAhfizRaoqZ1sTkZYXs');
      expect(result).toEqual({
        canDeploy: false,
        requiresCheckpoint: true,
        reason: 'MINER_CHECKPOINT_REQUIRED',
        roundId: 42,
        startSlot: 1_000,
        endSlot: 1_150,
        currentSlot: 1_020,
      });
      expect(mockSolana.buildAndSendCheckpointTx).not.toHaveBeenCalled();
    });

    it('returns ready when round is deployable and miner is checkpointed', async () => {
      mockRoundManager.getCurrentRound.mockResolvedValue({
        board: {
          roundId: 42,
          startSlot: 1_000,
          endSlot: 1_150,
          currentSlot: 1_020,
          canDeploy: true,
          requiresCheckpoint: false,
        },
      });
      mockSolana.fetchMiner.mockResolvedValue({
        roundId: 42n,
        checkpointId: 42n,
      });

      const result = await service.getDeployReadiness('E6Rj1zQTtrrGz8C5cNYZDofUHHAhfizRaoqZ1sTkZYXs');
      expect(result).toEqual({
        canDeploy: true,
        requiresCheckpoint: false,
        reason: 'READY',
        roundId: 42,
        startSlot: 1_000,
        endSlot: 1_150,
        currentSlot: 1_020,
      });
    });
  });
});
