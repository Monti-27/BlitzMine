"use client";

import { GradientButton } from "@/components/ui/gradient-button";
import { useAuth } from "@/hooks/use-auth";

export function WalletCta() {
  const { ready, authenticated, wallet, login, logout } = useAuth();

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
    <button
      type="button"
      onClick={logout}
      className="h-10 min-w-[128px] px-4 rounded-full border border-[#2A3151] bg-transparent text-white/90 hover:text-white hover:border-[#3B4670] transition-colors font-mono text-sm font-semibold leading-none"
      aria-label="Disconnect wallet"
      title="Disconnect wallet"
    >
      {walletDisplay}
    </button>
  );
}
