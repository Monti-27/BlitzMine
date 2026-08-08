import type { RoundResult, RoundWinner } from "@/types/mining";

const TOTAL_BLOCKS = 25;
const DEFAULT_RESOLVE_DURATION_MS = 5_500;
const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";

export type RoundPhase =
  | "ACTIVE"
  | "ZERO_BUFFER"
  | "RESOLVING"
  | "WINNER_FOCUS"
  | "RESETTING";

export type ResolveMode = "awaiting_event" | "dissolving";

export type EliminationScheduleStep = {
  blockId: number;
  atMs: number;
};

export type DeploymentSnapshot = {
  wallet: string;
  amount: unknown;
  squares: unknown;
  txHash?: string | null;
};

export type BuildRoundResultInput = {
  winningBlock: number;
  resolutionTxHash: string;
  deployments: DeploymentSnapshot[];
  totalWinningsLamports?: unknown;
  fallbackTopMiner?: unknown;
};

function lamportsToSolValue(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

function shortenWallet(wallet: string, chars = 4): string {
  return `${wallet.slice(0, chars)}...${wallet.slice(-chars)}`;
}

function normalizeLamports(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.trunc(value)));
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = BigInt(value.trim());
      return parsed < BigInt(0) ? BigInt(0) : parsed;
    } catch {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) {
        return BigInt(Math.max(0, Math.trunc(asNumber)));
      }
    }
  }
  return BigInt(0);
}

function normalizeSquares(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map((value) => Number(value))
    .filter(
      (value) => Number.isInteger(value) && value >= 0 && value <= TOTAL_BLOCKS,
    )
    .map((value) => (value === 0 ? 1 : value));
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWalletKey(wallet: string): string {
  return wallet.trim();
}

function normalizeFallbackTopMiner(value: unknown): string {
  let normalized = "";
  if (typeof value === "string") {
    normalized = value.trim();
  } else if (
    value &&
    typeof value === "object" &&
    "toBase58" in value &&
    typeof value.toBase58 === "function"
  ) {
    normalized = value.toBase58().trim();
  }
  return normalized === DEFAULT_PUBLIC_KEY ? "" : normalized;
}

function allocateProportional(
  poolLamports: bigint,
  contributions: Array<{ wallet: string; lamports: bigint }>,
): Map<string, bigint> {
  const allocation = new Map<string, bigint>();
  if (poolLamports <= BigInt(0) || contributions.length === 0) {
    for (const entry of contributions) {
      allocation.set(entry.wallet, BigInt(0));
    }
    return allocation;
  }

  const totalContribution = contributions.reduce(
    (sum, entry) => sum + entry.lamports,
    BigInt(0),
  );
  if (totalContribution <= BigInt(0)) {
    const equal = poolLamports / BigInt(contributions.length);
    let remainder = poolLamports - equal * BigInt(contributions.length);
    for (const entry of contributions) {
      const extra = remainder > BigInt(0) ? BigInt(1) : BigInt(0);
      allocation.set(entry.wallet, equal + extra);
      if (remainder > BigInt(0)) remainder -= BigInt(1);
    }
    return allocation;
  }

  let distributed = BigInt(0);
  for (const entry of contributions) {
    const share = (poolLamports * entry.lamports) / totalContribution;
    allocation.set(entry.wallet, share);
    distributed += share;
  }

  let remainder = poolLamports - distributed;
  for (const entry of contributions) {
    if (remainder <= BigInt(0)) break;
    allocation.set(
      entry.wallet,
      (allocation.get(entry.wallet) ?? BigInt(0)) + BigInt(1),
    );
    remainder -= BigInt(1);
  }

  return allocation;
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = [...items];
  const random = mulberry32(seed);

  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }

  return next;
}

export function buildEliminationOrder(
  roundId: number,
  resolutionTxHash: string,
  winningBlock: number,
): number[] {
  const seed = hashStringToSeed(`${roundId}:${resolutionTxHash}`);
  const candidates = Array.from(
    { length: TOTAL_BLOCKS },
    (_, index) => index + 1,
  ).filter((blockId) => blockId !== winningBlock);
  return seededShuffle(candidates, seed);
}

export function buildEliminationSchedule(
  order: readonly number[],
  durationMs = DEFAULT_RESOLVE_DURATION_MS,
): EliminationScheduleStep[] {
  if (order.length === 0) return [];
  const safeDuration = Math.max(1000, Math.trunc(durationMs));
  const groups: number[][] = [];
  for (let index = 0; index < order.length; ) {
    const progress = order.length <= 1 ? 1 : index / (order.length - 1);
    const batchSize = progress >= 0.78 ? 2 : 1;
    groups.push(order.slice(index, Math.min(order.length, index + batchSize)));
    index += batchSize;
  }

  const intervals = groups.map((_, index) => {
    const progress = groups.length <= 1 ? 1 : index / (groups.length - 1);
    return 360 - progress * 250;
  });

  const rawTotal = intervals.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? safeDuration / rawTotal : 1;

  const steps: EliminationScheduleStep[] = [];
  let elapsed = 0;
  for (let index = 0; index < groups.length; index += 1) {
    elapsed += intervals[index] * scale;
    const atMs = Math.min(safeDuration, Math.round(elapsed));
    for (const blockId of groups[index]) {
      steps.push({ blockId, atMs });
    }
  }

  return steps;
}

export function computeHiddenBlocks(
  schedule: readonly EliminationScheduleStep[],
  elapsedMs: number,
): number[] {
  if (schedule.length === 0) return [];
  const safeElapsed = Math.max(0, Math.trunc(elapsedMs));
  return schedule
    .filter((step) => step.atMs <= safeElapsed)
    .map((step) => step.blockId)
    .sort((a, b) => a - b);
}

export function buildRoundResultFromSnapshot(
  input: BuildRoundResultInput,
): RoundResult {
  const winningBlock = Math.max(
    1,
    Math.min(TOTAL_BLOCKS, Math.trunc(input.winningBlock)),
  );
  const contributions = new Map<string, bigint>();

  for (const deployment of input.deployments) {
    const wallet = buildWalletKey(deployment.wallet);
    if (!wallet) continue;
    const squares = normalizeSquares(deployment.squares);
    if (!squares.includes(winningBlock)) continue;

    const totalAmountLamports = normalizeLamports(deployment.amount);
    if (totalAmountLamports <= BigInt(0) || squares.length === 0) continue;
    const amountLamports = totalAmountLamports / BigInt(squares.length);
    if (amountLamports <= BigInt(0)) continue;

    contributions.set(
      wallet,
      (contributions.get(wallet) ?? BigInt(0)) + amountLamports,
    );
  }

  const sortedContributions = Array.from(contributions.entries())
    .map(([wallet, lamports]) => ({ wallet, lamports }))
    .sort((a, b) => {
      if (a.lamports === b.lamports) {
        return a.wallet.localeCompare(b.wallet);
      }
      return a.lamports > b.lamports ? -1 : 1;
    });

  const totalContributionLamports = sortedContributions.reduce(
    (sum, entry) => sum + entry.lamports,
    BigInt(0),
  );

  const configuredPoolLamports = normalizeLamports(input.totalWinningsLamports);
  const totalPoolLamports =
    configuredPoolLamports > BigInt(0)
      ? configuredPoolLamports
      : totalContributionLamports;

  const rewardsByWallet = allocateProportional(
    totalPoolLamports,
    sortedContributions,
  );

  let winners: RoundWinner[] = sortedContributions.map((entry) => {
    const contributionPct =
      totalContributionLamports > BigInt(0)
        ? Number(
            (entry.lamports * BigInt(10_000)) / totalContributionLamports,
          ) / 100
        : 0;

    return {
      minerId: entry.wallet,
      address: entry.wallet,
      name: shortenWallet(entry.wallet),
      avatar: "",
      color: "#9ca3af",
      solReward: lamportsToSolValue(
        rewardsByWallet.get(entry.wallet) ?? BigInt(0),
      ),
      contribution: contributionPct,
    };
  });

  const fallbackTopMiner = normalizeFallbackTopMiner(input.fallbackTopMiner);
  if (winners.length === 0 && fallbackTopMiner) {
    const topMiner = fallbackTopMiner;
    winners = [
      {
        minerId: topMiner,
        address: topMiner,
        name: shortenWallet(topMiner),
        avatar: "",
        color: "#9ca3af",
        solReward: lamportsToSolValue(totalPoolLamports),
        contribution: 100,
      },
    ];
  }

  return {
    mode: winners.length > 1 ? "split" : "solo",
    winners,
    totalSolPool: lamportsToSolValue(totalPoolLamports),
    winningBlockId: winningBlock,
    resolutionTxHash: input.resolutionTxHash,
  };
}
