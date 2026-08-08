const TOTAL_BLOCKS = 25;
const DEFAULT_DISSOLVE_DURATION_MS = 5_000;
const DEFAULT_DIM_FADE_MS = 700;
const DEFAULT_MAX_DIM = 0.92;

export type RoundPhase =
  | "ACTIVE"
  | "ZERO_BUFFER"
  | "DISSOLVING"
  | "WINNER_FOCUS";

export type DissolveScheduleStep = {
  blockId: number;
  atMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

export function buildSeed(roundId: number, resolutionTxHash: string | "pending"): string {
  return `${roundId}:${resolutionTxHash || "pending"}`;
}

/**
 * Convert a 1-indexed block ID to (row, col) on a 5x5 grid.
 */
function blockToRowCol(blockId: number): [number, number] {
  const idx = blockId - 1;
  return [Math.floor(idx / 5), idx % 5];
}

/**
 * Manhattan distance between two blocks on a 5x5 grid.
 */
function gridDistance(a: number, b: number): number {
  const [ar, ac] = blockToRowCol(a);
  const [br, bc] = blockToRowCol(b);
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

/**
 * Build dissolve order so that tiles NEAREST to the winner dim LAST.
 * This creates the visual effect of the grid "closing in" on the winner —
 * far tiles dim first, nearby tiles dim last, winner never dims.
 * A small random jitter is added within each distance group for natural feel.
 */
export function buildDissolveOrder(
  blockIds: number[],
  seed: string,
  winningBlock?: number,
): number[] {
  const unique = Array.from(
    new Set(
      blockIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= TOTAL_BLOCKS),
    ),
  );

  const random = mulberry32(hashStringToSeed(seed));

  if (winningBlock !== undefined && winningBlock >= 1 && winningBlock <= TOTAL_BLOCKS) {
    // Sort by distance from winner (farthest first), with random jitter within groups
    const withDistance = unique.map((blockId) => ({
      blockId,
      distance: gridDistance(blockId, winningBlock),
      jitter: random(),
    }));

    // Sort: farthest from winner first, random within same distance
    withDistance.sort((a, b) => {
      if (b.distance !== a.distance) return b.distance - a.distance;
      return a.jitter - b.jitter;
    });

    return withDistance.map((item) => item.blockId);
  }

  // Fallback: random shuffle (no winner known)
  const next = [...unique];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

export function buildDissolveSchedule(input: {
  blockIds: number[];
  winningBlock: number;
  durationMs?: number;
  seed: string;
}): DissolveScheduleStep[] {
  const safeDurationMs = Math.max(1_000, Math.trunc(input.durationMs ?? DEFAULT_DISSOLVE_DURATION_MS));
  const nonWinnerBlocks = input.blockIds.filter((blockId) => blockId !== input.winningBlock);
  const order = buildDissolveOrder(nonWinnerBlocks, input.seed, input.winningBlock);
  const lastIndex = Math.max(1, order.length - 1);

  // Reserve the last 20% of duration for the final tiles to complete their fade.
  // Without this, the last 1-2 tiles near the winner never fully dim because
  // their fade starts too late and the dissolve duration runs out.
  const scheduleWindowMs = safeDurationMs * 0.78;

  return order.map((blockId, index) => {
    const progress = order.length <= 1 ? 1 : index / lastIndex;
    // Slow start, faster finish — tiles near the winner dim last.
    const eased = Math.pow(progress, 1.7);
    const atMs = Math.round(clamp(eased * scheduleWindowMs, 0, scheduleWindowMs));
    return { blockId, atMs };
  });
}

export function computeBlockDimLevel(input: {
  elapsedMs: number;
  schedule: DissolveScheduleStep[];
  fadeMs?: number;
  maxDim?: number;
  preserveBlockIds?: number[];
}): Record<number, number> {
  const safeElapsedMs = Math.max(0, Math.trunc(input.elapsedMs));
  const fadeMs = Math.max(120, Math.trunc(input.fadeMs ?? DEFAULT_DIM_FADE_MS));
  const maxDim = clamp(input.maxDim ?? DEFAULT_MAX_DIM, 0, 0.98);
  const preserveSet = new Set(input.preserveBlockIds ?? []);

  const dim: Record<number, number> = {};
  for (const step of input.schedule) {
    if (preserveSet.has(step.blockId)) {
      dim[step.blockId] = 0;
      continue;
    }
    const local = clamp((safeElapsedMs - step.atMs) / fadeMs, 0, 1);
    dim[step.blockId] = clamp(local * maxDim, 0, maxDim);
  }
  return dim;
}
