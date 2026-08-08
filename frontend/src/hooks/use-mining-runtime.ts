"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSolPrice } from "@/hooks/use-sol-price";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import {
  fetchCurrentRound,
  fetchDeployReadiness,
  fetchRecentRounds,
  fetchRoundDeployments,
  fetchRuntimeNetwork,
  reportDeploymentSignature,
  requestLocalWalletFunding,
} from "@/lib/api";
import {
  buildCheckpointTransaction,
  buildClaimSolTransaction,
  buildDelegateMinerTransaction,
  buildDeployTransaction,
  buildFundMinerTransaction,
  buildUndelegateMinerTransaction,
  fetchMinerState,
  getDelegationStatus,
  getMinerPda,
  type MinerState,
  normalizeEphemeralEndpoint,
} from "@/lib/blitzmine-program";
import {
  type CashOutSettlementState,
  getCashOutSettlementState,
  getPendingSettlementKind,
  type PendingSettlementKind,
} from "@/lib/cash-out-state";
import {
  PROGRAM_ID,
  SOLANA_CLUSTER,
  SOLANA_PRIVY_CHAIN,
  SOLANA_RPC_URL,
} from "@/lib/constants";
import { isDeployBlockedByState } from "@/lib/deploy-readiness";
import { mapMiningErrorMessage } from "@/lib/error-mapper";
import { lamportsToSol } from "@/lib/format";
import { selectRoundDisplayBlocks } from "@/lib/round-board";
import {
  buildDissolveSchedule,
  buildSeed,
  computeBlockDimLevel,
  type DissolveScheduleStep,
  type RoundPhase,
} from "@/lib/round-dissolve";
import { buildRoundResultFromSnapshot } from "@/lib/round-resolution";
import type {
  Deployment,
  DeployReadinessResponse,
  RecentRoundSummary,
  RoundAccount,
  SolanaRuntimeConfig,
} from "@/lib/types";
import { useSolanaWalletRuntime } from "@/providers/privy-provider";
import { useWebSocketContext } from "@/providers/socket-provider";
import type { Block, RoundHistoryEntry, RoundResult } from "@/types/mining";

const MAX_TIMER_SECONDS = 86_400;
const MINING_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
const PENDING_DEPLOY_FALLBACK_WINDOW_MS = 120_000;
const INTERMISSION_WINDOW_MS = 14_000;
const ZERO_BUFFER_MS = 3_000;
const ZERO_BUFFER_MAX_WAIT_MS = 3_500;
const DISSOLVE_TARGET_MS = 5_000;
const WINNER_REVEAL_MS = 400;
const LOCAL_FEE_RESERVE = BigInt(10_000_000);
const EMPTY_BLOCKS: Block[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  minerCount: 0,
  deployedAmount: 0,
  isWinner: false,
}));

const WINNER_FOCUS_MS = Math.max(
  1_500,
  INTERMISSION_WINDOW_MS -
    ZERO_BUFFER_MS -
    DISSOLVE_TARGET_MS -
    WINNER_REVEAL_MS,
);

type PendingDeploy = {
  clientDeployId: string;
  roundId: number;
  wallet: string;
  squares: number[];
  amountLamportsPerSquare: bigint;
  txHash?: string;
  createdAtMs: number;
};

type CashOutBalanceSnapshot = {
  availableSol: number;
  settlementState: CashOutSettlementState;
  settlementKind: PendingSettlementKind;
  settlementRoundId: number | null;
  pendingWinningsSol: number | null;
};

const delay = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

function isLocalEndpoint(value: string): boolean {
  return value.includes("localhost") || value.includes("127.0.0.1");
}

async function waitForMinerState(
  connection: Connection,
  authority: PublicKey,
  predicate: (state: MinerState) => boolean,
  timeoutMs = 20_000,
): Promise<MinerState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: MinerState | null = null;
  while (Date.now() < deadline) {
    lastState = await fetchMinerState(connection, authority).catch(() => null);
    if (lastState && predicate(lastState)) return lastState;
    await delay(500);
  }
  if (lastState) return lastState;
  throw new Error("Miner account synchronization timed out");
}

async function waitForDelegation(
  routerUrl: string,
  miner: PublicKey,
  expected: boolean,
  timeoutMs = 20_000,
): Promise<Awaited<ReturnType<typeof getDelegationStatus>>> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = await getDelegationStatus(routerUrl, miner);
  while (lastStatus.isDelegated !== expected && Date.now() < deadline) {
    await delay(500);
    lastStatus = await getDelegationStatus(routerUrl, miner);
  }
  if (lastStatus.isDelegated !== expected) {
    throw new Error(
      expected ? "Miner delegation timed out" : "Miner undelegation timed out",
    );
  }
  return lastStatus;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value);
    } catch {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? BigInt(Math.trunc(parsed)) : BigInt(0);
    }
  }
  return BigInt(0);
}

function normalizeRemainingSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const normalized = Math.floor(numeric);
  if (normalized > MAX_TIMER_SECONDS) return 0;
  return normalized;
}

function normalizeSquares(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

  const mapped = raw
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 25)
    .map((value) => (value >= 1 ? value : value + 1));

  return Array.from(new Set(mapped)).sort((a, b) => a - b);
}

function areSquaresEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function buildRecentRoundHistory(
  rounds: RecentRoundSummary[],
): RoundHistoryEntry[] {
  return rounds
    .filter(
      (round) =>
        round.winningSquare !== null && round.winningSquare !== undefined,
    )
    .map((round) => {
      const winningBlockId = Math.max(
        1,
        Math.min(25, Number(round.winningSquare) + 1),
      );
      const topMiner =
        typeof round.topMiner === "string" && round.topMiner.trim()
          ? round.topMiner
          : "";
      const result = buildRoundResultFromSnapshot({
        winningBlock: winningBlockId,
        resolutionTxHash: "",
        deployments: round.deployments ?? [],
        totalWinningsLamports: round.totalWinnings,
        fallbackTopMiner: topMiner,
      });

      return {
        roundNumber: round.id,
        result: {
          ...result,
          resolutionTxHash: null,
        },
        miners: [],
      };
    });
}

function maskFromSquares(squares: number[]): bigint {
  return squares.reduce((mask, square) => {
    const index = square - 1;
    if (index < 0 || index > 24) return mask;
    return mask | (BigInt(1) << BigInt(index));
  }, BigInt(0));
}

function buildBlocks(round: RoundAccount | null | undefined): Block[] {
  if (!round) {
    return Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      minerCount: 0,
      deployedAmount: 0,
      isWinner: false,
    }));
  }

  if (Array.isArray(round.blocks) && round.blocks.length > 0) {
    const byIndex = new Map(
      round.blocks.map((block) => [block.blockNumber, block]),
    );
    return Array.from({ length: 25 }, (_, index) => {
      const block = byIndex.get(index);
      return {
        id: index + 1,
        minerCount: block?.minerCount ?? 0,
        deployedAmount: lamportsToSol(block?.solDeployed ?? 0),
        isWinner: false,
      };
    });
  }

  const deployed = Array.isArray(round.deployed) ? round.deployed : [];
  const count = Array.isArray(round.count) ? round.count : [];
  return Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    minerCount: toNumber(count[index] ?? 0),
    deployedAmount: lamportsToSol(deployed[index] ?? 0),
    isWinner: false,
  }));
}

function buildRoundHistoryEntryFromRoundEnd(
  roundId: number,
  result: RoundResult,
): RoundHistoryEntry {
  return {
    roundNumber: roundId,
    result,
    miners: [],
  };
}

function deploymentKey(deployment: Deployment): string {
  const txHash =
    typeof deployment.txHash === "string" ? deployment.txHash.trim() : "";
  if (txHash) return `tx:${txHash}`;
  if (typeof deployment.id === "number") return `id:${deployment.id}`;
  const squares = normalizeSquares(deployment.squares).join(",");
  return `fallback:${deployment.wallet}:${String(deployment.amount)}:${squares}`;
}

function mergeDeployments(
  current: Deployment[],
  incoming: Deployment[],
): Deployment[] {
  const byKey = new Map<string, Deployment>();
  for (const item of current) {
    byKey.set(deploymentKey(item), item);
  }
  for (const item of incoming) {
    byKey.set(deploymentKey(item), item);
  }
  return Array.from(byKey.values());
}

function normalizeRealtimeDeployment(payload: {
  roundId: number;
  wallet: string;
  squares: number[];
  amountLamports: string;
  txHash: string;
  createdAt: string;
}): Deployment {
  return {
    id: -(Date.now() + Math.floor(Math.random() * 10_000)),
    roundId: payload.roundId,
    wallet: payload.wallet,
    squares: normalizeSquares(payload.squares),
    amount: payload.amountLamports,
    txHash: payload.txHash,
    createdAt: payload.createdAt,
  };
}

function getRemainingSeconds(
  round: RoundAccount | null | undefined,
  nowMs: number,
): number {
  const board = round?.board;
  if (!board) return 0;

  if (board.timerActive !== true) {
    return 0;
  }

  const roundEndMs = toNumber(board.roundEndMs);
  if (Number.isFinite(roundEndMs) && roundEndMs > 0) {
    return Math.max(0, Math.ceil((roundEndMs - nowMs) / 1000));
  }

  const explicitRemaining = normalizeRemainingSeconds(board.timeRemainingSec);
  return explicitRemaining ?? 0;
}

function getTimerMetrics(
  round: RoundAccount | null | undefined,
  nowMs: number,
): { remainingMs: number; totalMs: number } {
  const board = round?.board;
  if (!board || board.timerActive !== true) {
    return { remainingMs: 0, totalMs: 60_000 };
  }

  const roundEndMs = toNumber(board.roundEndMs);
  const roundStartMs = toNumber(board.roundStartMs);
  if (Number.isFinite(roundEndMs) && roundEndMs > 0) {
    const remainingMs = Math.max(0, roundEndMs - nowMs);
    const inferredTotalMs =
      Number.isFinite(roundStartMs) &&
      roundStartMs > 0 &&
      roundEndMs > roundStartMs
        ? roundEndMs - roundStartMs
        : 60_000;
    const totalMs = Math.max(
      1_000,
      Math.min(inferredTotalMs, MAX_TIMER_SECONDS * 1000),
    );
    return { remainingMs, totalMs };
  }

  const explicitRemaining =
    normalizeRemainingSeconds(board.timeRemainingSec) ?? 0;
  return {
    remainingMs: explicitRemaining * 1000,
    totalMs: 60_000,
  };
}

type WalletTxResult = { signature: string } | { error: Error };

function normalizeWalletError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Transaction failed";

  const lower = message.toLowerCase();

  if (message.includes("ProgramAccountNotFound")) {
    return new Error(
      "Program account not found on the selected network. Please reconnect and try again.",
    );
  }

  if (message.includes("Cannot destructure property 'err'")) {
    return new Error("Wallet returned an invalid response. Please retry.");
  }

  if (lower.includes("reject") || lower.includes("cancel")) {
    return new Error("Transaction was cancelled.");
  }

  if (
    lower.includes("insufficient funds") ||
    lower.includes("insufficient lamports") ||
    lower.includes("insufficient balance")
  ) {
    return new Error("Not enough SOL to deploy. Please top up your wallet.");
  }

  return new Error("Unable to submit transaction. Please try again.");
}

function decodeBase64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function normalizeSignedTransaction(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    try {
      return bs58.decode(trimmed);
    } catch {
      return decodeBase64ToBytes(trimmed);
    }
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const data = (value as { data: unknown[] }).data;
    if (data.every((item) => typeof item === "number")) {
      return Uint8Array.from(data as number[]);
    }
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      normalizeSignedTransaction(record.signedTransaction) ??
      normalizeSignedTransaction(record.transaction) ??
      normalizeSignedTransaction(record.signedTx)
    );
  }
  return null;
}

function runtimeMismatchError(runtime: SolanaRuntimeConfig): string | null {
  if (runtime.cluster !== SOLANA_CLUSTER) {
    return `Runtime cluster mismatch: frontend=${SOLANA_CLUSTER}, backend=${runtime.cluster}`;
  }
  if (runtime.programId !== PROGRAM_ID) {
    return `Program ID mismatch: frontend=${PROGRAM_ID}, backend=${runtime.programId}`;
  }
  if (runtime.rpcUrl !== SOLANA_RPC_URL) {
    return `RPC URL mismatch: frontend=${SOLANA_RPC_URL}, backend=${runtime.rpcUrl}`;
  }
  if (runtime.privyChain !== SOLANA_PRIVY_CHAIN) {
    return `Privy chain mismatch: frontend=${SOLANA_PRIVY_CHAIN}, backend=${runtime.privyChain}`;
  }
  return null;
}

export function useMiningRuntime() {
  const queryClient = useQueryClient();
  const ws = useWebSocketContext();
  const { wallet, authenticated, backendAuthenticated, ensureBackendAuth } =
    useAuth();
  const { wallets, signTransaction } = useSolanaWalletRuntime();

  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([]);
  const [deployAmount, setDeployAmount] = useState(0);
  const [isDeployPending, setIsDeployPending] = useState(false);
  const [isCashOutPending, setIsCashOutPending] = useState(false);
  const [cashOutErrorMessage, setCashOutErrorMessage] = useState<string | null>(
    null,
  );
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
  const [roundPhase, setRoundPhase] = useState<RoundPhase>("ACTIVE");
  const [phaseStartedAtMs, setPhaseStartedAtMs] = useState(() => Date.now());
  const [timerZeroAtMs, setTimerZeroAtMs] = useState<number | null>(null);
  const [resolutionRoundId, setResolutionRoundId] = useState<number | null>(
    null,
  );
  const [resolutionRoundEndEvent, setResolutionRoundEndEvent] = useState<{
    roundId: number;
    winningBlock: number;
    resolutionTxHash: string;
    receivedAtMs: number;
  } | null>(null);
  const [dissolvingStartedAtMs, setDissolvingStartedAtMs] = useState<
    number | null
  >(null);
  const [resolutionWinningBlock, setResolutionWinningBlock] = useState<
    number | null
  >(null);
  const [dissolveSchedule, setDissolveSchedule] = useState<
    DissolveScheduleStep[]
  >([]);
  const [dissolveProgressByBlock, setDissolveProgressByBlock] = useState<
    Record<number, number>
  >({});
  const [isDissolveComplete, setIsDissolveComplete] = useState(false);
  const [isWinnerRevealed, setIsWinnerRevealed] = useState(false);
  const [winnerFocusEndsAtMs, setWinnerFocusEndsAtMs] = useState<number | null>(
    null,
  );
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [resolutionBlocks, setResolutionBlocks] = useState<Block[] | null>(
    null,
  );
  const [ephemeralRoundHistory, setEphemeralRoundHistory] = useState<
    RoundHistoryEntry[]
  >([]);
  const [pendingDeploys, setPendingDeploys] = useState<PendingDeploy[]>([]);
  const [deploymentLedgerByRound, setDeploymentLedgerByRound] = useState<
    Record<number, Deployment[]>
  >({});
  const lastToastAtRef = useRef<Map<string, number>>(new Map());
  const resolveAnimationFrameRef = useRef<number | null>(null);
  const lastFinalizingToastRoundRef = useRef<number | null>(null);
  const dissolveFirstFrameRoundRef = useRef<number | null>(null);
  const winnerRevealLoggedRef = useRef<number | null>(null);
  const dissolveStartGuardRef = useRef(false);
  const processedRoundEndIdsRef = useRef<Set<number>>(new Set());
  const roundPhaseRef = useRef<RoundPhase>("ACTIVE");
  const currentRoundRef = useRef<RoundAccount | null>(null);
  const visibleRoundIdRef = useRef<number | null>(null);
  const deploymentLedgerRef = useRef<Record<number, Deployment[]>>({});
  const { priceUsd: solPriceUsd, showSkeleton: solPriceLoading } =
    useSolPrice();
  const {
    sol: walletBalanceSol,
    showSkeleton: walletBalanceLoading,
    refetchNow: refetchWalletBalance,
  } = useWalletBalance(wallet);

  const notify = useCallback(
    (
      level: "success" | "error" | "warning" | "info",
      message: string,
      id: string,
      minIntervalMs = 1200,
    ) => {
      const now = Date.now();
      const last = lastToastAtRef.current.get(id) ?? 0;
      if (now - last < minIntervalMs) return;
      lastToastAtRef.current.set(id, now);
      toast[level](message, { id });
    },
    [],
  );
  const runtimeQuery = useQuery({
    queryKey: ["runtime-network"],
    queryFn: fetchRuntimeNetwork,
    refetchInterval: 30_000,
  });
  const rpcConnection = useMemo(
    () => new Connection(SOLANA_RPC_URL, "confirmed"),
    [],
  );
  const roundQuery = useQuery({
    queryKey: ["round", "current", "mining-runtime"],
    queryFn: fetchCurrentRound,
    refetchInterval: 5_000,
  });
  const currentRound = (roundQuery.data ?? null) as RoundAccount | null;
  const currentRoundId = currentRound?.id ?? null;

  useEffect(() => {
    currentRoundRef.current = currentRound;
  }, [currentRound]);

  useEffect(() => {
    if (currentRoundId !== null) {
      visibleRoundIdRef.current = currentRoundId;
    }
  }, [currentRoundId]);

  useEffect(() => {
    roundPhaseRef.current = roundPhase;
  }, [roundPhase]);

  useEffect(() => {
    deploymentLedgerRef.current = deploymentLedgerByRound;
  }, [deploymentLedgerByRound]);

  const enterRoundPhase = useCallback((nextPhase: RoundPhase) => {
    setRoundPhase(nextPhase);
    setPhaseStartedAtMs(Date.now());
  }, []);

  const enterDissolve = useCallback(
    (
      event: {
        roundId: number;
        winningBlock: number;
        resolutionTxHash: string;
        receivedAtMs: number;
      } | null,
      reason: "event" | "fallback-timeout",
    ) => {
      if (roundPhaseRef.current !== "ZERO_BUFFER") return;
      if (dissolveStartGuardRef.current) return;
      dissolveStartGuardRef.current = true;

      const targetRoundId =
        event?.roundId ??
        resolutionRoundId ??
        currentRoundId ??
        currentRoundRef.current?.id ??
        0;
      const allBlockIds = Array.from({ length: 25 }, (_, index) => index + 1);
      const schedule = buildDissolveSchedule({
        blockIds: allBlockIds,
        winningBlock: event?.winningBlock ?? -1,
        durationMs: DISSOLVE_TARGET_MS,
        seed: event
          ? buildSeed(event.roundId, event.resolutionTxHash)
          : buildSeed(targetRoundId, "pending"),
      });

      const now = Date.now();
      setResolutionRoundId(targetRoundId);
      setDissolveProgressByBlock({});
      setDissolveSchedule(schedule);
      setDissolvingStartedAtMs(now);
      setIsDissolveComplete(false);
      setWinnerFocusEndsAtMs(null);

      if (MINING_DEBUG) {
        console.info("[mining-runtime] zero_buffer_end_at_ms", {
          roundId: targetRoundId,
          zero_buffer_end_at_ms: now,
          reason,
        });
        console.info("[mining-runtime] dissolve_start_at_ms", {
          roundId: targetRoundId,
          dissolve_start_at_ms: now,
          winner_known: event !== null,
          winning_block: event?.winningBlock ?? null,
          reason,
        });
      }

      enterRoundPhase("DISSOLVING");
    },
    [currentRoundId, enterRoundPhase, resolutionRoundId],
  );

  const roundDeploymentsQuery = useQuery({
    queryKey: ["round-deployments", currentRoundId],
    queryFn: () =>
      fetchRoundDeployments(
        currentRoundId ??
          (() => {
            throw new Error("Current round unavailable");
          })(),
      ),
    enabled: currentRoundId !== null,
    refetchInterval: 10_000,
  });
  const deployReadinessQuery = useQuery({
    queryKey: ["deploy-readiness", wallet],
    queryFn: fetchDeployReadiness,
    enabled: Boolean(wallet && backendAuthenticated),
    refetchInterval: 5_000,
  });
  const roundHistoryQuery = useQuery({
    queryKey: ["round-history", "recent"],
    queryFn: () => fetchRecentRounds(10),
    refetchInterval: 15_000,
  });
  const roundHistoryVersion = useMemo(
    () =>
      ((roundHistoryQuery.data ?? []) as RecentRoundSummary[])
        .map(
          (round) =>
            `${round.id}:${round.winningSquare ?? "canceled"}:${round.totalWinnings}:${round.deployments.length}`,
        )
        .join("|"),
    [roundHistoryQuery.data],
  );
  const cashOutBalanceQuery = useQuery({
    queryKey: [
      "cash-out-balance",
      wallet,
      currentRoundId,
      runtimeQuery.data?.routerUrl,
      runtimeQuery.data?.ephemeralRpcUrl,
      roundHistoryVersion,
    ],
    queryFn: async (): Promise<CashOutBalanceSnapshot> => {
      if (!wallet || !runtimeQuery.data) {
        return {
          availableSol: 0,
          settlementState: "settled",
          settlementKind: "none",
          settlementRoundId: null,
          pendingWinningsSol: null,
        };
      }
      const authority = new PublicKey(wallet);
      const [miner] = getMinerPda(authority);
      const status = await getDelegationStatus(
        runtimeQuery.data.routerUrl,
        miner,
      );
      const endpoint = status.isDelegated
        ? normalizeEphemeralEndpoint(
            status.fqdn ?? runtimeQuery.data.ephemeralRpcUrl,
          )
        : rpcConnection.rpcEndpoint;
      if (!endpoint) {
        throw new Error("Cash-out balance is unavailable");
      }
      const connection = status.isDelegated
        ? new Connection(endpoint, "confirmed")
        : rpcConnection;
      const state = await fetchMinerState(connection, authority);
      if (!state) {
        return {
          availableSol: 0,
          settlementState: "settled",
          settlementKind: "none",
          settlementRoundId: null,
          pendingWinningsSol: null,
        };
      }

      const settlementState = getCashOutSettlementState({
        checkpointId: state.checkpointId,
        minerRoundId: state.roundId,
        currentRoundId,
      });
      const settlementRoundId =
        state.roundId <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(state.roundId)
          : null;
      const settledRound =
        settlementState === "pending" && settlementRoundId !== null
          ? (((roundHistoryQuery.data ?? []) as RecentRoundSummary[]).find(
              (round) => round.id === settlementRoundId,
            ) ?? null)
          : null;
      const settlementKind =
        settlementState === "pending"
          ? getPendingSettlementKind(settledRound, wallet)
          : "none";
      const pendingWinningsSol =
        settlementKind === "winnings" && settledRound
          ? (buildRoundResultFromSnapshot({
              winningBlock: (settledRound.winningSquare ?? 0) + 1,
              resolutionTxHash: "",
              deployments: settledRound.deployments,
              totalWinningsLamports: settledRound.totalWinnings,
              fallbackTopMiner: settledRound.topMiner,
            }).winners.find((winner) => winner.address === wallet)?.solReward ??
            null)
          : null;

      return {
        availableSol: lamportsToSol(state.rewardsSol),
        settlementState,
        settlementKind,
        settlementRoundId,
        pendingWinningsSol,
      };
    },
    enabled: Boolean(wallet && runtimeQuery.data),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (currentRoundId === null) return;
    const payload = (roundDeploymentsQuery.data ?? []) as Deployment[];
    if (!Array.isArray(payload) || payload.length === 0) return;
    setDeploymentLedgerByRound((prev) => ({
      ...prev,
      [currentRoundId]: mergeDeployments(prev[currentRoundId] ?? [], payload),
    }));
  }, [currentRoundId, roundDeploymentsQuery.data]);

  const activeWallet = useMemo(() => {
    if (!wallet) return null;
    return (
      wallets.find((entry) => entry.address === wallet) ?? wallets[0] ?? null
    );
  }, [wallet, wallets]);

  const ensureRuntimeAlignment = useCallback(async (): Promise<boolean> => {
    try {
      const runtimeFromCache = runtimeQuery.data;
      const runtime =
        runtimeFromCache ??
        (await queryClient.fetchQuery<SolanaRuntimeConfig>({
          queryKey: ["runtime-network"],
          queryFn: fetchRuntimeNetwork,
        }));
      if (!runtime) {
        notify(
          "error",
          "Cannot verify network configuration right now.",
          "mining-runtime-unavailable",
        );
        return false;
      }
      const mismatch = runtimeMismatchError(runtime);
      if (mismatch) {
        notify(
          "error",
          "Mining network mismatch detected. Please refresh and try again.",
          "mining-runtime-mismatch",
        );
        if (MINING_DEBUG) {
          console.warn("[mining-deploy] runtime mismatch", {
            frontend: {
              cluster: SOLANA_CLUSTER,
              programId: PROGRAM_ID,
              rpcUrl: SOLANA_RPC_URL,
            },
            backend: runtime,
          });
        }
        return false;
      }
      return true;
    } catch {
      notify(
        "error",
        "Unable to verify mining network right now.",
        "mining-runtime-check-failed",
      );
      return false;
    }
  }, [runtimeQuery.data, queryClient, notify]);

  useEffect(() => {
    if (currentRoundId === null) {
      setSelectedBlocks([]);
      return;
    }
    setSelectedBlocks([]);
  }, [currentRoundId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimerNowMs(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const reconcilePendingByRealtimeDeploy = useCallback(
    (payload: {
      roundId: number;
      wallet: string;
      squares: number[];
      txHash?: string;
    }) => {
      setPendingDeploys((prev) =>
        prev.filter((pending) => {
          if (
            pending.roundId !== payload.roundId ||
            pending.wallet !== payload.wallet
          ) {
            return true;
          }
          if (
            pending.txHash &&
            payload.txHash &&
            pending.txHash === payload.txHash
          ) {
            return false;
          }
          if (
            Date.now() - pending.createdAtMs >
            PENDING_DEPLOY_FALLBACK_WINDOW_MS
          ) {
            return true;
          }
          return !areSquaresEqual(pending.squares, payload.squares);
        }),
      );
    },
    [],
  );

  const clearPendingByClientId = useCallback((clientDeployId: string) => {
    setPendingDeploys((prev) =>
      prev.filter((pending) => pending.clientDeployId !== clientDeployId),
    );
  }, []);

  const attachPendingTxHash = useCallback(
    (clientDeployId: string, txHash: string) => {
      setPendingDeploys((prev) =>
        prev.map((pending) =>
          pending.clientDeployId === clientDeployId
            ? { ...pending, txHash }
            : pending,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = ws.onNewDeploy((payload) => {
      setDeploymentLedgerByRound((prev) => ({
        ...prev,
        [payload.roundId]: mergeDeployments(prev[payload.roundId] ?? [], [
          normalizeRealtimeDeployment({
            roundId: payload.roundId,
            wallet: payload.wallet,
            squares: payload.squares,
            amountLamports: payload.amountLamports,
            txHash: payload.txHash,
            createdAt: payload.createdAt,
          }),
        ]),
      }));
      reconcilePendingByRealtimeDeploy({
        roundId: payload.roundId,
        wallet: payload.wallet,
        squares: normalizeSquares(payload.squares),
        txHash: payload.txHash,
      });

      void queryClient.refetchQueries({
        queryKey: ["round", "current", "mining-runtime"],
        type: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["round-deployments", payload.roundId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["round-history", "recent"],
      });
      if (wallet) {
        void queryClient.invalidateQueries({
          queryKey: ["deploy-readiness", wallet],
        });
        void queryClient.invalidateQueries({ queryKey: ["miner", wallet] });
        void queryClient.invalidateQueries({
          queryKey: ["cash-out-balance", wallet],
        });
        if (payload.wallet === wallet) {
          void refetchWalletBalance();
        }
      }
    });

    return unsubscribe;
  }, [
    ws,
    queryClient,
    wallet,
    reconcilePendingByRealtimeDeploy,
    refetchWalletBalance,
  ]);

  useEffect(() => {
    const unsubscribe = ws.onRoundEnd((payload) => {
      if (processedRoundEndIdsRef.current.has(payload.roundId)) {
        return;
      }
      processedRoundEndIdsRef.current.add(payload.roundId);
      const now = Date.now();

      const currentSnapshot = currentRoundRef.current;
      const isVisibleRound =
        currentSnapshot?.id === payload.roundId ||
        visibleRoundIdRef.current === payload.roundId;
      const ledger = deploymentLedgerRef.current[payload.roundId] ?? [];
      const result = buildRoundResultFromSnapshot({
        winningBlock: payload.winningBlock,
        resolutionTxHash: payload.resolutionTxHash,
        deployments: ledger,
        totalWinningsLamports:
          payload.totalWinningsLamports ??
          (currentSnapshot?.id === payload.roundId
            ? currentSnapshot.totalWinnings
            : undefined),
        fallbackTopMiner:
          currentSnapshot?.id === payload.roundId
            ? currentSnapshot.topMiner
            : null,
      });

      if (MINING_DEBUG) {
        console.info("[mining-runtime] round_end received", {
          roundId: payload.roundId,
          resolutionTxHash: payload.resolutionTxHash,
          winningBlock: payload.winningBlock,
          ledgerDeployments: ledger.length,
          round_end_received_at_ms: now,
        });
      }

      if (isVisibleRound) {
        if (currentSnapshot?.id === payload.roundId) {
          setResolutionBlocks(
            (previous) => previous ?? buildBlocks(currentSnapshot),
          );
        }
        setResolutionRoundEndEvent((prev) => {
          if (prev !== null && prev.roundId === payload.roundId) {
            return prev;
          }
          return {
            roundId: payload.roundId,
            winningBlock: payload.winningBlock,
            resolutionTxHash: payload.resolutionTxHash,
            receivedAtMs:
              prev?.roundId === payload.roundId ? prev.receivedAtMs : now,
          };
        });
        setResolutionRoundId(payload.roundId);
        setRoundResult(result);
      }
      setEphemeralRoundHistory((prev) => {
        const entry = buildRoundHistoryEntryFromRoundEnd(
          payload.roundId,
          result,
        );
        const next = [
          entry,
          ...prev.filter((item) => item.roundNumber !== payload.roundId),
        ];
        return next.slice(0, 10);
      });
      setPendingDeploys((prev) =>
        prev.filter((pending) => pending.roundId !== payload.roundId),
      );

      if (isVisibleRound && roundPhaseRef.current === "ACTIVE") {
        if (timerZeroAtMs === null && MINING_DEBUG) {
          console.info(
            "[mining-runtime] timer_zero_at_ms (late event fallback)",
            {
              roundId: payload.roundId,
              timer_zero_at_ms: now,
            },
          );
        }
        const zeroAt = timerZeroAtMs ?? now;
        setTimerZeroAtMs(zeroAt);
        setResolutionRoundId(payload.roundId);
        setDissolveProgressByBlock({});
        setDissolveSchedule([]);
        setDissolvingStartedAtMs(null);
        setIsDissolveComplete(false);
        setIsWinnerRevealed(false);
        dissolveStartGuardRef.current = false;
        winnerRevealLoggedRef.current = null;
        if (MINING_DEBUG) {
          console.info("[mining-runtime] zero_buffer_enter_at_ms", {
            roundId: payload.roundId,
            zero_buffer_enter_at_ms: now,
          });
        }
        enterRoundPhase("ZERO_BUFFER");
      }

      void queryClient.refetchQueries({
        queryKey: ["round", "current", "mining-runtime"],
        type: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["round-history", "recent"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["round-deployments", payload.roundId],
      });
      if (wallet) {
        void queryClient.invalidateQueries({
          queryKey: ["deploy-readiness", wallet],
        });
        void queryClient.invalidateQueries({ queryKey: ["miner", wallet] });
        void queryClient.invalidateQueries({
          queryKey: ["cash-out-balance", wallet],
        });
        void refetchWalletBalance();
      }
    });

    return unsubscribe;
  }, [
    ws,
    queryClient,
    wallet,
    refetchWalletBalance,
    enterRoundPhase,
    timerZeroAtMs,
  ]);

  const deployments = useMemo(() => {
    if (currentRoundId === null) return [] as Deployment[];
    return deploymentLedgerByRound[currentRoundId] ?? [];
  }, [deploymentLedgerByRound, currentRoundId]);
  const roundHistory = useMemo(() => {
    const canonicalHistory = buildRecentRoundHistory(
      (roundHistoryQuery.data ?? []) as RecentRoundSummary[],
    );
    const canonicalRounds = new Set(
      canonicalHistory.map((entry) => entry.roundNumber),
    );
    const ephemeralOnly = ephemeralRoundHistory.filter(
      (entry) => !canonicalRounds.has(entry.roundNumber),
    );
    return [...ephemeralOnly, ...canonicalHistory]
      .sort((a, b) => b.roundNumber - a.roundNumber)
      .slice(0, 10);
  }, [roundHistoryQuery.data, ephemeralRoundHistory]);

  const lockedFromDeployments = useMemo(() => {
    if (!wallet) return [] as number[];

    return Array.from(
      new Set(
        deployments
          .filter((deployment) => deployment.wallet === wallet)
          .flatMap((deployment) => normalizeSquares(deployment.squares)),
      ),
    ).sort((a, b) => a - b);
  }, [deployments, wallet]);

  const pendingBlocks = useMemo(() => {
    if (!wallet || currentRoundId === null) return [] as number[];
    return Array.from(
      new Set(
        pendingDeploys
          .filter(
            (pending) =>
              pending.wallet === wallet && pending.roundId === currentRoundId,
          )
          .flatMap((pending) => pending.squares),
      ),
    ).sort((a, b) => a - b);
  }, [pendingDeploys, wallet, currentRoundId]);

  const lockedBlocks = useMemo(
    () => (roundPhase !== "ACTIVE" ? [] : lockedFromDeployments),
    [lockedFromDeployments, roundPhase],
  );
  const blockedBlocks = useMemo(
    () =>
      Array.from(new Set([...lockedFromDeployments, ...pendingBlocks])).sort(
        (a, b) => a - b,
      ),
    [lockedFromDeployments, pendingBlocks],
  );

  const liveBlocks = useMemo(() => {
    if (!currentRound) return EMPTY_BLOCKS;
    const boardRoundId = currentRound.board?.roundId ?? null;
    const currentId = currentRound.id ?? null;
    const visibleRoundId = visibleRoundIdRef.current;

    if (visibleRoundId !== null) {
      if (boardRoundId !== null && boardRoundId !== visibleRoundId) {
        return EMPTY_BLOCKS;
      }
      if (currentId !== null && currentId !== visibleRoundId) {
        return EMPTY_BLOCKS;
      }
    }

    if (currentRound.board?.isFresh === false) {
      return EMPTY_BLOCKS;
    }

    return buildBlocks(currentRound);
  }, [currentRound]);
  const blocks = useMemo(
    () =>
      selectRoundDisplayBlocks(
        liveBlocks,
        resolutionBlocks,
        roundPhase !== "ACTIVE",
      ),
    [liveBlocks, resolutionBlocks, roundPhase],
  );
  const deployReadiness = deployReadinessQuery.data ?? null;
  const isCinematicLocked = roundPhase !== "ACTIVE";
  const isAwaitingRoundEnd =
    roundPhase === "DISSOLVING" && resolutionRoundEndEvent === null;
  const isDeployBlockedByRuntime = useMemo(() => {
    return isDeployBlockedByState({
      cinematicLocked: isCinematicLocked,
      readiness: deployReadiness,
      board: currentRound?.board,
    });
  }, [deployReadiness, currentRound, isCinematicLocked]);

  const minersCount = useMemo(() => {
    if (!currentRound) return 0;
    return toNumber(currentRound.totalMiners);
  }, [currentRound]);

  const totalDeployed = useMemo(() => {
    if (!currentRound) return 0;
    return lamportsToSol(currentRound.totalDeployed);
  }, [currentRound]);

  const youDeployedLamports = useMemo(() => {
    if (!wallet || currentRoundId === null) return BigInt(0);

    const confirmedLamports = deployments
      .filter(
        (deployment) =>
          deployment.wallet === wallet && deployment.roundId === currentRoundId,
      )
      .reduce(
        (sum, deployment) => sum + toBigInt(deployment.amount),
        BigInt(0),
      );

    const pendingLamports = pendingDeploys
      .filter(
        (pending) =>
          pending.wallet === wallet && pending.roundId === currentRoundId,
      )
      .reduce(
        (sum, pending) =>
          sum +
          pending.amountLamportsPerSquare * BigInt(pending.squares.length),
        BigInt(0),
      );

    return confirmedLamports + pendingLamports;
  }, [wallet, currentRoundId, deployments, pendingDeploys]);
  const youDeployedSol = useMemo(
    () => lamportsToSol(youDeployedLamports),
    [youDeployedLamports],
  );

  const motherlode = useMemo(() => {
    if (!currentRound) return 0;
    return lamportsToSol(currentRound.motherlode);
  }, [currentRound]);

  const timeRemaining = useMemo(
    () => getRemainingSeconds(currentRound, timerNowMs),
    [currentRound, timerNowMs],
  );
  const timerMetrics = useMemo(
    () => getTimerMetrics(currentRound, timerNowMs),
    [currentRound, timerNowMs],
  );
  const timerMessage = useMemo(() => {
    const board = currentRound?.board;
    if (!board) return null;
    if (
      typeof board.waitingMessage === "string" &&
      board.waitingMessage.trim().length > 0
    ) {
      return board.waitingMessage;
    }
    if (board.phase === "PENDING_DEPLOY") {
      return "Waiting for deploy...";
    }
    if (board.timerActive !== true) {
      return "Waiting for deploy...";
    }
    return null;
  }, [currentRound]);

  useEffect(() => {
    if (roundPhase !== "ACTIVE") return;
    if (currentRoundId === null) return;
    const board = currentRound?.board;
    if (!board || board.timerActive !== true) return;
    if (timeRemaining > 0) return;
    const now = Date.now();
    setResolutionBlocks(buildBlocks(currentRound));
    setResolutionRoundId(currentRoundId);
    setTimerZeroAtMs(now);
    setResolutionRoundEndEvent(null);
    setDissolveProgressByBlock({});
    setDissolveSchedule([]);
    setDissolvingStartedAtMs(null);
    setIsDissolveComplete(false);
    setIsWinnerRevealed(false);
    setResolutionWinningBlock(null);
    setWinnerFocusEndsAtMs(null);
    dissolveStartGuardRef.current = false;
    dissolveFirstFrameRoundRef.current = null;
    winnerRevealLoggedRef.current = null;
    setSelectedBlocks([]);
    if (MINING_DEBUG) {
      console.info("[mining-runtime] timer_zero_at_ms", {
        roundId: currentRoundId,
        timer_zero_at_ms: now,
      });
      console.info("[mining-runtime] zero_buffer_enter_at_ms", {
        roundId: currentRoundId,
        zero_buffer_enter_at_ms: now,
      });
    }

    enterRoundPhase("ZERO_BUFFER");
  }, [
    roundPhase,
    currentRoundId,
    currentRound,
    timeRemaining,
    enterRoundPhase,
  ]);

  useEffect(() => {
    if (roundPhase !== "ZERO_BUFFER") return;
    const elapsed = Date.now() - phaseStartedAtMs;

    if (resolutionRoundEndEvent !== null) {
      const minBufferRemaining = Math.max(0, ZERO_BUFFER_MS - elapsed);
      const timeout = setTimeout(() => {
        enterDissolve(resolutionRoundEndEvent, "event");
      }, minBufferRemaining);
      return () => clearTimeout(timeout);
    }

    const maxWaitRemaining = Math.max(0, ZERO_BUFFER_MAX_WAIT_MS - elapsed);
    const timeout = setTimeout(() => {
      if (MINING_DEBUG) {
        console.warn("[mining-runtime] zero_buffer_fallback_timeout", {
          roundId: resolutionRoundId ?? currentRoundId,
          elapsed_ms: Date.now() - phaseStartedAtMs,
        });
      }
      enterDissolve(null, "fallback-timeout");
    }, maxWaitRemaining);

    return () => clearTimeout(timeout);
  }, [
    roundPhase,
    phaseStartedAtMs,
    resolutionRoundEndEvent,
    resolutionRoundId,
    currentRoundId,
    enterDissolve,
  ]);

  useEffect(() => {
    if (roundPhase !== "DISSOLVING" || dissolvingStartedAtMs === null) return;
    if (dissolveSchedule.length === 0) return;

    const tick = () => {
      const elapsed = Date.now() - dissolvingStartedAtMs;
      const clampedElapsed = Math.min(elapsed, DISSOLVE_TARGET_MS);
      if (
        MINING_DEBUG &&
        dissolveFirstFrameRoundRef.current !== resolutionRoundId
      ) {
        dissolveFirstFrameRoundRef.current = resolutionRoundId;
        console.info("[mining-runtime] dissolve_first_frame_at_ms", {
          roundId: resolutionRoundId,
          dissolve_first_frame_at_ms: Date.now(),
        });
      }

      const dimMap = computeBlockDimLevel({
        elapsedMs: clampedElapsed,
        schedule: dissolveSchedule,
        maxDim: 0.92,
        fadeMs: 700,
      });

      if (resolutionRoundEndEvent) {
        const winnerBlock = resolutionRoundEndEvent.winningBlock;
        dimMap[winnerBlock] = 0;
      }
      setDissolveProgressByBlock(dimMap);

      if (elapsed >= DISSOLVE_TARGET_MS) {
        setIsDissolveComplete(true);
        return;
      }

      resolveAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    resolveAnimationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (resolveAnimationFrameRef.current !== null) {
        cancelAnimationFrame(resolveAnimationFrameRef.current);
      }
      resolveAnimationFrameRef.current = null;
    };
  }, [
    roundPhase,
    dissolvingStartedAtMs,
    dissolveSchedule,
    resolutionRoundId,
    resolutionRoundEndEvent,
  ]);

  useEffect(() => {
    if (roundPhase !== "DISSOLVING") return;
    if (!isDissolveComplete) return;
    if (isWinnerRevealed) return;

    const now = Date.now();
    const windowEndAtMs = (timerZeroAtMs ?? now) + INTERMISSION_WINDOW_MS;
    const focusEndAtMs = Math.max(windowEndAtMs, now + WINNER_FOCUS_MS);
    setWinnerFocusEndsAtMs(focusEndAtMs);
    setIsWinnerRevealed(true);
    if (resolutionRoundEndEvent) {
      setResolutionWinningBlock(resolutionRoundEndEvent.winningBlock);
    }
    if (MINING_DEBUG && winnerRevealLoggedRef.current !== resolutionRoundId) {
      winnerRevealLoggedRef.current = resolutionRoundId;
      if (resolutionRoundEndEvent) {
        console.info("[mining-runtime] winner_reveal_at_ms", {
          roundId: resolutionRoundEndEvent.roundId,
          winner_reveal_at_ms: now,
          round_end_received_at_ms: resolutionRoundEndEvent.receivedAtMs,
        });
      }
      console.info("[mining-runtime] winner_focus_enter_at_ms", {
        roundId: resolutionRoundId,
        winner_focus_enter_at_ms: now,
        winner_known: resolutionRoundEndEvent !== null,
      });
    }
    enterRoundPhase("WINNER_FOCUS");
  }, [
    roundPhase,
    isDissolveComplete,
    resolutionRoundEndEvent,
    resolutionRoundId,
    isWinnerRevealed,
    timerZeroAtMs,
    enterRoundPhase,
  ]);

  useEffect(() => {
    if (roundPhase !== "WINNER_FOCUS") return;
    if (!resolutionRoundEndEvent) return;
    if (resolutionWinningBlock !== null) return;

    setResolutionWinningBlock(resolutionRoundEndEvent.winningBlock);

    if (MINING_DEBUG) {
      console.info("[mining-runtime] winner_revealed_in_focus_phase", {
        roundId: resolutionRoundEndEvent.roundId,
        winningBlock: resolutionRoundEndEvent.winningBlock,
        revealed_at_ms: Date.now(),
        round_end_received_at_ms: resolutionRoundEndEvent.receivedAtMs,
      });
    }
  }, [roundPhase, resolutionRoundEndEvent, resolutionWinningBlock]);

  useEffect(() => {
    if (roundPhase !== "WINNER_FOCUS") return;
    const now = timerNowMs;
    const focusEndAtMs =
      winnerFocusEndsAtMs ?? (timerZeroAtMs ?? now) + INTERMISSION_WINDOW_MS;
    if (now < focusEndAtMs) return;
    if (resolutionRoundId === null) return;
    const hasNextRoundHydrated =
      currentRoundId !== null && currentRoundId !== resolutionRoundId;
    const boardRoundId = currentRound?.board?.roundId ?? null;
    const hasBoardAdvanced =
      typeof boardRoundId === "number" &&
      Number.isFinite(boardRoundId) &&
      boardRoundId > resolutionRoundId;
    if (!hasNextRoundHydrated && !hasBoardAdvanced) return;
    setResolutionRoundEndEvent(null);
    setResolutionWinningBlock(null);
    setDissolveSchedule([]);
    setDissolveProgressByBlock({});
    setDissolvingStartedAtMs(null);
    setIsDissolveComplete(false);
    setIsWinnerRevealed(false);
    setTimerZeroAtMs(null);
    setWinnerFocusEndsAtMs(null);
    setResolutionRoundId(null);
    setResolutionBlocks(null);
    visibleRoundIdRef.current = currentRoundId;
    setRoundResult(null);
    dissolveStartGuardRef.current = false;
    lastFinalizingToastRoundRef.current = null;
    dissolveFirstFrameRoundRef.current = null;
    winnerRevealLoggedRef.current = null;
    if (MINING_DEBUG) {
      console.info("[mining-runtime] next_round_visible_at_ms", {
        next_round_visible_at_ms: Date.now(),
        previousRoundId: resolutionRoundId,
        currentRoundId,
        boardRoundId,
      });
    }
    enterRoundPhase("ACTIVE");
  }, [
    roundPhase,
    winnerFocusEndsAtMs,
    timerZeroAtMs,
    timerNowMs,
    resolutionRoundId,
    currentRoundId,
    currentRound?.board?.roundId,
    enterRoundPhase,
  ]);

  const handleBlockSelect = useCallback(
    (blockId: number) => {
      if (isCinematicLocked) return;
      setSelectedBlocks((prev) => {
        if (blockedBlocks.includes(blockId)) return prev;
        if (prev.includes(blockId)) {
          return prev.filter((id) => id !== blockId);
        }
        return [...prev, blockId];
      });
    },
    [blockedBlocks, isCinematicLocked],
  );

  const handleSelectAll = useCallback(() => {
    if (isCinematicLocked) return;
    setSelectedBlocks(Array.from({ length: 25 }, (_, i) => i + 1));
  }, [isCinematicLocked]);

  const handleClearSelection = useCallback(() => {
    if (isCinematicLocked) return;
    setSelectedBlocks((prev) =>
      prev.filter((id) => blockedBlocks.includes(id)),
    );
  }, [blockedBlocks, isCinematicLocked]);

  const withAuthReady = useCallback(async (): Promise<boolean> => {
    if (!wallet) {
      notify("warning", "Connect wallet to mine.", "mining-wallet-missing");
      return false;
    }
    if (!authenticated) {
      notify("warning", "Sign in to continue.", "mining-auth-required");
      return false;
    }
    if (!backendAuthenticated) {
      const ok = await ensureBackendAuth({ force: true });
      if (!ok) {
        notify(
          "error",
          "Sign in to chat before deploying.",
          "mining-backend-auth-failed",
        );
        return false;
      }
    }
    const runtimeAligned = await ensureRuntimeAlignment();
    if (!runtimeAligned) {
      return false;
    }
    return true;
  }, [
    wallet,
    authenticated,
    backendAuthenticated,
    ensureBackendAuth,
    ensureRuntimeAlignment,
    notify,
  ]);

  const ensureDeployReady = useCallback(async (): Promise<boolean> => {
    if (!wallet) return false;

    try {
      const readinessFromCache = deployReadinessQuery.data;
      const readiness =
        readinessFromCache ??
        (await queryClient.fetchQuery<DeployReadinessResponse>({
          queryKey: ["deploy-readiness", wallet],
          queryFn: fetchDeployReadiness,
        }));

      if (readiness.requiresCheckpoint) {
        if (readiness.reason === "MINER_CHECKPOINT_REQUIRED") return true;
        notify(
          "info",
          "Finalizing previous round. Please wait…",
          "mining-checkpoint-required",
        );
        return false;
      }

      if (!readiness.canDeploy) {
        notify(
          "warning",
          "Deploy is not available right now.",
          "mining-deploy-not-ready",
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = mapMiningErrorMessage(
        error,
        "Unable to verify deploy readiness right now.",
      );
      notify("warning", message, "mining-deploy-readiness-check-failed");
      return false;
    }
  }, [wallet, deployReadinessQuery.data, queryClient, notify]);

  const submitWalletTransaction = useCallback(
    async (
      serializedTransaction: Uint8Array,
      connection: Connection,
    ): Promise<WalletTxResult> => {
      if (!activeWallet) {
        return { error: new Error("Wallet signer unavailable.") };
      }

      try {
        const signResult = await signTransaction({
          wallet: activeWallet,
          transaction: serializedTransaction,
          chain: SOLANA_PRIVY_CHAIN,
        });

        const signedTransaction = normalizeSignedTransaction(signResult);
        if (!signedTransaction) {
          return {
            error: new Error(
              "Wallet did not return a signed transaction payload.",
            ),
          };
        }

        const isLocalEphemeral =
          isLocalEndpoint(connection.rpcEndpoint) &&
          connection.rpcEndpoint !== rpcConnection.rpcEndpoint;
        const signature = await connection.sendRawTransaction(
          signedTransaction,
          {
            skipPreflight: isLocalEphemeral,
            maxRetries: 3,
            preflightCommitment: "confirmed",
          },
        );
        const confirmation = await connection.confirmTransaction(
          signature,
          "confirmed",
        );
        if (confirmation.value.err) {
          const executed = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          throw new Error(
            `Transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)} ${executed?.meta?.logMessages?.join(" ") ?? ""}`,
          );
        }
        return { signature };
      } catch (error) {
        const normalizedError = normalizeWalletError(error);
        if (MINING_DEBUG) {
          console.warn("[mining-deploy] wallet transaction failed", {
            error,
            normalizedMessage: normalizedError.message,
            chain: SOLANA_PRIVY_CHAIN,
            rpcUrl: connection.rpcEndpoint,
          });
        }
        return { error: normalizedError };
      }
    },
    [activeWallet, signTransaction, rpcConnection.rpcEndpoint],
  );

  const ensureMinerReady = useCallback(
    async (
      authority: PublicKey,
      currentRound: number,
      requiredBalance: bigint,
    ): Promise<{ connection: Connection; state: MinerState }> => {
      const runtime =
        runtimeQuery.data ??
        (await queryClient.fetchQuery<SolanaRuntimeConfig>({
          queryKey: ["runtime-network"],
          queryFn: fetchRuntimeNetwork,
        }));
      if (!runtime.routerUrl) throw new Error("Magic Router is not configured");

      const [miner] = getMinerPda(authority);
      let status = await getDelegationStatus(runtime.routerUrl, miner);
      let state: MinerState | null = null;
      let gameConnection: Connection | null = null;

      const sendRequired = async (
        transaction: Awaited<ReturnType<typeof buildDeployTransaction>>,
        connection: Connection,
      ) => {
        const result = await submitWalletTransaction(
          transaction.serialize(),
          connection,
        );
        if ("error" in result) throw result.error;
        return result.signature;
      };

      const fundLocalWalletIfNeeded = async (deficit: bigint) => {
        if (
          !isLocalEndpoint(rpcConnection.rpcEndpoint) ||
          deficit <= BigInt(0)
        ) {
          return;
        }
        const walletLamports = BigInt(
          await rpcConnection.getBalance(authority, "confirmed"),
        );
        if (walletLamports >= deficit + LOCAL_FEE_RESERVE) return;
        notify(
          "info",
          "Funding your local test wallet.",
          "mining-local-wallet-funding",
        );
        await requestLocalWalletFunding();
        await refetchWalletBalance();
      };

      const delegate = async () => {
        const transaction = await buildDelegateMinerTransaction(
          authority,
          rpcConnection,
        );
        await sendRequired(transaction, rpcConnection);
        status = await waitForDelegation(runtime.routerUrl, miner, true);
        const endpoint = normalizeEphemeralEndpoint(
          status.fqdn ?? runtime.ephemeralRpcUrl,
        );
        if (!endpoint)
          throw new Error("Ephemeral Rollup endpoint is unavailable");
        gameConnection = new Connection(endpoint, "confirmed");
        state = await waitForMinerState(gameConnection, authority, () => true);
      };

      if (status.isDelegated) {
        const endpoint = normalizeEphemeralEndpoint(
          status.fqdn ?? runtime.ephemeralRpcUrl,
        );
        if (!endpoint)
          throw new Error("Ephemeral Rollup endpoint is unavailable");
        gameConnection = new Connection(endpoint, "confirmed");
        state = await waitForMinerState(gameConnection, authority, () => true);
      } else {
        state = await fetchMinerState(rpcConnection, authority);
        const deficit =
          requiredBalance > (state?.rewardsSol ?? BigInt(0))
            ? requiredBalance - (state?.rewardsSol ?? BigInt(0))
            : BigInt(0);
        if (deficit > BigInt(0)) {
          await fundLocalWalletIfNeeded(deficit);
          notify(
            "info",
            "Approve your mining balance deposit.",
            "mining-fund-miner",
          );
          const transaction = await buildFundMinerTransaction(
            authority,
            deficit,
            rpcConnection,
          );
          await sendRequired(transaction, rpcConnection);
        }
        notify(
          "info",
          "Approve your session delegation.",
          "mining-delegate-miner",
        );
        await delegate();
      }

      if (!state || !gameConnection)
        throw new Error("Miner session is unavailable");

      if (
        state.roundId !== BigInt(currentRound) &&
        state.checkpointId !== state.roundId
      ) {
        notify(
          "info",
          "Approve settlement for your previous round.",
          "mining-checkpoint-miner",
        );
        const transaction = await buildCheckpointTransaction(
          authority,
          state.roundId,
          gameConnection,
        );
        await sendRequired(transaction, gameConnection);
        state = await waitForMinerState(
          gameConnection,
          authority,
          (next) => next.checkpointId === next.roundId,
        );
      }

      if (state.rewardsSol < requiredBalance) {
        if (state.checkpointId !== state.roundId) {
          throw new Error(
            "Your delegated mining balance is too low for this deploy",
          );
        }
        notify(
          "info",
          "Refreshing your mining balance.",
          "mining-refresh-miner",
        );
        const undelegate = await buildUndelegateMinerTransaction(
          authority,
          gameConnection,
        );
        await sendRequired(undelegate, gameConnection);
        await waitForDelegation(runtime.routerUrl, miner, false);
        state = await waitForMinerState(rpcConnection, authority, () => true);
        const deficit = requiredBalance - state.rewardsSol;
        if (deficit > BigInt(0)) {
          await fundLocalWalletIfNeeded(deficit);
          const fund = await buildFundMinerTransaction(
            authority,
            deficit,
            rpcConnection,
          );
          await sendRequired(fund, rpcConnection);
        }
        await delegate();
      }

      if (!state || !gameConnection)
        throw new Error("Miner session is unavailable");
      if (state.rewardsSol < requiredBalance)
        throw new Error("Mining balance is too low");
      return { connection: gameConnection, state };
    },
    [
      runtimeQuery.data,
      queryClient,
      rpcConnection,
      submitWalletTransaction,
      notify,
      refetchWalletBalance,
    ],
  );

  const handleManualDeploy = useCallback(async () => {
    if (currentRoundId === null) {
      notify("warning", "No active round available.", "mining-no-active-round");
      return;
    }
    if (selectedBlocks.length === 0) {
      notify(
        "warning",
        "Select at least one block to deploy.",
        "mining-no-blocks",
      );
      return;
    }
    if (!activeWallet || !wallet) {
      notify(
        "error",
        "Wallet signer unavailable.",
        "mining-wallet-unavailable",
      );
      return;
    }

    const authReady = await withAuthReady();
    if (!authReady) return;
    const deployReady = await ensureDeployReady();
    if (!deployReady) return;

    const amountLamportsPerSquare = BigInt(
      Math.floor(deployAmount * 1_000_000_000),
    );
    if (amountLamportsPerSquare <= BigInt(0)) {
      notify("warning", "Enter a valid SOL amount.", "mining-invalid-amount");
      return;
    }

    const selectedSquares = normalizeSquares(selectedBlocks);
    const clientDeployId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    setPendingDeploys((prev) => [
      ...prev,
      {
        clientDeployId,
        roundId: currentRoundId,
        wallet,
        squares: selectedSquares,
        amountLamportsPerSquare,
        createdAtMs: Date.now(),
      },
    ]);
    setIsDeployPending(true);

    try {
      const authority = new PublicKey(wallet);
      const requiredBalance =
        amountLamportsPerSquare * BigInt(selectedSquares.length);
      const minerSession = await ensureMinerReady(
        authority,
        currentRoundId,
        requiredBalance,
      );
      const tx = await buildDeployTransaction(
        authority,
        currentRoundId,
        amountLamportsPerSquare,
        maskFromSquares(selectedSquares),
        minerSession.state.transactionNonce,
        minerSession.connection,
      );

      const txResult = await submitWalletTransaction(
        tx.serialize(),
        minerSession.connection,
      );
      if ("error" in txResult) {
        clearPendingByClientId(clientDeployId);
        notify("error", txResult.error.message, "mining-deploy-failed");
        return;
      }
      const signature = txResult.signature;
      attachPendingTxHash(clientDeployId, signature);
      const report = await reportDeploymentSignature(signature);
      reconcilePendingByRealtimeDeploy({
        roundId: report.deployment.roundId,
        wallet: report.deployment.wallet,
        squares: normalizeSquares(report.deployment.squares),
        txHash: report.deployment.txHash,
      });

      setSelectedBlocks([]);
      void queryClient.invalidateQueries({
        queryKey: ["round-deployments", currentRoundId],
      });
      void queryClient.refetchQueries({
        queryKey: ["round", "current", "mining-runtime"],
        type: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["round-history", "recent"],
      });
    } catch (error) {
      clearPendingByClientId(clientDeployId);
      const message = mapMiningErrorMessage(
        error,
        "Deployment failed. Please try again.",
      );
      notify("error", message, "mining-deploy-failed");
    } finally {
      setIsDeployPending(false);
      void refetchWalletBalance();
    }
  }, [
    currentRoundId,
    selectedBlocks,
    activeWallet,
    wallet,
    withAuthReady,
    ensureDeployReady,
    deployAmount,
    ensureMinerReady,
    submitWalletTransaction,
    attachPendingTxHash,
    clearPendingByClientId,
    reconcilePendingByRealtimeDeploy,
    queryClient,
    notify,
    refetchWalletBalance,
  ]);

  const handleCashOut = useCallback(async () => {
    if (!activeWallet || !wallet) {
      notify(
        "error",
        "Connect a wallet before cashing out.",
        "mining-cashout-wallet",
      );
      return;
    }
    if (isDeployPending || isCashOutPending) return;

    const authReady = await withAuthReady();
    if (!authReady) return;
    setCashOutErrorMessage(null);
    setIsCashOutPending(true);

    try {
      const runtime =
        runtimeQuery.data ??
        (await queryClient.fetchQuery<SolanaRuntimeConfig>({
          queryKey: ["runtime-network"],
          queryFn: fetchRuntimeNetwork,
        }));
      const authority = new PublicKey(wallet);
      const [miner] = getMinerPda(authority);
      let status = await getDelegationStatus(runtime.routerUrl, miner);
      let state: MinerState | null = null;

      const sendRequired = async (
        transaction: Awaited<ReturnType<typeof buildClaimSolTransaction>>,
        connection: Connection,
      ) => {
        const result = await submitWalletTransaction(
          transaction.serialize(),
          connection,
        );
        if ("error" in result) throw result.error;
        return result.signature;
      };

      if (status.isDelegated) {
        const endpoint = normalizeEphemeralEndpoint(
          status.fqdn ?? runtime.ephemeralRpcUrl,
        );
        if (!endpoint)
          throw new Error("Ephemeral Rollup endpoint is unavailable");
        const gameConnection = new Connection(endpoint, "confirmed");
        state = await waitForMinerState(gameConnection, authority, () => true);

        if (state.checkpointId !== state.roundId) {
          if (
            currentRoundId === null ||
            BigInt(currentRoundId) <= state.roundId
          ) {
            throw new Error(
              "Your active round must resolve before you can cash out",
            );
          }
          notify(
            "info",
            "Approve settlement for your last round.",
            "mining-cashout-checkpoint",
          );
          const checkpoint = await buildCheckpointTransaction(
            authority,
            state.roundId,
            gameConnection,
          );
          await sendRequired(checkpoint, gameConnection);
          state = await waitForMinerState(
            gameConnection,
            authority,
            (next) => next.checkpointId === next.roundId,
          );
        }

        notify(
          "info",
          "Approve return to Solana.",
          "mining-cashout-undelegate",
        );
        const undelegate = await buildUndelegateMinerTransaction(
          authority,
          gameConnection,
        );
        await sendRequired(undelegate, gameConnection);
        status = await waitForDelegation(runtime.routerUrl, miner, false);
        state = await waitForMinerState(rpcConnection, authority, () => true);
      } else {
        state = await fetchMinerState(rpcConnection, authority);
      }

      if (status.isDelegated) throw new Error("Miner is still delegated");
      if (!state || state.rewardsSol === BigInt(0)) {
        notify(
          "info",
          "This round settled with no SOL payout.",
          "mining-cashout-empty",
        );
        return;
      }

      const claim = await buildClaimSolTransaction(authority, rpcConnection);
      const signature = await sendRequired(claim, rpcConnection);
      notify(
        "success",
        `Cash out confirmed: ${signature.slice(0, 8)}…`,
        "mining-cashout-success",
      );
      void queryClient.invalidateQueries({ queryKey: ["miner", wallet] });
      void queryClient.invalidateQueries({
        queryKey: ["cash-out-balance", wallet],
      });
      void queryClient.invalidateQueries({
        queryKey: ["deploy-readiness", wallet],
      });
    } catch (error) {
      const message = mapMiningErrorMessage(
        error,
        "Cash out failed. Please try again.",
      );
      setCashOutErrorMessage(message);
      notify("error", message, "mining-cashout-failed");
    } finally {
      setIsCashOutPending(false);
      void refetchWalletBalance();
      void queryClient.invalidateQueries({
        queryKey: ["cash-out-balance", wallet],
      });
    }
  }, [
    activeWallet,
    wallet,
    isDeployPending,
    isCashOutPending,
    withAuthReady,
    runtimeQuery.data,
    queryClient,
    submitWalletTransaction,
    currentRoundId,
    rpcConnection,
    notify,
    refetchWalletBalance,
  ]);

  const handleDeploy = useCallback(async () => {
    if (isDeployPending || isCinematicLocked) return;
    await handleManualDeploy();
  }, [handleManualDeploy, isDeployPending, isCinematicLocked]);

  const isShowingWinner = roundPhase === "WINNER_FOCUS" && isWinnerRevealed;
  const winnerCountdown = useMemo(() => {
    if (!isShowingWinner || winnerFocusEndsAtMs === null) return 0;
    return Math.max(0, Math.ceil((winnerFocusEndsAtMs - timerNowMs) / 1000));
  }, [isShowingWinner, winnerFocusEndsAtMs, timerNowMs]);
  const displayTimeRemaining =
    roundPhase === "ACTIVE" && timerMessage === null ? timeRemaining : null;
  const displayTimerRemainingMs =
    roundPhase === "ACTIVE" && timerMessage === null
      ? timerMetrics.remainingMs
      : 0;
  const displayTimerTotalMs =
    roundPhase === "ACTIVE" ? timerMetrics.totalMs : 60_000;

  return {
    roundNumber: currentRoundId ?? 0,
    blocks,
    selectedBlocks,
    lockedBlocks,
    pendingBlocks,
    deployAmount,
    setDeployAmount,
    handleBlockSelect,
    handleDeploy,
    handleCashOut,
    handleSelectAll,
    handleClearSelection,
    timeRemaining: displayTimeRemaining,
    timerRemainingMs: displayTimerRemainingMs,
    timerTotalMs: displayTimerTotalMs,
    timerMessage,
    totalDeployed,
    youDeployedSol,
    walletBalanceSol,
    walletBalanceLoading,
    cashOutAvailableSol: cashOutBalanceQuery.data?.availableSol ?? null,
    cashOutSettlementState:
      cashOutBalanceQuery.data?.settlementState ?? "settled",
    cashOutSettlementKind: cashOutBalanceQuery.data?.settlementKind ?? "none",
    cashOutSettlementRoundId:
      cashOutBalanceQuery.data?.settlementRoundId ?? null,
    cashOutPendingWinningsSol:
      cashOutBalanceQuery.data?.pendingWinningsSol ?? null,
    cashOutErrorMessage,
    cashOutAvailableLoading:
      Boolean(wallet) &&
      (runtimeQuery.isLoading || cashOutBalanceQuery.isLoading),
    cashOutAvailableError:
      cashOutBalanceQuery.isError && cashOutBalanceQuery.data === undefined,
    retryCashOutAvailable: () => {
      void cashOutBalanceQuery.refetch();
    },
    solPriceUsd,
    solPriceLoading,
    minersCount,
    motherlode,
    roundPhase,
    isAwaitingRoundEnd,
    dissolveProgressByBlock,
    resolutionWinningBlock,
    isCinematicLocked,
    isWinnerRevealed,
    isShowingWinner,
    winnerCountdown,
    roundResult,
    resolutionRpcUrl: runtimeQuery.data?.ephemeralRpcUrl ?? null,
    roundHistory,
    isDeployPending,
    isCashOutPending,
    isDeployBlockedByRuntime,
  };
}
