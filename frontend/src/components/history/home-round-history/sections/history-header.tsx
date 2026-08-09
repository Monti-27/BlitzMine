"use client";

import { ChevronDown, ChevronUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HistoryHeaderProps } from "../models/round-history.types";

export function HistoryHeader({
  historyLength,
  isOpen,
  onToggle,
}: HistoryHeaderProps) {
  if (historyLength === 0 && !isOpen) {
    return (
      <Button
        variant="ghost"
        disabled
        className="w-full mt-2 text-muted-foreground text-sm gap-2"
      >
        <History className="w-4 h-4" />
        No round history yet
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      onClick={onToggle}
      className="w-full text-muted-foreground hover:text-foreground text-sm gap-2"
    >
      <History className="w-4 h-4" />
      Round History ({historyLength})
      {isOpen ? (
        <ChevronUp className="w-4 h-4 ml-auto" />
      ) : (
        <ChevronDown className="w-4 h-4 ml-auto" />
      )}
    </Button>
  );
}
