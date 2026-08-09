"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSolPrice } from "@/hooks/use-sol-price";
import { DesktopNav, type HeaderNavItem } from "./sections/desktop-nav";
import { MobileMenu } from "./sections/mobile-menu";
import { SocialLinks } from "./sections/social-links";
import { WalletCta } from "./sections/wallet-cta";

const navItems: HeaderNavItem[] = [];

export function AppHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { priceUsd, showSkeleton } = useSolPrice();

  return (
    <>
      <header className="h-20 relative border-b border-border flex items-center px-6 md:px-8 gap-6 md:gap-10 bg-background">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="relative z-10 md:hidden p-2 -ml-2 text-white/40 hover:text-white"
        >
          {mobileMenuOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>

        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 font-mono text-lg font-black text-primary">
            B
          </span>
          <span className="font-mono text-xl font-bold tracking-[-0.04em] text-foreground md:text-2xl">
            BLITZMINE
          </span>
        </Link>

        <DesktopNav pathname={pathname} items={navItems} />

        <div className="flex-1" />

        <div className="flex items-center gap-4 md:gap-6">
          <SocialLinks solPriceUsd={priceUsd} solPriceLoading={showSkeleton} />

          <WalletCta />
        </div>
      </header>

      <MobileMenu
        open={mobileMenuOpen}
        pathname={pathname}
        items={navItems}
        solPriceUsd={priceUsd}
        solPriceLoading={showSkeleton}
        onClose={() => setMobileMenuOpen(false)}
      />
    </>
  );
}
