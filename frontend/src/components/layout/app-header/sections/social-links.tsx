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
          href="https://docs.magicblock.gg"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="MagicBlock docs"
          className="inline-flex h-9 w-9 items-center justify-center rounded text-white/40 transition-colors hover:text-white hover:bg-white/[0.04]"
        >
          <span className="sr-only">MagicBlock docs</span>
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472z" />
          </svg>
        </a>
        <a
          href="https://x.com/magicblock"
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
