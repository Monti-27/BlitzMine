export interface RoundAccount {
  id: number;
  deployed: Array<number | string>;
  slotHash: string;
  count: Array<number | string>;
  expiresAt: number | string | null;
  motherlode: number | string;
  rentPayer: string;
  topMiner: string;
  topMinerReward: number | string;
  totalDeployed: number | string;
  totalMiners: number;
  totalVaulted: number | string;
  totalWinnings: number | string;
  status: RoundStatus;
  winningSquare?: number | null;
  board?: {
    roundId: number;
    startSlot: number;
    endSlot: number | null;
    currentSlot?: number | null;
    slotMs?: number;
    timerActive?: boolean;
    timeRemainingSec?: number;
    displayTimerSec?: number | null;
    waitingMessage?: string | null;
    phase?: "PENDING_DEPLOY" | "ACTIVE" | "INTERMISSION";
    transitionToken?: string;
    updatedAt?: string;
    isFresh?: boolean;
    roundStartMs?: number | null;
    roundEndMs?: number | null;
    canDeploy?: boolean;
    requiresCheckpoint?: boolean;
  } | null;
  blocks?: Array<{
    blockNumber: number;
    solDeployed: number | string;
    minerCount: number;
  }>;
}

export interface DeployReadinessResponse {
  canDeploy: boolean;
  requiresCheckpoint: boolean;
  reason:
    | "READY"
    | "ROUND_FINALIZING"
    | "MINER_CHECKPOINT_REQUIRED"
    | "ROUND_NOT_ACTIVE"
    | "NO_ACTIVE_BOARD";
  roundId: number | null;
  startSlot: number | null;
  endSlot: number | null;
  currentSlot: number | null;
}

export interface RecentRoundSummary {
  id: number;
  totalDeployed: number | string;
  totalMiners: number;
  totalWinnings: number | string;
  winningSquare: number | null;
  topMiner: string | null;
  deployments: Array<{
    wallet: string;
    squares: number[];
    amount: number | string;
    txHash: string | null;
  }>;
  status: RoundStatus | string;
  createdAt: string;
}

export enum RoundStatus {
  Pending = "pending",
  Active = "active",
  Completed = "completed",
  Expired = "expired",
}

export interface Deployment {
  id: number;
  roundId: number;
  wallet: string;
  squares: number[];
  amount: number | string;
  txHash: string | null;
  slot?: number | string | null;
  source?: string;
  createdAt: string;
}

export interface RealtimeDeployment {
  roundId: number;
  wallet: string;
  squares: number[];
  amountLamports: string;
  txHash: string;
  source: string;
  slot: string | null;
  createdAt: string;
}

export type SolanaCluster = "mainnet" | "devnet" | "testnet";
export type SolanaPrivyChain =
  | "solana:mainnet"
  | "solana:devnet"
  | "solana:testnet";

export interface SolanaRuntimeConfig {
  cluster: SolanaCluster;
  rpcUrl: string;
  wsUrl: string | null;
  programId: string;
  privyChain: SolanaPrivyChain;
  genesisHash: string | null;
  routerUrl: string;
  ephemeralRpcUrl: string | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  database?: "ok" | "error";
  solana?: "ok" | "error";
  runtime?: SolanaRuntimeConfig;
}
