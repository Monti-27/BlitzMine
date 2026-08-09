"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { AnimatedStatCardProps } from "../models/control-panel.types";

function getValueSizeClass(raw: string): string {
  const length = raw.trim().length;
  if (length <= 6) return "text-xl";
  if (length <= 9) return "text-lg";
  if (length <= 12) return "text-base";
  if (length <= 16) return "text-sm";
  return "text-xs";
}

export function AnimatedStatCard({
  label,
  value,
  subValue,
  isLoading = false,
  hoverToUsd = false,
  icon,
  prefix = "",
}: AnimatedStatCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const showUsdSide = hoverToUsd && isHovered;
  const valueText = `${prefix}${value}`;
  const displayValueClass = getValueSizeClass(valueText);
  const displaySubValueClass = getValueSizeClass(subValue ?? "");

  return (
    <button
      type="button"
      className="w-full relative rounded-lg bg-card/60 p-3 text-center cursor-pointer transition-all duration-300 h-[72px] flex flex-col items-center justify-center overflow-hidden border border-transparent hover:border-white/5"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative w-full h-8 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {showUsdSide ? (
            <motion.div
              key="usd"
              initial={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              exit={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-center gap-1"
            >
              {isLoading && !subValue ? (
                <span className="skeleton h-6 w-20 rounded" />
              ) : (
                <span
                  className={`${displaySubValueClass} max-w-full px-1 font-bold font-mono text-foreground tracking-tight whitespace-nowrap`}
                >
                  {subValue ?? "—"}
                </span>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="token"
              initial={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              exit={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-center gap-2 px-1"
            >
              {icon}
              <span
                className={`${displayValueClass} max-w-full font-bold font-mono text-foreground tracking-tight whitespace-nowrap`}
              >
                {valueText}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">
        {label}
      </span>
    </button>
  );
}
