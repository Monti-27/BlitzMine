"use client";

import { Check, ChevronDown, Copy, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GradientButton } from "@/components/ui/gradient-button";
import { useAuth } from "@/hooks/use-auth";

export function WalletCta() {
  const { ready, authenticated, wallet, login, logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked by permissions; the address stays visible to select.
    }
  }, [wallet]);

  if (!authenticated) {
    return (
      <GradientButton
        onClick={() => {
          if (ready) login();
        }}
        disabled={!ready}
        className="text-xs text-black h-10 min-w-0 px-5 py-0 rounded-xl font-mono font-bold disabled:opacity-100"
      >
        Connect Wallet
      </GradientButton>
    );
  }

  const walletDisplay =
    wallet && wallet.length > 12
      ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
      : "Wallet";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Wallet menu"
          className="group flex h-10 min-w-[128px] items-center gap-2 rounded-full border border-[#2A3151] bg-transparent px-4 font-mono text-sm font-semibold leading-none text-white/90 transition-colors hover:border-[#3B4670] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 data-[state=open]:border-[#3B4670] data-[state=open]:bg-white/[0.04]"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
          />
          <span className="flex-1 text-left">{walletDisplay}</span>
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200 group-hover:text-white/70 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-[264px] rounded-xl border-[#2A3151] bg-card/95 p-1.5 backdrop-blur-xl"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
            />
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Connected
            </span>
          </div>
          <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-foreground/80">
            {wallet}
          </p>
        </div>

        <DropdownMenuSeparator className="bg-border/60" />

        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleCopy();
          }}
          className="cursor-pointer gap-2 rounded-lg font-mono text-xs focus:bg-white/[0.06]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>

        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
          }}
          className="cursor-pointer gap-2 rounded-lg font-mono text-xs"
        >
          <LogOut className="h-3.5 w-3.5" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
