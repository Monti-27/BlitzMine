"use client";

import {
  getIdentityToken,
  PrivyProvider as Privy,
  useIdentityToken,
  useLogout,
  usePrivy,
} from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type AuthLifecycleState, AuthProvider } from "@/hooks/use-auth";
import { logoutBackendSession } from "@/lib/api";
import {
  clearAuthSession,
  exchangePrivyTokenForBackendSession,
  getCachedAccessToken,
  getValidAccessToken,
} from "@/lib/auth-client";
import { PRIVY_APP_ID } from "@/lib/constants";

const AUTH_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
const solanaConnectors = toSolanaWalletConnectors();
const BACKEND_EXCHANGE_RETRY_DELAYS_MS = [0, 800, 1800];

type SolanaWalletRuntime = {
  wallets: ReturnType<typeof useWallets>["wallets"];
  signTransaction: ReturnType<typeof useSignTransaction>["signTransaction"];
};

const SolanaWalletContext = createContext<SolanaWalletRuntime | null>(null);

export function useSolanaWalletRuntime(): SolanaWalletRuntime {
  const runtime = useContext(SolanaWalletContext);
  if (!runtime) throw new Error("Solana wallet runtime is unavailable");
  return runtime;
}

function SolanaWalletBridge({ children }: { children: ReactNode }) {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const value = useMemo(
    () => ({ wallets, signTransaction }),
    [wallets, signTransaction],
  );
  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function PrivyAuthBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const { identityToken: reactiveIdentityToken } = useIdentityToken();
  const { logout: privyLogout } = useLogout();
  const [backendAuthenticated, setBackendAuthenticated] = useState(false);
  const [authState, setAuthState] = useState<AuthLifecycleState>("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  const ensureInFlight = useRef<Promise<boolean> | null>(null);
  const activeWalletRef = useRef<string | null>(null);
  const privyIdentityTokenRef = useRef<string | null>(null);
  const privyIdentityTokenWalletRef = useRef<string | null>(null);
  const previousAuthRef = useRef<{
    authenticated: boolean;
    wallet: string | null;
  }>({
    authenticated: false,
    wallet: null,
  });
  const previousAuthStateRef = useRef<AuthLifecycleState>("idle");
  const lastToastAtRef = useRef<Map<string, number>>(new Map());

  const solanaWallet = user?.linkedAccounts?.find(
    (account) => account.type === "wallet" && account.chainType === "solana",
  );
  const walletAddress =
    (solanaWallet && "address" in solanaWallet ? solanaWallet.address : null) ??
    user?.wallet?.address ??
    null;

  const transitionState = useCallback(
    (next: AuthLifecycleState, reason: string) => {
      setAuthState((prev) => {
        if (prev === next) return prev;
        if (AUTH_DEBUG) {
          console.info(`[auth-state] ${prev} -> ${next}`, { reason });
        }
        return next;
      });
    },
    [],
  );

  const notify = useCallback(
    (
      level: "success" | "error" | "info" | "warning",
      message: string,
      id: string,
      minIntervalMs = 1500,
    ) => {
      const now = Date.now();
      const last = lastToastAtRef.current.get(id) ?? 0;
      if (now - last < minIntervalMs) return;
      lastToastAtRef.current.set(id, now);
      toast[level](message, { id });
    },
    [],
  );

  const resetLocalAuth = useCallback(
    (reason: string) => {
      clearAuthSession();
      setBackendAuthenticated(false);
      setAuthError(null);
      privyIdentityTokenRef.current = null;
      privyIdentityTokenWalletRef.current = null;
      ensureInFlight.current = null;
      activeWalletRef.current = null;
      transitionState("idle", reason);
    },
    [transitionState],
  );

  const ensureBackendAuth = useCallback(
    async (options?: { force?: boolean }): Promise<boolean> => {
      const force = options?.force === true;
      if (!authenticated || !walletAddress) {
        resetLocalAuth("missing_wallet_or_auth");
        return false;
      }

      const cached = await getValidAccessToken(walletAddress);
      if (cached) {
        setBackendAuthenticated(true);
        setAuthError(null);
        transitionState("backend_authenticated", "cached_backend_session");
        return true;
      }

      if (authState === "failed" && !force) {
        return false;
      }

      if (ensureInFlight.current) {
        return ensureInFlight.current;
      }

      const flow = (async () => {
        try {
          transitionState("wallet_connected", "backend_auth_start");

          const tokenCandidates: Array<{
            token: string;
            source:
              | "identity_cached"
              | "identity_reactive"
              | "identity_fetch"
              | "access_token";
            hint: "identity" | "access";
          }> = [];
          const seen = new Set<string>();
          const addCandidate = (
            token: string | null | undefined,
            source:
              | "identity_cached"
              | "identity_reactive"
              | "identity_fetch"
              | "access_token",
            hint: "identity" | "access",
          ) => {
            if (!token || seen.has(token)) return;
            seen.add(token);
            tokenCandidates.push({ token, source, hint });
          };

          if (!force && privyIdentityTokenWalletRef.current === walletAddress) {
            addCandidate(
              privyIdentityTokenRef.current,
              "identity_cached",
              "identity",
            );
          }
          addCandidate(reactiveIdentityToken, "identity_reactive", "identity");
          try {
            addCandidate(
              await getIdentityToken(),
              "identity_fetch",
              "identity",
            );
          } catch (error) {
            if (AUTH_DEBUG) {
              console.warn(
                "[auth] getIdentityToken failed during backend auth",
                {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              );
            }
          }
          try {
            addCandidate(await getAccessToken(), "access_token", "access");
          } catch (error) {
            if (AUTH_DEBUG) {
              console.warn("[auth] getAccessToken failed during backend auth", {
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }

          if (tokenCandidates.length === 0) {
            clearAuthSession();
            setBackendAuthenticated(false);
            setAuthError("Sign in to chat to continue.");
            transitionState("failed", "missing_privy_token");
            if (AUTH_DEBUG) {
              console.warn(
                "[auth] missing Privy token candidates; user re-auth required",
                {
                  walletAddress,
                },
              );
            }
            return false;
          }

          let finalMessage = "Unable to establish backend session.";
          for (const candidate of tokenCandidates) {
            if (
              !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
                candidate.token,
              )
            ) {
              if (AUTH_DEBUG) {
                console.warn("[auth] skipping non-jwt token candidate", {
                  source: candidate.source,
                });
              }
              continue;
            }

            privyIdentityTokenRef.current = candidate.token;
            privyIdentityTokenWalletRef.current = walletAddress;
            transitionState(
              "privy_verified",
              `privy_token_ready_${candidate.source}`,
            );

            for (const waitMs of BACKEND_EXCHANGE_RETRY_DELAYS_MS) {
              if (waitMs > 0) {
                await delay(waitMs);
              }

              const result = await exchangePrivyTokenForBackendSession(
                candidate.token,
                walletAddress,
                { tokenHint: candidate.hint },
              );

              if (result.ok) {
                setBackendAuthenticated(true);
                setAuthError(null);
                transitionState(
                  "backend_authenticated",
                  "backend_session_established",
                );
                return true;
              }

              finalMessage = result.message;
              const shouldStopCandidate =
                result.reason === "unauthorized" ||
                result.reason === "bad_request" ||
                result.reason === "invalid_response";
              if (shouldStopCandidate) {
                break;
              }
            }
          }

          clearAuthSession();
          setBackendAuthenticated(false);
          setAuthError(finalMessage);
          transitionState("failed", "backend_session_exchange_failed");
          return false;
        } finally {
          ensureInFlight.current = null;
        }
      })();

      ensureInFlight.current = flow;
      return flow;
    },
    [
      authenticated,
      walletAddress,
      reactiveIdentityToken,
      authState,
      resetLocalAuth,
      transitionState,
      getAccessToken,
    ],
  );

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !walletAddress) {
      resetLocalAuth("wallet_disconnected_or_not_authenticated");
      return;
    }

    if (activeWalletRef.current !== walletAddress) {
      clearAuthSession();
      setBackendAuthenticated(false);
      setAuthError(null);
      activeWalletRef.current = walletAddress;
      privyIdentityTokenRef.current = null;
      privyIdentityTokenWalletRef.current = null;
      ensureInFlight.current = null;
      transitionState("wallet_connected", "wallet_connected");
    }

    if (authState === "wallet_connected") {
      void ensureBackendAuth();
    }
  }, [
    ready,
    authenticated,
    walletAddress,
    authState,
    ensureBackendAuth,
    resetLocalAuth,
    transitionState,
  ]);

  useEffect(() => {
    if (!ready) return;
    const previous = previousAuthRef.current;
    if (
      authenticated &&
      walletAddress &&
      (!previous.authenticated || previous.wallet !== walletAddress)
    ) {
      notify("success", "Wallet connected.", "auth-wallet-connected");
    } else if (!authenticated && previous.authenticated) {
      notify("info", "Wallet disconnected.", "auth-wallet-disconnected");
    }
    previousAuthRef.current = {
      authenticated,
      wallet: walletAddress,
    };
  }, [ready, authenticated, walletAddress, notify]);

  useEffect(() => {
    const previous = previousAuthStateRef.current;
    if (
      authState === "backend_authenticated" &&
      previous !== "backend_authenticated"
    ) {
      notify("success", "Sign in complete.", "auth-backend-authenticated");
    }
    if (authState === "failed" && previous !== "failed") {
      const message =
        authError && authError.toLowerCase().includes("sign in")
          ? authError
          : "Sign in to continue.";
      notify("error", message, "auth-failed");
    }
    previousAuthStateRef.current = authState;
  }, [authState, authError, notify]);

  const setSocketAuthenticated = useCallback(
    (isSocketAuthenticated: boolean) => {
      if (!authenticated || !walletAddress) {
        return;
      }
      if (isSocketAuthenticated) {
        transitionState("socket_authenticated", "socket_authenticated");
        return;
      }
      if (backendAuthenticated) {
        transitionState("backend_authenticated", "socket_deauthenticated");
      }
    },
    [authenticated, walletAddress, backendAuthenticated, transitionState],
  );

  const handleLogin = useCallback(async () => {
    try {
      await login();
    } catch {
      notify("error", "Sign-in was cancelled.", "auth-login-cancelled");
    }
  }, [login, notify]);

  const handleLogout = useCallback(async () => {
    if (backendAuthenticated || getCachedAccessToken()) {
      try {
        await logoutBackendSession();
      } catch {
        // best effort backend logout
      }
    }

    resetLocalAuth("manual_logout");

    try {
      await privyLogout();
    } catch {
      // best effort Privy logout
    }
    notify("info", "Wallet disconnected.", "auth-wallet-disconnected");
  }, [backendAuthenticated, privyLogout, resetLocalAuth, notify]);

  return (
    <AuthProvider
      value={{
        ready,
        authenticated,
        backendAuthenticated,
        authState,
        authError,
        wallet: authenticated ? walletAddress : null,
        login: handleLogin,
        logout: handleLogout,
        ensureBackendAuth,
        setSocketAuthenticated,
      }}
    >
      {children}
    </AuthProvider>
  );
}

export function PrivyProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    const disabledSignTransaction = async () => {
      throw new Error("Wallet signing is unavailable");
    };
    const runtime = {
      wallets: [],
      signTransaction:
        disabledSignTransaction as SolanaWalletRuntime["signTransaction"],
    };
    return (
      <SolanaWalletContext.Provider value={runtime}>
        <AuthProvider>{children}</AuthProvider>
      </SolanaWalletContext.Provider>
    );
  }

  return (
    <Privy
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#22c55e",
          walletChainType: "solana-only",
          walletList: ["detected_solana_wallets"],
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          solana: { createOnLogin: "off" },
          ethereum: { createOnLogin: "off" },
        },
        loginMethods: ["wallet"],
      }}
    >
      <SolanaWalletBridge>
        <PrivyAuthBridge>{children}</PrivyAuthBridge>
      </SolanaWalletBridge>
    </Privy>
  );
}
