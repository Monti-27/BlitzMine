import { describe, expect, it } from "bun:test";
import {
  buildDissolveSchedule,
  buildSeed,
  computeBlockDimLevel,
} from "./round-dissolve";

describe("round-dissolve", () => {
  it("builds deterministic schedules for same seed", () => {
    const seed = buildSeed(72, "abc123");
    const blockIds = Array.from({ length: 25 }, (_, index) => index + 1);
    const a = buildDissolveSchedule({
      blockIds,
      winningBlock: 8,
      durationMs: 5_800,
      seed,
    });
    const b = buildDissolveSchedule({
      blockIds,
      winningBlock: 8,
      durationMs: 5_800,
      seed,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.some((step) => step.blockId === 8)).toBe(false);
  });

  it("keeps schedule monotonic and bounded", () => {
    const schedule = buildDissolveSchedule({
      blockIds: Array.from({ length: 25 }, (_, index) => index + 1),
      winningBlock: 4,
      durationMs: 5_800,
      seed: buildSeed(80, "sig"),
    });

    expect(schedule.length).toBe(24);
    let last = -1;
    for (const step of schedule) {
      expect(step.atMs >= last).toBe(true);
      last = step.atMs;
    }
    expect((schedule[0]?.atMs ?? 0) >= 0).toBe(true);
    expect((schedule[schedule.length - 1]?.atMs ?? 0) <= 5_800).toBe(true);
  });

  it("includes all blocks in blind dissolve mode", () => {
    const schedule = buildDissolveSchedule({
      blockIds: Array.from({ length: 25 }, (_, index) => index + 1),
      winningBlock: -1,
      durationMs: 5_800,
      seed: buildSeed(99, "pending"),
    });

    expect(schedule.length).toBe(25);
    const unique = new Set(schedule.map((step) => step.blockId));
    expect(unique.size).toBe(25);
  });

  it("computes stable dim levels without per-frame randomness", () => {
    const schedule = buildDissolveSchedule({
      blockIds: Array.from({ length: 25 }, (_, index) => index + 1),
      winningBlock: 10,
      durationMs: 5_800,
      seed: buildSeed(88, "pending"),
    });
    const a = computeBlockDimLevel({
      elapsedMs: 2_000,
      schedule,
      preserveBlockIds: [10],
    });
    const b = computeBlockDimLevel({
      elapsedMs: 2_000,
      schedule,
      preserveBlockIds: [10],
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a[10] === undefined).toBe(true);
  });
});
