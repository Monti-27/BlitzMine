"use client";

import { ArrowUpRight, Crown, Trophy, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar as WalletAvatar } from "@/components/ui/wallet-avatar";
import { SOLANA_CLUSTER } from "@/lib/constants";
import { buildTransactionExplorerUrl } from "@/lib/explorer";
import { formatSol } from "@/lib/format";
import type { RoundResult } from "@/types/mining";

interface WinnerViewProps {
  roundResult: RoundResult;
  winnerCountdown: number;
  resolutionRpcUrl?: string | null;
}

export function WinnerView({
  roundResult,
  winnerCountdown,
  resolutionRpcUrl,
}: WinnerViewProps) {
  const verificationUrl = roundResult.resolutionTxHash
    ? buildTransactionExplorerUrl(
        roundResult.resolutionTxHash,
        SOLANA_CLUSTER,
        resolutionRpcUrl,
      )
    : null;

  return (
    <div className="w-full max-w-[480px] flex flex-col gap-3 max-h-full overflow-auto scrollbar-hide">
      <div className="rounded-lg bg-card/60 p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Trophy className="w-5 h-5 text-primary" />
          <span className="text-lg font-bold text-foreground">
            Block #{roundResult.winningBlockId} Wins!
          </span>
        </div>
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
          {roundResult.winners.length === 0 ? (
            <span className="font-semibold text-foreground">
              No miner hit this tile
            </span>
          ) : (
            <div className="flex items-center gap-1">
              {roundResult.mode === "solo" ? (
                <Crown className="w-4 h-4 text-primary" />
              ) : (
                <Users className="w-4 h-4 text-primary" />
              )}
              <span className="font-semibold text-foreground capitalize">
                {roundResult.mode}
              </span>
              <span>mode</span>
            </div>
          )}
          <span>•</span>
          <span>Next round in {winnerCountdown}s</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-card/60 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <img src="/solana-logo.svg" alt="SOL" className="w-4 h-4" />
            <span className="text-lg font-bold font-mono text-foreground">
              {formatSol(roundResult.totalSolPool, 9, 4)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">SOL prize pool</span>
        </div>
        {verificationUrl ? (
          <a
            href={verificationUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Verify the MagicBlock VRF resolution transaction"
            className="group rounded-lg bg-card/60 p-3 text-center transition-colors hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="mb-1 flex items-center justify-center gap-1 text-sm font-bold font-mono text-primary">
              Verify
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
            <span className="text-xs text-muted-foreground">
              MagicBlock VRF
            </span>
          </a>
        ) : (
          <div className="rounded-lg bg-card/60 p-3 text-center">
            <span className="mb-1 block text-sm font-bold font-mono text-muted-foreground">
              Pending
            </span>
            <span className="text-xs text-muted-foreground">
              MagicBlock VRF
            </span>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-card/60 overflow-hidden">
        <div className="px-4 py-2 border-b border-border/30">
          <span className="text-sm font-semibold text-foreground">
            {roundResult.winners.length}{" "}
            {roundResult.winners.length === 1 ? "Miner" : "Miners"} on Winning
            Tile
          </span>
        </div>
        <ScrollArea className="max-h-[50vh]">
          <div className="divide-y divide-border/20">
            {roundResult.winners.map((winner, i) => (
              <div
                key={winner.minerId}
                className="flex items-center justify-between px-4 py-2 hover:bg-card/40 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <WalletAvatar
                    walletAddress={
                      winner.address || winner.minerId || winner.name
                    }
                    avatarUrl={winner.avatar}
                    alt={winner.name}
                    size={24}
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground block truncate">
                      {winner.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {winner.contribution.toFixed(1)}% of tile
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0 ml-2">
                  <div className="flex items-center gap-1">
                    <img src="/solana-logo.svg" alt="SOL" className="w-3 h-3" />
                    <span className="text-xs font-mono text-foreground">
                      {formatSol(winner.solReward, 9, 4)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
