"use client";

import { Check, Copy } from "lucide-react";

interface WalletChipProps {
  walletAddress: string;
  copied: boolean;
  onCopy: () => void;
}

export function WalletChip({ walletAddress, copied, onCopy }: WalletChipProps) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="mb-8 w-full rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 transition-all duration-300 hover:border-white/[0.16] hover:bg-white/[0.04]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">Wallet</p>
          <p className="mt-1 text-[13px] font-mono text-white/85 tracking-wide">
            {walletAddress}
          </p>
        </div>
        {copied ? (
          <Check className="h-4 w-4 text-emerald-400/80" />
        ) : (
          <Copy className="h-4 w-4 text-white/35" />
        )}
      </div>
    </button>
  );
}
