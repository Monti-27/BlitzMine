import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly db: DatabaseService) {}

  async getGlobalStats() {
    const [rounds, miners, deployed, currentRound] = await Promise.all([
      this.db.round.count({ where: { status: 'completed' } }),
      this.db.miner.count(),
      this.db.deployment.aggregate({ _sum: { amount: true } }),
      this.db.round.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
    ]);
    return {
      totalRounds: rounds,
      totalMiners: miners,
      totalDeployed: (deployed._sum.amount ?? 0n).toString(),
      currentRoundId: currentRound?.id ?? 0,
    };
  }

  async getLeaderboard(limit: number = 25) {
    const miners = await this.db.miner.findMany({
      orderBy: { lifetimeRewardsSol: 'desc' },
      take: limit,
    });

    return miners.map((miner, index) => ({
      rank: index + 1,
      wallet: miner.wallet,
      totalMined: miner.lifetimeRewardsSol.toString(),
      totalDeployed: miner.lifetimeDeployed.toString(),
      roundsPlayed: miner.roundsPlayed,
      roundsWon: miner.roundsWon,
      winRate: miner.roundsPlayed > 0 ? (miner.roundsWon / miner.roundsPlayed) * 100 : 0,
    }));
  }

  async getMinerStats(wallet: string) {
    const miner = await this.db.miner.findUnique({ where: { wallet } });
    if (!miner) return null;

    return {
      wallet: miner.wallet,
      totalMined: miner.lifetimeRewardsSol.toString(),
      totalDeployed: miner.lifetimeDeployed.toString(),
      roundsPlayed: miner.roundsPlayed,
      roundsWon: miner.roundsWon,
      winRate: miner.roundsPlayed > 0 ? (miner.roundsWon / miner.roundsPlayed) * 100 : 0,
      lastActive: miner.lastActive,
    };
  }

  async getRoundAnalytics(roundId: number) {
    const round = await this.db.round.findUnique({
      where: { id: roundId },
      include: { deployments: true },
    });
    if (!round) return null;

    return {
      roundId: round.id,
      totalDeployed: round.totalDeployed.toString(),
      totalMiners: round.totalMiners,
      winningSquare: round.winningSquare,
      status: round.status,
      deploymentCount: round.deployments.length,
    };
  }

  async getRecentRounds(limit: number = 10) {
    return this.db.round.findMany({
      orderBy: { id: 'desc' },
      take: limit,
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
  }

  // getDailyStats
  async getDailyStats(days: number = 7) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rounds = await this.db.round.findMany({
      where: { createdAt: { gte: cutoff }, status: 'completed' },
      orderBy: { createdAt: 'asc' },
      select: {
        totalDeployed: true,
        totalMiners: true,
        totalWinnings: true,
        createdAt: true,
      },
    });

    const dailyMap = new Map<string, { deployed: bigint; miners: number; winnings: bigint; rounds: number }>();
    for (const r of rounds) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const existing = dailyMap.get(day) ?? { deployed: 0n, miners: 0, winnings: 0n, rounds: 0 };
      existing.deployed += r.totalDeployed;
      existing.miners += r.totalMiners;
      existing.winnings += r.totalWinnings;
      existing.rounds += 1;
      dailyMap.set(day, existing);
    }

    return Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date,
      totalDeployed: stats.deployed.toString(),
      totalMiners: stats.miners,
      totalWinnings: stats.winnings.toString(),
      roundsCompleted: stats.rounds,
    }));
  }

  // getRewardHistory
  async getRewardHistory(wallet: string, limit: number = 20) {
    return this.db.reward.findMany({
      where: { wallet },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { round: { select: { id: true, winningSquare: true, status: true } } },
    });
  }
}
