"use client";

import { SignOut, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { shortenAddress } from "@/lib/format";

export function WalletButton() {
  const { ready, authenticated, wallet, login, logout } = useAuth();

  if (!ready) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Wallet className="h-4 w-4" weight="bold" />
        Loading...
      </Button>
    );
  }

  if (!authenticated) {
    return (
      <Button
        onClick={login}
        size="sm"
        className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Wallet className="h-4 w-4" weight="bold" />
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span className="text-sm font-mono tabular-nums text-foreground">
          {wallet ? shortenAddress(wallet) : "Connected"}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <SignOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
