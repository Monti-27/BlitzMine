import type { DeployReadinessResponse, RoundAccount } from "@/lib/types";

type BoardState = RoundAccount["board"] | null | undefined;

export function isDeployBlockedByState(input: {
  cinematicLocked: boolean;
  readiness: DeployReadinessResponse | null;
  board: BoardState;
}): boolean {
  if (input.cinematicLocked) return true;
  if (input.readiness) {
    if (input.readiness.reason === "MINER_CHECKPOINT_REQUIRED") return false;
    return input.readiness.requiresCheckpoint || !input.readiness.canDeploy;
  }
  if (!input.board) return false;
  return (
    input.board.requiresCheckpoint === true || input.board.canDeploy === false
  );
}
