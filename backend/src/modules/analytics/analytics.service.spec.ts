import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { DatabaseService } from '../database/database.service';

const mockDb = {
  round: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  miner: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  deployment: { findMany: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
  chatMessage: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getGlobalStats', () => {
    it('should calculate global stats from game records', async () => {
      mockDb.round.count.mockResolvedValue(100);
      mockDb.miner.count.mockResolvedValue(50);
      mockDb.deployment.aggregate.mockResolvedValue({
        _sum: { amount: 999999n },
      });
      mockDb.round.findFirst.mockResolvedValue({ id: 101 });

      const result = await service.getGlobalStats();

      expect(result).toEqual({
        totalRounds: 100,
        totalMiners: 50,
        totalDeployed: '999999',
        currentRoundId: 101,
      });
    });
  });

  describe('getLeaderboard', () => {
    it('should return ranked miners with correct win rate calculation', async () => {
      const mockMiners = [
        {
          wallet: 'topMiner',
          lifetimeRewardsSol: BigInt(5000),
          lifetimeDeployed: BigInt(10000),
          roundsPlayed: 100,
          roundsWon: 25,
        },
        {
          wallet: 'secondMiner',
          lifetimeRewardsSol: BigInt(3000),
          lifetimeDeployed: BigInt(8000),
          roundsPlayed: 80,
          roundsWon: 10,
        },
      ];
      mockDb.miner.findMany.mockResolvedValue(mockMiners);

      const result = await service.getLeaderboard();

      expect(result).toHaveLength(2);

      // First miner: rank 1, winRate = (25/100)*100 = 25
      expect(result[0]).toEqual({
        rank: 1,
        wallet: 'topMiner',
        totalMined: '5000',
        totalDeployed: '10000',
        roundsPlayed: 100,
        roundsWon: 25,
        winRate: 25,
      });

      // Second miner: rank 2, winRate = (10/80)*100 = 12.5
      expect(result[1]).toEqual({
        rank: 2,
        wallet: 'secondMiner',
        totalMined: '3000',
        totalDeployed: '8000',
        roundsPlayed: 80,
        roundsWon: 10,
        winRate: 12.5,
      });

      expect(mockDb.miner.findMany).toHaveBeenCalledWith({
        orderBy: { lifetimeRewardsSol: 'desc' },
        take: 25,
      });
    });

    it('should return winRate of 0 when a miner has zero rounds played', async () => {
      const mockMiners = [
        {
          wallet: 'newMiner',
          lifetimeRewardsSol: BigInt(0),
          lifetimeDeployed: BigInt(0),
          roundsPlayed: 0,
          roundsWon: 0,
        },
      ];
      mockDb.miner.findMany.mockResolvedValue(mockMiners);

      const result = await service.getLeaderboard();

      expect(result[0].winRate).toBe(0);
    });
  });

  describe('getMinerStats', () => {
    it('should return null for a non-existent wallet', async () => {
      mockDb.miner.findUnique.mockResolvedValue(null);

      const result = await service.getMinerStats('nonExistentWallet');

      expect(result).toBeNull();
      expect(mockDb.miner.findUnique).toHaveBeenCalledWith({
        where: { wallet: 'nonExistentWallet' },
      });
    });

    it('should calculate win rate correctly as (roundsWon / roundsPlayed) * 100', async () => {
      const lastActiveDate = new Date('2024-01-15T12:00:00Z');
      const mockMiner = {
        wallet: 'minerWallet',
        lifetimeRewardsSol: BigInt(7500),
        lifetimeDeployed: BigInt(20000),
        roundsPlayed: 200,
        roundsWon: 50,
        lastActive: lastActiveDate,
      };
      mockDb.miner.findUnique.mockResolvedValue(mockMiner);

      const result = await service.getMinerStats('minerWallet');

      expect(result).toEqual({
        wallet: 'minerWallet',
        totalMined: '7500',
        totalDeployed: '20000',
        roundsPlayed: 200,
        roundsWon: 50,
        winRate: 25, // (50/200) * 100
        lastActive: lastActiveDate,
      });
    });
  });

  describe('getRecentRounds', () => {
    it('should return rounds ordered by id descending with the correct select fields', async () => {
      const mockRounds = [
        {
          id: 10,
          totalDeployed: BigInt(5000),
          totalMiners: 15,
          totalWinnings: BigInt(1000),
          winningSquare: 7,
          topMiner: 'walletTop',
          status: 'completed',
          createdAt: new Date(),
        },
        {
          id: 9,
          totalDeployed: BigInt(4000),
          totalMiners: 12,
          totalWinnings: BigInt(800),
          winningSquare: 3,
          topMiner: 'walletSecond',
          status: 'completed',
          createdAt: new Date(),
        },
      ];
      mockDb.round.findMany.mockResolvedValue(mockRounds);

      const result = await service.getRecentRounds();

      expect(result).toEqual(mockRounds);
      expect(mockDb.round.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'desc' },
        take: 10,
        select: {
          id: true,
          totalDeployed: true,
          totalMiners: true,
          totalWinnings: true,
          winningSquare: true,
          topMiner: true,
          deployments: {
            select: {
              wallet: true,
              squares: true,
              amount: true,
              txHash: true,
            },
          },
          status: true,
          createdAt: true,
        },
      });
    });
  });
});
