"use client";

import Link from "next/link";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HeaderNavItem } from "./desktop-nav";

interface MobileMenuProps {
  open: boolean;
  pathname: string;
  items: HeaderNavItem[];
  solPriceUsd: number | null;
  solPriceLoading: boolean;
  onClose: () => void;
}

export function MobileMenu({
  open,
  pathname,
  items,
  solPriceUsd,
  solPriceLoading,
  onClose,
}: MobileMenuProps) {
  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 top-20 z-50 bg-background">
      <nav className="flex flex-col p-8 gap-6">
        {items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onClose}
              className={cn(
                "text-xl py-4 border-b border-border/50 transition-colors",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="flex items-center gap-8 py-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <img
              src="/solana-logo.svg"
              alt="SOL"
              className="w-6 h-6 object-contain"
            />
            {solPriceLoading && solPriceUsd === null ? (
              <span className="skeleton h-4 w-20 rounded" />
            ) : (
              <span className="text-sm text-foreground/90 font-medium">
                SOL {solPriceUsd === null ? "—" : formatUsd(solPriceUsd)}
              </span>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}
