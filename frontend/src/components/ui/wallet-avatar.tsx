"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getWalletAvatarTheme, normalizeAvatarSeed } from "@/lib/wallet-avatar";

export interface AvatarProps {
  walletAddress?: string | null;
  avatarUrl?: string | null;
  size?: number | string;
  alt?: string;
  className?: string;
}

export function Avatar({
  walletAddress,
  avatarUrl,
  size = 36,
  alt = "Avatar",
  className,
}: AvatarProps) {
  const src = avatarUrl?.trim() || null;
  const seed = normalizeAvatarSeed(walletAddress ?? null);
  const theme = useMemo(() => getWalletAvatarTheme(seed), [seed]);
  const sizeStyle = useMemo(
    () =>
      typeof size === "number" ? { width: `${size}px`, height: `${size}px` } : { width: size, height: size },
    [size],
  );

  if (src) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-full bg-card border border-white/10 shadow-sm",
          className,
        )}
        style={sizeStyle}
      >
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border shadow-sm",
        className,
      )}
      style={{
        background: theme.background,
        borderColor: theme.border,
        ...sizeStyle,
      }}
      aria-label={alt}
      role="img"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.02) 58%, rgba(0,0,0,0.10) 100%)",
        }}
      />
    </div>
  );
}

export { Avatar as WalletAvatar };
