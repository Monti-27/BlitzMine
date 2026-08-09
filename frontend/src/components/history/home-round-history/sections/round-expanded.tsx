"use client";

import { Trophy } from "lucide-react";
import { Avatar as WalletAvatar } from "@/components/ui/wallet-avatar";
import { cn } from "@/lib/utils";
import type {
  ExpandedMinerState,
  RoundExpandedProps,
} from "../models/round-history.types";

export function RoundExpanded({ entry }: RoundExpandedProps) {
  const expandedMiners: ExpandedMinerState[] = entry.miners
    .filter((miner) =>
      miner.selectedTiles.includes(entry.result.winningBlockId),
    )
    .sort((a, b) => b.totalDeployed - a.totalDeployed)
    .map((miner) => {
      const winnerData = entry.result.winners.find(
        (winner) => winner.minerId === miner.minerId,
      );
      return {
        miner,
        isWinner: Boolean(winnerData),
        solReward: winnerData?.solReward ?? 0,
      };
    });

  return (
    <div className="bg-card/30 px-4 py-3 space-y-2">
      {expandedMiners.map(({ miner, isWinner, solReward }) => (
        <div
          key={miner.minerId}
          className={cn(
            "rounded-md px-3 py-2",
            isWinner ? "bg-primary/10 border border-primary/20" : "bg-card/20",
          )}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <WalletAvatar
                walletAddress={miner.address || miner.minerId || miner.name}
                avatarUrl={miner.avatar}
                alt={miner.name || miner.address}
                size={20}
              />
              <span className="text-sm font-mono text-foreground">
                {miner.name || miner.address}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                {miner.selectedTiles.length}{" "}
                {miner.selectedTiles.length === 1 ? "tile" : "tiles"}
              </span>
              {isWinner && <Trophy className="w-3 h-3 text-primary" />}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <img src="/solana-logo.svg" alt="SOL" className="w-3 h-3" />
                <span className="font-mono text-muted-foreground">
                  {miner.totalDeployed.toFixed(4)}
                </span>
              </div>
              {solReward > 0 && (
                <div className="flex items-center gap-1">
                  <img src="/solana-logo.svg" alt="SOL" className="w-3 h-3" />
                  <span className="font-mono text-primary font-semibold">
                    +{solReward.toFixed(4)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
