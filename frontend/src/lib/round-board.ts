import type { Block } from "@/types/mining";

export function selectRoundDisplayBlocks(
  liveBlocks: Block[],
  resolutionBlocks: Block[] | null,
  isCinematic: boolean,
): Block[] {
  if (isCinematic && resolutionBlocks !== null) {
    return resolutionBlocks;
  }
  return liveBlocks;
}
