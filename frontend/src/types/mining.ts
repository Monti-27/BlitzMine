export interface Block {
  id: number;
  minerCount: number;
  deployedAmount: number;
  isWinner?: boolean;
}

export type RoundMode = "split" | "solo";

export interface RoundWinner {
  minerId: string;
  address: string;
  name: string;
  avatar: string;
  color: string;
  solReward: number;
  contribution: number;
}

export interface RoundResult {
  mode: RoundMode;
  winners: RoundWinner[];
  totalSolPool: number;
  winningBlockId: number;
  resolutionTxHash?: string | null;
}

export interface MinerRoundEntry {
  minerId: string;
  address: string;
  name: string;
  avatar: string;
  color: string;
  selectedTiles: number[];
  totalDeployed: number;
}

export interface RoundHistoryEntry {
  roundNumber: number;
  result: RoundResult;
  miners: MinerRoundEntry[];
}
