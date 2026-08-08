import type { RecentRoundSummary } from "@/lib/types";

export type CashOutSettlementState = "settled" | "pending" | "round-active";

export type PendingSettlementKind = "winnings" | "refund" | "none" | "unknown";

export function getCashOutSettlementState(input: {
  checkpointId: bigint;
  minerRoundId: bigint;
  currentRoundId: number | null;
}): CashOutSettlementState {
  if (input.checkpointId === input.minerRoundId) return "settled";
  if (
    input.currentRoundId !== null &&
    BigInt(input.currentRoundId) > input.minerRoundId
  ) {
    return "pending";
  }
  return "round-active";
}

export function getPendingSettlementKind(
  round: RecentRoundSummary | null,
  wallet: string,
): PendingSettlementKind {
  if (!round) return "unknown";
  const walletDeployments = round.deployments.filter(
    (deployment) => deployment.wallet === wallet,
  );
  if (walletDeployments.length === 0) return "none";
  if (round.winningSquare === null) {
    return round.status === "completed" ? "refund" : "unknown";
  }
  const winningBlock = round.winningSquare + 1;
  return walletDeployments.some((deployment) =>
    deployment.squares.includes(winningBlock),
  )
    ? "winnings"
    : "none";
}
