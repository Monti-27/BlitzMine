import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { ProfileService } from './profile.service';

const mockDb = {
  $queryRaw: jest.fn(),
  userProfile: {
    findMany: jest.fn(),
  },
  miner: {
    findMany: jest.fn(),
  },
  reward: {
    groupBy: jest.fn(),
  },
};

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.userProfile.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([]);
    mockDb.miner.findMany.mockResolvedValue([]);
    mockDb.reward.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  it('returns batch hover data in stable wallet order', async () => {
    mockDb.userProfile.findMany.mockResolvedValue([
      { wallet: 'walletA', username: 'alpha', avatarUrl: 'https://cdn/a.png' },
    ]);
    mockDb.miner.findMany.mockResolvedValue([
      {
        wallet: 'walletA',
        lifetimeDeployed: 2_000_000_000n,
        roundsPlayed: 10,
      },
      {
        wallet: 'walletB',
        lifetimeDeployed: 1_000_000_000n,
        roundsPlayed: 5,
      },
    ]);
    mockDb.reward.groupBy.mockResolvedValue([
      { wallet: 'walletA', _count: { _all: 2 } },
    ]);
    mockDb.$queryRaw.mockResolvedValue([
      { wallet: 'walletA', rank: 1 },
      { wallet: 'walletB', rank: 2 },
    ]);

    const result = await service.getProfileHoverBatch(['walletB', 'walletA']);

    expect(result).toHaveLength(2);
    expect(result[0].wallet).toBe('walletB');
    expect(result[1].wallet).toBe('walletA');
    expect(result[0].data?.rank).toBe(2);
    expect(result[1].data?.rank).toBe(1);
    expect(result[1].data?.motherlodeHits).toBe(2);
    expect(result[1].data?.deployedSol).toBe(2);
  });

  it('returns an empty hover payload when a wallet has no profile or miner', async () => {
    const hover = await service.getProfileHover('walletC');

    expect(hover.walletAddress).toBe('walletC');
    expect(hover.username).toBeNull();
    expect(hover.deployedSol).toBe(0);
    expect(hover.roundsPlayed).toBe(0);
  });
});
