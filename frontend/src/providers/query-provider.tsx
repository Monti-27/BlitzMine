"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

const BACKEND_TOAST_INTERVAL_MS = 8000;
let lastBackendToastAt = 0;

function shouldNotifyBackendError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return false;

  if (
    message.includes("Authentication required") ||
    message.includes("API error: 401") ||
    message.includes("API error: 403")
  ) {
    return false;
  }

  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    /^API error: 5\d\d$/.test(message.trim()) ||
    message.includes("API error: 429")
  ) {
    return true;
  }

  return false;
}

function notifyBackendError(error: unknown) {
  if (!shouldNotifyBackendError(error)) return;
  const now = Date.now();
  if (now - lastBackendToastAt < BACKEND_TOAST_INTERVAL_MS) return;
  lastBackendToastAt = now;
  toast.error("Cannot reach backend right now. Please retry shortly.", {
    id: "backend-unreachable",
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            notifyBackendError(error);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            notifyBackendError(error);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
