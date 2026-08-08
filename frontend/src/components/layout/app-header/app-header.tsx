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

        <Link
          href="/"
          aria-label="BlitzMine home"
          className="group flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
        >
          {/* Logo artwork is solid black; invert renders it white on the dark shell. */}
          <img
            src="/blitz-mine-logo.svg"
            alt="BlitzMine"
            className="h-12 w-auto select-none invert transition-opacity duration-200 group-hover:opacity-80"
            draggable={false}
          />
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
