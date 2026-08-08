import { describe, expect, it } from "bun:test";
import {
  buildEliminationOrder,
  buildEliminationSchedule,
  buildRoundResultFromSnapshot,
  computeHiddenBlocks,
} from "./round-resolution";

describe("round-resolution", () => {
  it("builds deterministic elimination order per round+tx", () => {
    const a = buildEliminationOrder(44, "5abc", 9);
    const b = buildEliminationOrder(44, "5abc", 9);
    const c = buildEliminationOrder(44, "6def", 9);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a) === JSON.stringify(c)).toBe(false);
    expect(a.includes(9)).toBe(false);
    expect(a.length).toBe(24);
  });

  it("builds accelerating schedule and hidden sets", () => {
    const order = buildEliminationOrder(20, "txhash", 4);
    const schedule = buildEliminationSchedule(order, 5_500);

    expect(schedule.length).toBe(24);
    expect(schedule[0].atMs > 0).toBe(true);
    expect(schedule[schedule.length - 1].atMs).toBe(5_500);

    const firstDelta = schedule[0].atMs;
    const lastDelta =
      schedule[schedule.length - 1].atMs - schedule[schedule.length - 2].atMs;
    expect(firstDelta > lastDelta).toBe(true);

    const halfHidden = computeHiddenBlocks(schedule, 2_750);
    expect(halfHidden.length > 0).toBe(true);
    expect(halfHidden.length < 24).toBe(true);

    const fullHidden = computeHiddenBlocks(schedule, 5_500);
    expect(fullHidden.length).toBe(24);
    expect(fullHidden.includes(4)).toBe(false);
  });

  it("builds deterministic round result from deployment snapshot", () => {
    const result = buildRoundResultFromSnapshot({
      winningBlock: 7,
      resolutionTxHash: "sig123",
      totalWinningsLamports: "3000000000",
      deployments: [
        {
          wallet: "walletA111111111111111111111111111111",
          amount: "2000000000",
          squares: [7],
        },
        {
          wallet: "walletB111111111111111111111111111111",
          amount: "1000000000",
          squares: [7, 8],
        },
        {
          wallet: "walletC111111111111111111111111111111",
          amount: "1000000000",
          squares: [8],
        },
      ],
    });

    expect(result.mode).toBe("split");
    expect(result.winningBlockId).toBe(7);
    expect(result.resolutionTxHash).toBe("sig123");
    expect(result.winners.length).toBe(2);
    expect(
      Math.abs((result.winners[0]?.solReward ?? 0) - 2.4) < 0.0000001,
    ).toBe(true);
    expect(
      Math.abs((result.winners[1]?.solReward ?? 0) - 0.6) < 0.0000001,
    ).toBe(true);
    expect(Math.abs(result.totalSolPool - 3) < 0.0000001).toBe(true);
  });

  it("falls back to top miner when no winning deployments are available", () => {
    const result = buildRoundResultFromSnapshot({
      winningBlock: 1,
      resolutionTxHash: "sig999",
      deployments: [],
      totalWinningsLamports: "500000000",
      fallbackTopMiner: "52aJZ9CmjMzsTdECEYZyqUWXCVBB8LtgLa37sZ6Ej1Gq",
    });

    expect(result.winners.length).toBe(1);
    expect(result.mode).toBe("solo");
    expect(result.winners[0]?.contribution).toBe(100);
    expect(Math.abs(result.totalSolPool - 0.5) < 0.0000001).toBe(true);
  });

  it("handles a serialized public key object without losing the winner event", () => {
    const result = buildRoundResultFromSnapshot({
      winningBlock: 11,
      resolutionTxHash: "round-one-resolution",
      deployments: [
        {
          wallet: "Gk8m1GyRmWtkeUZCsspH7DjJnUiw4uR9jXJrbhYqpbiN",
          amount: "12000000",
          squares: [2, 3, 7, 8, 21, 22],
        },
        {
          wallet: "HuqrNbYtdcoRRgaLX99EYVr6B2SVhngBkkmUiqmMu7J4",
          amount: "30000000",
          squares: [13, 14, 15],
        },
      ],
      totalWinningsLamports: "0",
      fallbackTopMiner: { _bn: { words: [0] } },
    });

    expect(result.winningBlockId).toBe(11);
    expect(result.winners.length).toBe(0);
    expect(result.totalSolPool).toBe(0);
  });

  it("does not present the default public key as a winner", () => {
    const result = buildRoundResultFromSnapshot({
      winningBlock: 11,
      resolutionTxHash: "round-one-resolution",
      deployments: [],
      fallbackTopMiner: "11111111111111111111111111111111",
    });

    expect(result.winners.length).toBe(0);
  });
});
