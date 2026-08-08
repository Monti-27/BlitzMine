"use client";

import type { RoundPhase } from "@/lib/round-dissolve";
import type { Block } from "@/types/mining";
import { GridBlock } from "./grid-block";

interface MiningGridProps {
  blocks: Block[];
  selectedBlocks: number[];
  lockedBlocks: number[];
  pendingBlocks: number[];
  roundPhase: RoundPhase;
  dissolveProgressByBlock: Record<number, number>;
  resolutionWinningBlock: number | null;
  isCinematicLocked: boolean;
  isWinnerRevealed: boolean;
  onBlockSelect: (blockId: number) => void;
}

export function MiningGrid({
  blocks,
  selectedBlocks,
  lockedBlocks,
  pendingBlocks,
  roundPhase,
  dissolveProgressByBlock,
  resolutionWinningBlock,
  isCinematicLocked,
  isWinnerRevealed,
  onBlockSelect,
}: MiningGridProps) {
  return (
    <div className="grid grid-cols-5 gap-[6px] w-full">
      {blocks.map((block) => (
        <GridBlock
          key={block.id}
          block={block}
          isSelected={selectedBlocks.includes(block.id)}
          isLocked={lockedBlocks.includes(block.id)}
          isPending={pendingBlocks.includes(block.id)}
          roundPhase={roundPhase}
          dissolveDimLevel={dissolveProgressByBlock[block.id] ?? 0}
          resolutionWinningBlock={resolutionWinningBlock}
          isCinematicLocked={isCinematicLocked}
          isWinnerRevealed={isWinnerRevealed}
          onClick={() => onBlockSelect(block.id)}
        />
      ))}
    </div>
  );
}
