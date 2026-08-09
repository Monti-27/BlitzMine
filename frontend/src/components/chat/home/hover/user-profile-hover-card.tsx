"use client";

import { Check, Coins, Copy, Gem, Pickaxe, Trophy } from "lucide-react";
import { useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar } from "@/components/ui/wallet-avatar";
import type { UserProfileData } from "../models/home-chat.types";

interface UserProfileHoverCardProps {
  user: UserProfileData;
  children: React.ReactNode;
}

export function UserProfileHoverCard({
  user,
  children,
}: UserProfileHoverCardProps) {
  const [copied, setCopied] = useState(false);
  const displayName = user.username || user.walletAddress;
  const shortAddress = `${user.walletAddress.slice(0, 4)}..${user.walletAddress.slice(-4)}`;
  const isLoading = Boolean(user.loading);
  const isUnavailable = Boolean(user.unavailable);
  const showValueSkeleton = isLoading && !isUnavailable;

  const formatNumber = (
    value: number | undefined,
    options?: { fixed?: number; locale?: boolean },
  ) => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return "—";
    }
    if (options?.locale) {
      return value.toLocaleString();
    }
    if (typeof options?.fixed === "number") {
      return value.toFixed(options.fixed);
    }
    return String(value);
  };

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(user.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const metricRows = [
    {
      label: "Deployed",
      icon: Coins,
      value: formatNumber(user.deployedSol, { fixed: 2 }),
      skeletonWidth: 56,
    },
    {
      label: "Rounds",
      icon: Pickaxe,
      value: formatNumber(user.roundsPlayed, { locale: true }),
      skeletonWidth: 48,
    },
    {
      label: "Motherlodes",
      icon: Gem,
      value: formatNumber(user.motherlodeHits, { locale: true }),
      skeletonWidth: 48,
    },
    {
      label: "Rank",
      icon: Trophy,
      value: user.rank ? `#${user.rank}` : "—",
      skeletonWidth: 48,
    },
  ];

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        className="w-64 max-w-[calc(100vw-1rem)] p-0 bg-background border-border/80 backdrop-blur-md"
      >
        <div className="p-3.5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Avatar
              walletAddress={user.walletAddress || displayName}
              avatarUrl={user.avatarImage}
              alt={displayName}
              className="ring-2 ring-primary/40"
              size={40}
            />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-foreground truncate block leading-tight">
                {user.username || shortAddress}
              </span>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
              >
                <span className="font-mono">{shortAddress}</span>
                {copied ? (
                  <Check className="w-3 h-3 text-primary" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
          <div className="border-t border-border/40 pt-2 space-y-1.5">
            {metricRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 py-0.5"
              >
                <span className="text-sm text-muted-foreground">
                  {row.label}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <row.icon className="w-3.5 h-3.5 text-primary" />
                  {showValueSkeleton ? (
                    <span
                      className="skeleton h-3.5 rounded"
                      style={{ width: row.skeletonWidth }}
                    />
                  ) : (
                    <span className="font-mono text-sm font-medium text-foreground tabular-nums">
                      {row.value}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {isUnavailable && (
            <div className="pt-1 text-center text-[11px] text-muted-foreground">
              Profile unavailable
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
