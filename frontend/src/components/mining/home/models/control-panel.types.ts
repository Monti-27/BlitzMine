import type { ReactNode } from "react";
import type {
  CashOutSettlementState,
  PendingSettlementKind,
} from "@/lib/cash-out-state";
import type { RoundPhase } from "@/lib/round-dissolve";
import type { RoundResult } from "@/types/mining";

export interface ControlPanelProps {
  selectedBlocks: number[];
  lockedBlocks: number[];
  deployAmount: number;
  onDeployAmountChange: (amount: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeploy: () => void;
  onCashOut: () => void;
  roundNumber: number;
  timeRemaining: number | null;
  timerMessage?: string | null;
  timerRemainingMs?: number;
  timerTotalMs?: number;
  totalDeployed: number;
  youDeployedSol: number;
  walletBalanceSol: number | null;
  walletBalanceLoading: boolean;
  cashOutAvailableSol: number | null;
  cashOutAvailableLoading: boolean;
  cashOutAvailableError: boolean;
  cashOutSettlementState: CashOutSettlementState;
  cashOutSettlementKind: PendingSettlementKind;
  cashOutSettlementRoundId: number | null;
  cashOutPendingWinningsSol: number | null;
  cashOutErrorMessage: string | null;
  onRetryCashOutAvailable: () => void;
  solPriceUsd: number | null;
  solPriceLoading: boolean;
  minersCount: number;
  motherlode: number;
  roundPhase: RoundPhase;
  isAwaitingRoundEnd?: boolean;
  isShowingWinner: boolean;
  winnerCountdown: number;
  roundResult: RoundResult | null;
  resolutionRpcUrl?: string | null;
  isDeployPending?: boolean;
  isCashOutPending?: boolean;
  isDeployBlockedByRuntime?: boolean;
}

export interface AnimatedStatCardProps {
  label: string;
  value: string;
  subValue?: string;
  isLoading?: boolean;
  hoverToUsd?: boolean;
  icon: ReactNode;
  prefix?: string;
}
