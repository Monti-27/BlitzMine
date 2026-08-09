"use client";

import { ChevronDown, ChevronUp, Crown, Trophy, Users } from "lucide-react";
import type { RoundRowProps } from "../models/round-history.types";
import { RoundExpanded } from "./round-expanded";

export function RoundRow({ entry, isExpanded, onToggle }: RoundRowProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-card/60 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-muted-foreground">
            #{entry.roundNumber}
          </span>
          <div className="flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-mono text-foreground">
              Block #{entry.result.winningBlockId}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {entry.result.mode === "solo" ? (
              <Crown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground capitalize">
              {entry.result.mode}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <img src="/solana-logo.svg" alt="SOL" className="w-3 h-3" />
            <span className="text-xs font-mono text-muted-foreground">
              {entry.result.totalSolPool.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span className="font-mono">
              {entry.result.winners.length}{" "}
              {entry.result.winners.length === 1 ? "winner" : "winners"}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && <RoundExpanded entry={entry} />}
    </div>
  );
}
