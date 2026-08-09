"use client";

import { Button } from "@/components/ui/button";

interface DeployFooterProps {
  lockedBlocks: number[];
  selectedBlocks: number[];
  minersCount: number;
  isPending?: boolean;
  isDeployBlockedByRuntime?: boolean;
  onDeploy: () => void;
}

export function DeployFooter({
  lockedBlocks,
  selectedBlocks,
  minersCount,
  isPending = false,
  isDeployBlockedByRuntime = false,
  onDeploy,
}: DeployFooterProps) {
  const isDisabled =
    selectedBlocks.length === 0 ||
    selectedBlocks.every((id) => lockedBlocks.includes(id));

  return (
    <>
      <Button
        onClick={onDeploy}
        disabled={isPending || isDeployBlockedByRuntime || isDisabled}
        className="w-full h-11 text-sm font-semibold rounded-full bg-muted hover:bg-muted/80 text-muted-foreground border-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending
          ? "Processing..."
          : lockedBlocks.length > 0
            ? `Deployed (${lockedBlocks.length})`
            : "Deploy"}
      </Button>

      <div className="text-center text-[10px] text-muted-foreground py-1">
        {minersCount} miners deployed
      </div>
    </>
  );
}
