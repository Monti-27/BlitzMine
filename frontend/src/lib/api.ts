import {
  clearAuthSession,
  getCachedAccessToken,
  getValidAccessToken,
} from "./auth-client";
import { API_BASE_URL } from "./constants";
import type {
  Deployment,
  DeployReadinessResponse,
  HealthResponse,
  RealtimeDeployment,
  RecentRoundSummary,
  RoundAccount,
  SolanaRuntimeConfig,
} from "./types";

type AuthMode = "none" | "optional" | "required";

interface RequestOptions {
  authMode?: AuthMode;
  retryAuth?: boolean;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const authMode = options.authMode ?? "optional";
  const retryAuth = options.retryAuth ?? true;
  let token: string | null = null;

  if (authMode === "required") {
    token = await getValidAccessToken();
    if (!token) throw new Error("Authentication required");
  } else if (authMode === "optional") {
    token = getCachedAccessToken();
  }

  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && retryAuth && authMode === "required") {
    clearAuthSession();
    const reissued = await getValidAccessToken();
    if (reissued) {
      const retryHeaders = new Headers(init.headers ?? {});
      if (!retryHeaders.has("Content-Type") && init.body) {
        retryHeaders.set("Content-Type", "application/json");
      }
      retryHeaders.set("Authorization", `Bearer ${reissued}`);
      const retryResponse = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: retryHeaders,
      });
      if (!retryResponse.ok) {
        throw new Error(`API error: ${retryResponse.status}`);
      }
      return retryResponse.json();
    }
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

function fetcher<T>(path: string): Promise<T> {
  return requestJson<T>(path, undefined, { authMode: "optional" });
}

function postJson<T>(
  path: string,
  body: unknown,
  options: RequestOptions = { authMode: "optional" },
): Promise<T> {
  return requestJson<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

function patchJson<T>(
  path: string,
  body: unknown,
  options: RequestOptions = { authMode: "required" },
): Promise<T> {
  return requestJson<T>(
    path,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

export const fetchCurrentRound = () => fetcher<RoundAccount>("/rounds/current");

export const fetchRoundDeployments = (roundId: number) =>
  fetcher<Deployment[]>(`/mining/round/${roundId}/deployments`);

export const fetchDeployReadiness = () =>
  requestJson<DeployReadinessResponse>("/mining/deploy-readiness", undefined, {
    authMode: "required",
  });

export const reportDeploymentSignature = (signature: string) =>
  postJson<{ created: boolean; deployment: RealtimeDeployment }>(
    "/mining/deployments/report",
    { signature },
    { authMode: "required" },
  );

export const requestLocalWalletFunding = () =>
  postJson<{ signature: string; lamports: number }>(
    "/mining/local-faucet",
    {},
    { authMode: "required" },
  );

export const fetchRuntimeNetwork = async (): Promise<SolanaRuntimeConfig> => {
  const health = await requestJson<HealthResponse>("/health", undefined, {
    authMode: "none",
  });
  if (!health.runtime) {
    throw new Error("Backend runtime network data unavailable");
  }
  return health.runtime;
};

export const fetchRecentRounds = (limit = 10) =>
  fetcher<RecentRoundSummary[]>(`/analytics/rounds/recent?limit=${limit}`);

export type BackendChatMessage = {
  id: string;
  sender: string;
  content: string;
  room: string;
  createdAt: string;
  clientMessageId?: string;
};

export type ProfileHoverResponse = {
  username?: string | null;
  walletAddress: string;
  avatarColor: string;
  avatarImage?: string | null;
  rank?: number | null;
  deployedSol: number;
  roundsPlayed?: number;
  motherlodeHits?: number;
};

export type BatchProfileHoverResponse = {
  profiles: Array<{
    wallet: string;
    data: ProfileHoverResponse | null;
  }>;
};

export type PublicProfileResponse = {
  wallet: string;
  identity: {
    walletAddress: string;
    username?: string | null;
    displayName: string;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    avatarColor: string;
    rank?: number | null;
  };
  socials: {
    bio?: string | null;
    xHandle?: string | null;
    telegramHandle?: string | null;
    discordHandle?: string | null;
    website?: string | null;
  };
  stats: {
    roundsPlayed: number;
    roundsWon: number;
    roundsLost: number;
    motherlodeHits: number;
    totalSolDeployed: number;
    totalSolWon: number;
    winRate: number;
  };
  miningHistory: {
    totalSolSpent: number;
    totalSolWon: number;
    netPnl: number;
    recentRounds: Array<{
      round: number;
      result: "win" | "loss";
      solSpent: number;
      solWon: number;
      block: number;
      mode: "solo" | "shared";
      miners: number;
      createdAt: string;
    }>;
    streaks: {
      currentStreak: number;
      bestWinStreak: number;
      bestLossStreak: number;
    };
  };
  hover: ProfileHoverResponse;
  updatedAt?: string | null;
};

export const logoutBackendSession = () =>
  postJson<{ success: boolean }>("/auth/logout", {}, { authMode: "required" });

export const fetchChatMessages = (limit = 50, before?: number) =>
  requestJson<BackendChatMessage[]>(
    `/chat/messages?limit=${limit}${before ? `&before=${before}` : ""}`,
    undefined,
    { authMode: "none" },
  );

export const fetchMyProfile = () =>
  requestJson<PublicProfileResponse>("/profiles/me/view", undefined, {
    authMode: "required",
  });

export const fetchProfileHoverBatch = (wallets: string[]) =>
  postJson<BatchProfileHoverResponse>(
    "/profiles/hover/batch",
    { wallets },
    { authMode: "none" },
  );

export type UpdateMyProfilePayload = {
  username?: string;
  bio?: string;
  xHandle?: string;
  telegramHandle?: string;
  discordHandle?: string;
  website?: string;
  avatarUrl?: string;
  bannerUrl?: string;
};

export const updateMyProfile = (payload: UpdateMyProfilePayload) =>
  patchJson<{
    wallet: string;
    username?: string | null;
    bio?: string | null;
    xHandle?: string | null;
    telegramHandle?: string | null;
    discordHandle?: string | null;
    website?: string | null;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    updatedAt: string;
  }>("/profiles/me", payload, { authMode: "required" });
