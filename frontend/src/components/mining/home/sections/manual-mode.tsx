"use client";

import { formatSol } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ManualModeProps {
  selectedBlocks: number[];
  totalCost: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function ManualMode({
  selectedBlocks,
  totalCost,
  onSelectAll,
  onClearSelection,
}: ManualModeProps) {
  return (
    <>
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs text-muted-foreground">Blocks</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              selectedBlocks.length === 25 ? onClearSelection() : onSelectAll()
            }
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-all",
              selectedBlocks.length === 25
                ? "bg-muted text-foreground"
                : "bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            x{selectedBlocks.length}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="text-lg font-bold font-mono text-foreground">
          {formatSol(totalCost, 9, 0)} SOL
        </span>
      </div>
    </>
  );
}
