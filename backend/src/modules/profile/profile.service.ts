import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

type ProfileHoverPayload = {
  username: string | null;
  walletAddress: string;
  avatarColor: string;
  avatarImage: string | null;
  rank: number | null;
  deployedSol: number;
  roundsPlayed: number;
  motherlodeHits: number;
};

const SOL_LAMPORTS = 1_000_000_000;
const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const RESERVED_USERNAMES = new Set([
  'admin',
  'support',
  'root',
  'system',
  'moderator',
  'blitzmine',
]);
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-orange-500',
  'bg-teal-500',
];

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  async getPublicProfile(wallet: string) {
    return this.buildPublicProfile(wallet);
  }

  async getProfileHover(wallet: string) {
    const hoverMap = await this.buildHoverMap([wallet]);
    return hoverMap.get(wallet) ?? this.emptyHover(wallet);
  }

  async getProfileHoverBatch(wallets: string[]) {
    const hoverMap = await this.buildHoverMap(wallets);
    return wallets.map((wallet) => ({
      wallet,
      data: hoverMap.get(wallet) ?? null,
    }));
  }

  async getProfileHoverByUsername(username: string) {
    const profile = await this.db.userProfile.findUnique({
      where: { usernameNormalized: this.normalizeUsername(username) },
      select: { wallet: true },
    });
    return profile ? this.getProfileHover(profile.wallet) : null;
  }

  async updateProfile(wallet: string, dto: UpdateProfileDto) {
    const existing = await this.db.userProfile.findUnique({
      where: { wallet },
    });
    const nextUsername = dto.username?.trim();
    const usernameChanged =
      nextUsername !== undefined &&
      nextUsername !== (existing?.username ?? undefined);
    let usernameNormalized: string | undefined;
    let usernameChangedAt: Date | undefined;

    if (usernameChanged) {
      usernameNormalized = this.normalizeUsername(nextUsername ?? '');
      if (!usernameNormalized) {
        throw new BadRequestException('Username cannot be empty');
      }
      if (RESERVED_USERNAMES.has(usernameNormalized)) {
        throw this.profileError('USERNAME_RESERVED', 'Username is reserved');
      }
      if (existing?.usernameChangedAt) {
        const elapsed = Date.now() - existing.usernameChangedAt.getTime();
        if (elapsed < USERNAME_COOLDOWN_MS) {
          const remainingDays = Math.ceil(
            (USERNAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000),
          );
          throw this.profileError(
            'USERNAME_COOLDOWN',
            `Username can be changed again in ${remainingDays} day(s)`,
          );
        }
      }
      const conflict = await this.db.userProfile.findFirst({
        where: {
          usernameNormalized,
          wallet: { not: wallet },
        },
        select: { wallet: true },
      });
      if (conflict) {
        throw this.profileError('USERNAME_TAKEN', 'Username is already taken');
      }
      usernameChangedAt = new Date();
    }

    const data: Prisma.UserProfileUncheckedCreateInput = {
      wallet,
      username: usernameChanged ? nextUsername ?? null : undefined,
      usernameNormalized: usernameChanged ? usernameNormalized ?? null : undefined,
      usernameChangedAt: usernameChanged ? usernameChangedAt ?? null : undefined,
      bio: this.nullableTrim(dto.bio),
      xHandle: this.nullableTrim(dto.xHandle),
      telegramHandle: this.nullableTrim(dto.telegramHandle),
      discordHandle: this.nullableTrim(dto.discordHandle),
      website: this.nullableTrim(dto.website),
      avatarUrl: this.nullableTrim(dto.avatarUrl),
      bannerUrl: this.nullableTrim(dto.bannerUrl),
    };

    const profile = await this.db.userProfile.upsert({
      where: { wallet },
      create: {
        wallet,
        username: data.username ?? null,
        usernameNormalized: data.usernameNormalized ?? null,
        usernameChangedAt: data.usernameChangedAt ?? null,
        bio: data.bio ?? null,
        xHandle: data.xHandle ?? null,
        telegramHandle: data.telegramHandle ?? null,
        discordHandle: data.discordHandle ?? null,
        website: data.website ?? null,
        avatarUrl: data.avatarUrl ?? null,
        bannerUrl: data.bannerUrl ?? null,
      },
      update: {
        ...(data.username !== undefined ? { username: data.username } : {}),
        ...(data.usernameNormalized !== undefined
          ? { usernameNormalized: data.usernameNormalized }
          : {}),
        ...(data.usernameChangedAt !== undefined
          ? { usernameChangedAt: data.usernameChangedAt }
          : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.xHandle !== undefined ? { xHandle: data.xHandle } : {}),
        ...(data.telegramHandle !== undefined
          ? { telegramHandle: data.telegramHandle }
          : {}),
        ...(data.discordHandle !== undefined
          ? { discordHandle: data.discordHandle }
          : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.bannerUrl !== undefined ? { bannerUrl: data.bannerUrl } : {}),
      },
    });

    return {
      wallet: profile.wallet,
      username: profile.username,
      bio: profile.bio,
      xHandle: profile.xHandle,
      telegramHandle: profile.telegramHandle,
      discordHandle: profile.discordHandle,
      website: profile.website,
      avatarUrl: profile.avatarUrl,
      bannerUrl: profile.bannerUrl,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private async buildHoverMap(wallets: string[]) {
    if (wallets.length === 0) {
      return new Map<string, ProfileHoverPayload>();
    }

    const uniqueWallets = Array.from(new Set(wallets));
    const [profiles, miners, motherlodeCounts, rankRows] = await Promise.all([
      this.db.userProfile.findMany({
        where: { wallet: { in: uniqueWallets } },
        select: {
          wallet: true,
          username: true,
          avatarUrl: true,
        },
      }),
      this.db.miner.findMany({
        where: { wallet: { in: uniqueWallets } },
        select: {
          wallet: true,
          lifetimeDeployed: true,
          roundsPlayed: true,
        },
      }),
      this.db.reward.groupBy({
        by: ['wallet'],
        where: {
          wallet: { in: uniqueWallets },
          isMotherlode: true,
        },
        _count: { _all: true },
      }),
      this.db.$queryRaw<Array<{ wallet: string; rank: number }>>(
        Prisma.sql`
          SELECT
            a.wallet AS wallet,
            (COUNT(b.wallet) + 1)::int AS rank
          FROM miners a
          LEFT JOIN miners b
            ON b.lifetime_rewards_sol > a.lifetime_rewards_sol
          WHERE a.wallet IN (${Prisma.join(uniqueWallets)})
          GROUP BY a.wallet
        `,
      ),
    ]);

    const profileByWallet = new Map(profiles.map((entry) => [entry.wallet, entry]));
    const minerByWallet = new Map(miners.map((entry) => [entry.wallet, entry]));
    const motherlodeByWallet = new Map(
      motherlodeCounts.map((entry) => [entry.wallet, entry._count._all]),
    );
    const rankByWallet = new Map(
      rankRows.map((entry) => [entry.wallet, Number(entry.rank)]),
    );
    const result = new Map<string, ProfileHoverPayload>();

    for (const wallet of uniqueWallets) {
      const profile = profileByWallet.get(wallet);
      const miner = minerByWallet.get(wallet);
      result.set(wallet, {
        username: profile?.username ?? null,
        walletAddress: wallet,
        avatarColor: this.avatarColorForWallet(wallet),
        avatarImage: profile?.avatarUrl ?? null,
        rank: rankByWallet.get(wallet) ?? null,
        deployedSol: this.toSol(miner?.lifetimeDeployed ?? 0n),
        roundsPlayed: miner?.roundsPlayed ?? 0,
        motherlodeHits: motherlodeByWallet.get(wallet) ?? 0,
      });
    }

    return result;
  }

  private emptyHover(wallet: string): ProfileHoverPayload {
    return {
      username: null,
      walletAddress: wallet,
      avatarColor: this.avatarColorForWallet(wallet),
      avatarImage: null,
      rank: null,
      deployedSol: 0,
      roundsPlayed: 0,
      motherlodeHits: 0,
    };
  }

  private async buildPublicProfile(wallet: string) {
    const [profile, miner, motherlodeHits, totalSpent, totalWon, recentRounds] =
      await Promise.all([
        this.db.userProfile.findUnique({ where: { wallet } }),
        this.db.miner.findUnique({ where: { wallet } }),
        this.db.reward.count({ where: { wallet, isMotherlode: true } }),
        this.db.deployment.aggregate({
          where: { wallet },
          _sum: { amount: true },
        }),
        this.db.reward.aggregate({
          where: { wallet },
          _sum: { solAmount: true },
        }),
        this.buildRecentRounds(wallet),
      ]);

    const rank =
      miner === null
        ? null
        : (await this.db.miner.count({
            where: { lifetimeRewardsSol: { gt: miner.lifetimeRewardsSol } },
          })) + 1;
    const roundsPlayed = miner?.roundsPlayed ?? 0;
    const roundsWon = miner?.roundsWon ?? 0;
    const roundsLost = Math.max(0, roundsPlayed - roundsWon);
    const totalSolSpent = this.toSol(totalSpent._sum.amount ?? 0n);
    const totalSolWon = this.toSol(totalWon._sum.solAmount ?? 0n);
    const avatarColor = this.avatarColorForWallet(wallet);

    return {
      wallet,
      identity: {
        walletAddress: wallet,
        username: profile?.username ?? null,
        displayName: profile?.username?.trim() || this.shortWallet(wallet),
        avatarUrl: profile?.avatarUrl ?? null,
        bannerUrl: profile?.bannerUrl ?? null,
        avatarColor,
        rank,
      },
      socials: {
        bio: profile?.bio ?? null,
        xHandle: profile?.xHandle ?? null,
        telegramHandle: profile?.telegramHandle ?? null,
        discordHandle: profile?.discordHandle ?? null,
        website: profile?.website ?? null,
      },
      stats: {
        roundsPlayed,
        roundsWon,
        roundsLost,
        motherlodeHits,
        totalSolDeployed: this.toSol(miner?.lifetimeDeployed ?? 0n),
        totalSolWon: this.toSol(miner?.lifetimeRewardsSol ?? 0n),
        winRate: roundsPlayed > 0 ? (roundsWon / roundsPlayed) * 100 : 0,
      },
      miningHistory: {
        totalSolSpent,
        totalSolWon,
        netPnl: totalSolWon - totalSolSpent,
        recentRounds,
        streaks: this.computeStreaks(
          recentRounds.map((entry) => entry.result),
        ),
      },
      hover: {
        username: profile?.username ?? null,
        walletAddress: wallet,
        avatarColor,
        avatarImage: profile?.avatarUrl ?? null,
        rank,
        deployedSol: this.toSol(miner?.lifetimeDeployed ?? 0n),
        roundsPlayed,
        motherlodeHits,
      },
      updatedAt: profile?.updatedAt?.toISOString() ?? null,
    };
  }

  private async buildRecentRounds(wallet: string) {
    const deployments = await this.db.deployment.findMany({
      where: { wallet },
      include: {
        round: {
          select: {
            isSplitReward: true,
            totalMiners: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    const byRound = new Map<
      number,
      {
        round: number;
        createdAt: Date;
        solSpent: bigint;
        block: number;
        mode: 'shared' | 'solo';
        miners: number;
      }
    >();

    for (const deployment of deployments) {
      const existing = byRound.get(deployment.roundId);
      if (existing) {
        existing.solSpent += deployment.amount;
        continue;
      }
      byRound.set(deployment.roundId, {
        round: deployment.roundId,
        createdAt: deployment.createdAt,
        solSpent: deployment.amount,
        block: this.extractBlockNumber(deployment.squares),
        mode: deployment.round?.isSplitReward ? 'shared' : 'solo',
        miners: deployment.round?.totalMiners ?? 0,
      });
    }

    const roundIds = Array.from(byRound.keys());
    if (roundIds.length === 0) return [];
    const rewards = await this.db.reward.findMany({
      where: { wallet, roundId: { in: roundIds } },
      select: {
        roundId: true,
        solAmount: true,
      },
    });
    const rewardMap = new Map(rewards.map((reward) => [reward.roundId, reward]));

    return Array.from(byRound.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 12)
      .map((round) => {
        const reward = rewardMap.get(round.round);
        return {
          round: round.round,
          result: reward && reward.solAmount > 0n ? ('win' as const) : ('loss' as const),
          solSpent: this.toSol(round.solSpent),
          solWon: this.toSol(reward?.solAmount ?? 0n),
          block: round.block,
          mode: round.mode,
          miners: round.miners,
          createdAt: round.createdAt.toISOString(),
        };
      });
  }

  private computeStreaks(results: Array<'win' | 'loss'>) {
    if (results.length === 0) {
      return {
        currentStreak: 0,
        bestWinStreak: 0,
        bestLossStreak: 0,
      };
    }

    let currentStreak = 1;
    const first = results[0];
    for (let index = 1; index < results.length; index += 1) {
      if (results[index] !== first) break;
      currentStreak += 1;
    }

    let bestWinStreak = 0;
    let bestLossStreak = 0;
    let runningType: 'win' | 'loss' | null = null;
    let runningCount = 0;
    for (const result of results) {
      if (result === runningType) {
        runningCount += 1;
      } else {
        runningType = result;
        runningCount = 1;
      }
      if (result === 'win') {
        bestWinStreak = Math.max(bestWinStreak, runningCount);
      } else {
        bestLossStreak = Math.max(bestLossStreak, runningCount);
      }
    }

    return {
      currentStreak: first === 'win' ? currentStreak : -currentStreak,
      bestWinStreak,
      bestLossStreak,
    };
  }

  private extractBlockNumber(squares: Prisma.JsonValue): number {
    if (!Array.isArray(squares) || squares.length === 0) return 1;
    const first = Number(squares[0]);
    if (!Number.isFinite(first)) return 1;
    if (first >= 1 && first <= 25) return first;
    if (first >= 0 && first <= 24) return first + 1;
    return 1;
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private shortWallet(wallet: string): string {
    if (wallet.length <= 10) return wallet;
    return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  }

  private toSol(value: bigint): number {
    return Number(value) / SOL_LAMPORTS;
  }

  private avatarColorForWallet(wallet: string): string {
    const digest = createHash('sha256').update(wallet).digest();
    return AVATAR_COLORS[digest[0] % AVATAR_COLORS.length];
  }

  private nullableTrim(value: string | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private profileError(code: string, message: string): HttpException {
    return new HttpException({ code, message }, HttpStatus.BAD_REQUEST);
  }
}
