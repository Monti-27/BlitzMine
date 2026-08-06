export interface RealtimeDeployPayload {
  roundId: number;
  wallet: string;
  squares: number[];
  amountLamports: string;
  txHash: string;
  source: string;
  slot: string | null;
  createdAt: string;
}

export function normalizeSquaresJson(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 25),
    ),
  ).sort((a, b) => a - b);
}

export function toRealtimeDeployPayload(deployment: {
  roundId: number;
  wallet: string;
  squares: unknown;
  amount: bigint;
  txHash: string | null;
  source: string;
  slot: bigint | null;
  createdAt: Date;
}): RealtimeDeployPayload {
  return {
    roundId: deployment.roundId,
    wallet: deployment.wallet,
    squares: normalizeSquaresJson(deployment.squares),
    amountLamports: deployment.amount.toString(),
    txHash: deployment.txHash ?? '',
    source: deployment.source,
    slot: deployment.slot ? deployment.slot.toString() : null,
    createdAt: deployment.createdAt.toISOString(),
  };
}
