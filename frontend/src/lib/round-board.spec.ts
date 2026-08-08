import { describe, expect, it } from "bun:test";
import { selectRoundDisplayBlocks } from "./round-board";

describe("selectRoundDisplayBlocks", () => {
  it("keeps the completed tile values while the next round is already live", () => {
    const nextRound = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      minerCount: 0,
      deployedAmount: 0,
    }));
    const completedRound = nextRound.map((block) =>
      block.id === 4
        ? { ...block, minerCount: 1, deployedAmount: 0.001 }
        : block,
    );

    const displayed = selectRoundDisplayBlocks(nextRound, completedRound, true);

    expect(displayed[3]?.id).toBe(4);
    expect(displayed[3]?.minerCount).toBe(1);
    expect(displayed[3]?.deployedAmount).toBe(0.001);
  });

  it("shows the live board after the cinematic ends", () => {
    const live = [{ id: 1, minerCount: 0, deployedAmount: 0 }];
    const completed = [{ id: 1, minerCount: 1, deployedAmount: 0.001 }];

    expect(selectRoundDisplayBlocks(live, completed, false)).toBe(live);
  });
});
