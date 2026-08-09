import type { MinerRoundEntry, RoundHistoryEntry } from "@/types/mining";

export interface RoundHistoryProps {
  history: RoundHistoryEntry[];
}

export interface HistoryHeaderProps {
  historyLength: number;
  isOpen: boolean;
  onToggle: () => void;
}

export interface RoundRowProps {
  entry: RoundHistoryEntry;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export interface RoundExpandedProps {
  entry: RoundHistoryEntry;
}

export interface ExpandedMinerState {
  miner: MinerRoundEntry;
  isWinner: boolean;
  solReward: number;
}
