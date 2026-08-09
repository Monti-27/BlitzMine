"use client";

import { useState } from "react";
import type { RoundHistoryProps } from "./models/round-history.types";
import { HistoryHeader } from "./sections/history-header";
import { RoundRow } from "./sections/round-row";

export function RoundHistory({ history }: RoundHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);

  return (
    <div className="w-full mt-2">
      <HistoryHeader
        historyLength={history.length}
        isOpen={isOpen}
        onToggle={() => setIsOpen((value) => !value)}
      />

      {isOpen && (
        <div className="mt-2 rounded-lg bg-card/40 overflow-auto max-h-[70vh] scrollbar-hide">
          <div className="divide-y divide-border/20">
            {history.map((entry, index) => (
              <RoundRow
                key={`${entry.roundNumber}-${index}`}
                entry={entry}
                index={index}
                isExpanded={expandedRound === index}
                onToggle={() =>
                  setExpandedRound(expandedRound === index ? null : index)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
