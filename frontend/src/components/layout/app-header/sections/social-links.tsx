"use client";

import type { ReactNode } from "react";
import { formatUsd } from "@/lib/format";

interface SocialLinksProps {
  solPriceUsd: number | null;
  solPriceLoading: boolean;
  trailing?: ReactNode;
}

export function SocialLinks({
  solPriceUsd,
  solPriceLoading,
  trailing,
}: SocialLinksProps) {
  return (
    <div className="hidden lg:flex items-center gap-4">
      <span className="inline-flex items-center gap-2">
        <img
          src="/solana-logo.svg"
          alt="SOL"
          className="h-5 w-5 object-contain"
        />
        {solPriceLoading && solPriceUsd === null ? (
          <span className="skeleton h-4 w-12 rounded" />
        ) : (
          <span className="text-sm font-mono font-semibold text-foreground/80">
            {solPriceUsd === null ? "—" : formatUsd(solPriceUsd)}
          </span>
        )}
      </span>

      <span className="w-px h-5 bg-white/[0.08]" />

      <div className="flex items-center gap-1">
        <a
          href="https://x.com/mntxaihq"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X"
          className="inline-flex h-9 w-9 items-center justify-center rounded text-white/40 transition-colors hover:text-white hover:bg-white/[0.04]"
        >
          <span className="sr-only">X</span>
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>

        {trailing}
      </div>
    </div>
  );
}
