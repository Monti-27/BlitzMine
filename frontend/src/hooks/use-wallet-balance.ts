"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC_URL, WALLET_BALANCE_POLL_MS } from "@/lib/constants";

type WalletBalanceSnapshot = {
  lamports: bigint;
  fetchedAt: number;
};

const inFlightBalanceRequests = new Map<string, Promise<WalletBalanceSnapshot>>();
const lastBalanceRequestAt = new Map<string, number>();
const lastKnownBalances = new Map<string, WalletBalanceSnapshot>();

function balanceCacheKey(rpcUrl: string, wallet: string): string {
  return `${rpcUrl}::${wallet}`;
}

async function fetchWalletBalanceSnapshot(
  connection: Connection,
  wallet: string,
): Promise<WalletBalanceSnapshot> {
  const key = balanceCacheKey(connection.rpcEndpoint, wallet);
  const now = Date.now();

  const active = inFlightBalanceRequests.get(key);
  if (active) {
    return active;
  }

  const lastAt = lastBalanceRequestAt.get(key) ?? 0;
  const lastKnown = lastKnownBalances.get(key) ?? null;
  if (lastKnown && now - lastAt < 900) {
    return lastKnown;
  }

  lastBalanceRequestAt.set(key, now);
  const request = connection
    .getBalance(new PublicKey(wallet), "confirmed")
    .then((lamportsNumber) => {
      const lamports = BigInt(lamportsNumber);
      const snapshot = {
        lamports,
        fetchedAt: Date.now(),
      };
      lastKnownBalances.set(key, snapshot);
      return snapshot;
    })
    .finally(() => {
      inFlightBalanceRequests.delete(key);
    });

  inFlightBalanceRequests.set(key, request);
  return request;
}

function lamportsToSolFloat(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

export function useWalletBalance(wallet: string | null) {
  const [showDelayedSkeleton, setShowDelayedSkeleton] = useState(false);

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, "confirmed"), []);
  const cacheKey = wallet ? balanceCacheKey(SOLANA_RPC_URL, wallet) : null;
  const lastKnown = cacheKey ? (lastKnownBalances.get(cacheKey) ?? null) : null;

  const query = useQuery({
    queryKey: ["wallet-balance", SOLANA_RPC_URL, wallet],
    queryFn: async () => {
      if (!wallet) {
        throw new Error("Wallet address is required for balance query");
      }
      return fetchWalletBalanceSnapshot(connection, wallet);
    },
    enabled: Boolean(wallet),
    refetchInterval: wallet ? WALLET_BALANCE_POLL_MS : false,
    staleTime: Math.max(0, WALLET_BALANCE_POLL_MS - 500),
    gcTime: 5 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!query.isFetching) {
      setShowDelayedSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowDelayedSkeleton(true);
    }, 100);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query.isFetching]);

  const snapshot = query.data ?? lastKnown;
  const lamports = snapshot?.lamports ?? null;
  const sol = lamports !== null ? lamportsToSolFloat(lamports) : null;

  return {
    lamports,
    sol,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    showSkeleton:
      Boolean(wallet) &&
      (query.isLoading || (query.isFetching && showDelayedSkeleton)),
    refetchNow: query.refetch,
    error: query.error instanceof Error ? query.error : null,
  };
}

