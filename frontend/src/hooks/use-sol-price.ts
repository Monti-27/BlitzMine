"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SOL_PRICE_API_URL,
  SOL_PRICE_MINT,
  SOL_PRICE_POLL_MS,
} from "@/lib/constants";

type SolPriceSnapshot = {
  priceUsd: number;
  updatedAt: number;
};

type SolPriceV6ApiResponse = {
  data?: {
    SOL?: {
      price?: number;
    };
  };
};

type SolPriceV3Token = {
  usdPrice?: number;
};

type SolPriceV3ApiResponse = Record<string, SolPriceV3Token>;

let inFlightPriceRequest: Promise<SolPriceSnapshot> | null = null;
let lastPriceRequestStartedAt = 0;
let lastKnownPrice: SolPriceSnapshot | null = null;

function extractSolUsdPrice(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const v3 = payload as SolPriceV3ApiResponse;
  const v3Token = v3[SOL_PRICE_MINT];
  if (
    v3Token &&
    typeof v3Token.usdPrice === "number" &&
    Number.isFinite(v3Token.usdPrice) &&
    v3Token.usdPrice > 0
  ) {
    return v3Token.usdPrice;
  }

  const v6 = payload as SolPriceV6ApiResponse;
  const legacyPrice = v6?.data?.SOL?.price;
  if (
    typeof legacyPrice === "number" &&
    Number.isFinite(legacyPrice) &&
    legacyPrice > 0
  ) {
    return legacyPrice;
  }

  return null;
}

async function fetchSolPriceSnapshot(): Promise<SolPriceSnapshot> {
  const now = Date.now();
  if (inFlightPriceRequest) {
    return inFlightPriceRequest;
  }

  if (lastKnownPrice && now - lastPriceRequestStartedAt < 900) {
    return lastKnownPrice;
  }

  const fallbackUrl = `https://lite-api.jup.ag/price/v3?ids=${SOL_PRICE_MINT}`;
  const urls = Array.from(new Set([SOL_PRICE_API_URL, fallbackUrl]));

  lastPriceRequestStartedAt = now;
  inFlightPriceRequest = (async () => {
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const response = await fetch(url, { method: "GET", cache: "no-store" });
        if (!response.ok) {
          throw new Error(`SOL price request failed: ${response.status} (${url})`);
        }

        const json = (await response.json()) as unknown;
        const rawPrice = extractSolUsdPrice(json);
        if (rawPrice === null) {
          throw new Error(`SOL price response missing valid SOL price (${url})`);
        }

        const snapshot = {
          priceUsd: rawPrice,
          updatedAt: Date.now(),
        };
        lastKnownPrice = snapshot;
        return snapshot;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("SOL price request failed");
      }
    }

    throw lastError ?? new Error("SOL price request failed");
  })().finally(() => {
      inFlightPriceRequest = null;
    });

  return inFlightPriceRequest;
}

export function useSolPrice() {
  const [showDelayedSkeleton, setShowDelayedSkeleton] = useState(false);

  const query = useQuery({
    queryKey: ["market", "sol-usd"],
    queryFn: fetchSolPriceSnapshot,
    refetchInterval: SOL_PRICE_POLL_MS,
    staleTime: Math.max(0, SOL_PRICE_POLL_MS - 500),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
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

  const snapshot = query.data ?? lastKnownPrice;
  const priceUsd =
    snapshot && Number.isFinite(snapshot.priceUsd) && snapshot.priceUsd > 0
      ? snapshot.priceUsd
      : null;

  return {
    priceUsd,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    showSkeleton:
      query.isLoading || (query.isFetching && showDelayedSkeleton),
    lastUpdatedAt: snapshot?.updatedAt ?? null,
    error: query.error instanceof Error ? query.error : null,
  };
}
