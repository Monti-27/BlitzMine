import { describe, expect, it } from "bun:test";
import {
  getCashOutSettlementState,
  getPendingSettlementKind,
} from "./cash-out-state";
import type { RecentRoundSummary } from "./types";

const round = (overrides: Partial<RecentRoundSummary>): RecentRoundSummary => ({
  id: 6,
  totalDeployed: "250000000",
  totalMiners: 2,
  totalWinnings: "213840000",
  winningSquare: 8,
  topMiner: null,
  deployments: [],
  status: "completed",
  createdAt: "2026-08-04T00:00:00.000Z",
  ...overrides,
});

describe("cash-out settlement state", () => {
  it("marks a completed miner round as pending settlement", () => {
    expect(
      getCashOutSettlementState({
        checkpointId: BigInt(5),
        minerRoundId: BigInt(6),
        currentRoundId: 7,
      }),
    ).toBe("pending");
  });

  it("keeps an unresolved miner round locked", () => {
    expect(
      getCashOutSettlementState({
        checkpointId: BigInt(5),
        minerRoundId: BigInt(6),
        currentRoundId: 6,
      }),
    ).toBe("round-active");
  });

  it("marks an already checkpointed miner as settled", () => {
    expect(
      getCashOutSettlementState({
        checkpointId: BigInt(6),
        minerRoundId: BigInt(6),
        currentRoundId: 7,
      }),
    ).toBe("settled");
  });

  it("detects winnings from a one-based winning block", () => {
    expect(
      getPendingSettlementKind(
        round({
          deployments: [
            {
              wallet: "winner",
              squares: [9, 14],
              amount: "20000000",
              txHash: "signature",
            },
          ],
        }),
        "winner",
      ),
    ).toBe("winnings");
  });

  it("detects a canceled-round refund", () => {
    expect(
      getPendingSettlementKind(
        round({
          winningSquare: null,
          deployments: [
            {
              wallet: "refunded",
              squares: [4],
              amount: "10000000",
              txHash: "signature",
            },
          ],
        }),
        "refunded",
      ),
    ).toBe("refund");
  });

  it("does not promise a payout to a losing miner", () => {
    expect(
      getPendingSettlementKind(
        round({
          deployments: [
            {
              wallet: "loser",
              squares: [4],
              amount: "10000000",
              txHash: "signature",
            },
          ],
        }),
        "loser",
      ),
    ).toBe("none");
  });

  it("keeps the settlement action available while history is loading", () => {
    expect(getPendingSettlementKind(null, "winner")).toBe("unknown");
  });

  it("does not call an unresolved round a refund", () => {
    expect(
      getPendingSettlementKind(
        round({
          winningSquare: null,
          status: "active",
          deployments: [
            {
              wallet: "miner",
              squares: [4],
              amount: "10000000",
              txHash: "signature",
            },
          ],
        }),
        "miner",
      ),
    ).toBe("unknown");
  });
});
