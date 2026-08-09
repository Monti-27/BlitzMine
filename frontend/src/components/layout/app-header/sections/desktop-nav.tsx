"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type HeaderNavItem = { label: string; href: string };

interface DesktopNavProps {
  pathname: string;
  items: HeaderNavItem[];
}

export function DesktopNav({ pathname, items }: DesktopNavProps) {
  return (
    <nav className="hidden md:flex items-center gap-8">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "text-base transition-colors pb-1",
              isActive
                ? "text-foreground border-b-2 border-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
