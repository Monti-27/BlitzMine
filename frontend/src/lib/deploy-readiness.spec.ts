import { describe, expect, it } from "bun:test";
import { isDeployBlockedByState } from "./deploy-readiness";

const ready = {
  canDeploy: true,
  requiresCheckpoint: false,
  reason: "READY" as const,
  roundId: 1,
  startSlot: 0,
  endSlot: null,
  currentSlot: 10,
};

describe("deploy readiness", () => {
  it("allows the returning player to start automatic checkpointing", () => {
    expect(
      isDeployBlockedByState({
        cinematicLocked: false,
        readiness: {
          ...ready,
          canDeploy: false,
          requiresCheckpoint: true,
          reason: "MINER_CHECKPOINT_REQUIRED",
        },
        board: null,
      }),
    ).toBe(false);
  });

  it("blocks deployment while the round itself is finalizing", () => {
    expect(
      isDeployBlockedByState({
        cinematicLocked: false,
        readiness: {
          ...ready,
          canDeploy: false,
          requiresCheckpoint: true,
          reason: "ROUND_FINALIZING",
        },
        board: null,
      }),
    ).toBe(true);
  });

  it("blocks deployment during the winner cinematic", () => {
    expect(
      isDeployBlockedByState({
        cinematicLocked: true,
        readiness: ready,
        board: null,
      }),
    ).toBe(true);
  });
});
