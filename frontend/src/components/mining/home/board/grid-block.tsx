"use client";

import { motion } from "framer-motion";
import { User } from "lucide-react";
import Image from "next/image";
import { formatSol } from "@/lib/format";
import type { RoundPhase } from "@/lib/round-dissolve";
import { cn } from "@/lib/utils";
import type { Block } from "@/types/mining";

interface GridBlockProps {
  block: Block;
  isSelected: boolean;
  isLocked?: boolean;
  isPending?: boolean;
  roundPhase: RoundPhase;
  dissolveDimLevel: number;
  resolutionWinningBlock: number | null;
  isCinematicLocked?: boolean;
  isWinnerRevealed?: boolean;
  onClick: () => void;
}

export function GridBlock({
  block,
  isSelected,
  isLocked = false,
  isPending = false,
  roundPhase,
  dissolveDimLevel,
  resolutionWinningBlock,
  isCinematicLocked = false,
  isWinnerRevealed = false,
  onClick,
}: GridBlockProps) {
  const isResolveWinner =
    resolutionWinningBlock !== null && block.id === resolutionWinningBlock;
  const isWinnerFocus =
    roundPhase === "WINNER_FOCUS" && isResolveWinner && isWinnerRevealed;
  const isDuringDissolve =
    roundPhase === "DISSOLVING" || roundPhase === "WINNER_FOCUS";
  const isWinnerDuringDissolve = isDuringDissolve && isResolveWinner;
  const isInCinematic = isDuringDissolve || roundPhase === "ZERO_BUFFER";

  const safeDimLevel = Math.max(0, Math.min(0.95, dissolveDimLevel));
  const dimOpacity = Math.max(0.22, 1 - safeDimLevel * 0.78);
  const dimBrightness = Math.max(0.28, 1 - safeDimLevel * 0.72);

  const animateProps =
    isWinnerFocus || isWinnerDuringDissolve
      ? {
          opacity: 1,
          scale: isWinnerFocus ? 1.05 : 1.02,
          filter: "brightness(1.1)",
          borderColor: "rgba(255, 200, 50, 0.95)",
          borderWidth: 2,
          boxShadow: isWinnerFocus
            ? "0 0 32px rgba(255, 200, 50, 0.5), 0 0 12px rgba(255, 200, 50, 0.3)"
            : "0 0 18px rgba(255, 200, 50, 0.35)",
        }
      : {
          opacity: isDuringDissolve ? dimOpacity : 1,
          scale: 1,
          filter: isDuringDissolve
            ? `brightness(${dimBrightness.toFixed(3)})`
            : "brightness(1)",
          borderColor: isLocked
            ? "rgba(255, 255, 255, 0.78)"
            : isSelected && !isInCinematic
              ? "rgba(255, 255, 255, 0.56)"
              : "rgba(255, 255, 255, 0)",
          borderWidth: isLocked ? 2 : isSelected && !isInCinematic ? 1.5 : 1,
          boxShadow:
            isLocked && !isInCinematic
              ? "0 0 14px rgba(255, 255, 255, 0.22)"
              : isSelected && !isInCinematic
                ? "0 0 10px rgba(255, 255, 255, 0.2)"
                : "none",
        };

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      disabled={isLocked || isCinematicLocked}
      onClick={() => !isLocked && !isCinematicLocked && onClick()}
      animate={animateProps}
      transition={{
        opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
        filter: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
        borderColor: { duration: 0.12, ease: [0.22, 1, 0.36, 1] },
        borderWidth: { duration: 0.1, ease: [0.22, 1, 0.36, 1] },
        boxShadow: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
        scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
      }}
      className={cn(
        "relative aspect-square rounded-lg transition-all duration-200",
        "bg-card/40 border border-transparent",
        !isLocked && !isCinematicLocked && "hover:bg-card/60",
        "flex flex-col justify-between p-2 sm:p-3",
        "text-left overflow-hidden",
        isPending &&
          !isInCinematic &&
          "ring-1 ring-primary/60 shadow-[0_0_12px_rgba(255,255,255,0.18)]",
        (isWinnerFocus || isWinnerDuringDissolve) &&
          "ring-2 ring-amber-400/80 bg-card/80",
        !isInCinematic && isLocked
          ? "bg-card/70 cursor-not-allowed ring-1 ring-white/40 shadow-[0_0_8px_rgba(255,255,255,0.15)] opacity-60"
          : !isInCinematic && isSelected
            ? "bg-card/70"
            : "",
      )}
    >
      <div className="flex items-center justify-between w-full relative z-10">
        <span className="text-xs sm:text-sm text-muted-foreground font-mono">
          #{block.id}
        </span>
        <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground font-mono">
          {block.minerCount || 0}
          <User className="w-3 h-3 sm:w-4 sm:h-4" />
        </div>
      </div>

      <div className="flex justify-end w-full relative z-10">
        <span
          className={cn(
            "text-sm sm:text-base font-mono font-medium",
            block.deployedAmount > 0
              ? "text-foreground/70"
              : "text-muted-foreground/40",
          )}
        >
          {block.deployedAmount > 0
            ? formatSol(block.deployedAmount, 8, 4)
            : formatSol(0, 8, 4)}
        </span>
      </div>

      {(isWinnerFocus || isWinnerDuringDissolve) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 sm:w-12 sm:h-12">
            <Image
              src="/solana-logo.svg"
              alt="Winner"
              width={48}
              height={48}
              className="w-full h-full object-contain drop-shadow-lg opacity-80"
            />
          </div>
        </div>
      )}
    </motion.button>
  );
}
