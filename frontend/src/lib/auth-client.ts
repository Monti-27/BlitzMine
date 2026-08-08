import { API_BASE_URL } from "./constants";

export interface AuthSessionTokens {
  wallet: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}

interface InMemorySession {
  wallet: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}

let authSession: InMemorySession | null = null;

const AUTH_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";

export type SessionExchangeFailureReason =
  | "unauthorized"
  | "bad_request"
  | "retriable"
  | "network"
  | "invalid_response";

export type SessionExchangeResult =
  | {
      ok: true;
      wallet: string;
      accessToken: string;
      accessTokenExpiresAt: string;
    }
  | {
      ok: false;
      status: number | null;
      reason: SessionExchangeFailureReason;
      code: string | null;
      message: string;
    };

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isExpired(iso: string, skewSeconds = 15): boolean {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return true;
  return ts <= Date.now() + skewSeconds * 1000;
}

function normalizeSession(tokens: AuthSessionTokens): InMemorySession | null {
  if (
    !tokens.wallet ||
    !tokens.accessToken ||
    !tokens.accessTokenExpiresAt ||
    isExpired(tokens.accessTokenExpiresAt, 0)
  ) {
    return null;
  }

  return {
    wallet: tokens.wallet,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  };
}

function classifyFailure(
  status: number | null,
  payloadCode: string | null,
  payloadMessage: string | null,
): {
  reason: SessionExchangeFailureReason;
  message: string;
} {
  if (status === null) {
    return {
      reason: "network",
      message: payloadMessage ?? "Network error while exchanging Privy token",
    };
  }
  if (status === 400) {
    return {
      reason: "bad_request",
      message: payloadMessage ?? "Malformed Privy token exchange request",
    };
  }
  if (status === 401 || status === 403) {
    return {
      reason: "unauthorized",
      message: payloadMessage ?? "Privy token rejected by backend",
    };
  }
  if (status >= 500 || status === 429) {
    return {
      reason: "retriable",
      message: payloadMessage ?? "Backend temporarily unavailable for auth exchange",
    };
  }
  return {
    reason: "invalid_response",
    message: payloadMessage ?? "Unexpected backend auth exchange response",
  };
}

async function parseErrorBody(response: Response): Promise<{
  code: string | null;
  message: string | null;
  raw: string | null;
}> {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return { code: null, message: null, raw: null };
  }
  try {
    const parsed = JSON.parse(raw) as {
      code?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const nested =
      parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object"
        ? (parsed.error as { code?: unknown; message?: unknown })
        : null;
    const codeCandidate = nested?.code ?? parsed.code;
    const messageCandidate = nested?.message ?? parsed.message;
    return {
      code: typeof codeCandidate === "string" ? codeCandidate : null,
      message:
        typeof messageCandidate === "string"
          ? messageCandidate
          : typeof parsed.message === "string"
            ? parsed.message
            : null,
      raw,
    };
  } catch {
    return { code: null, message: raw, raw };
  }
}

export type PrivyTokenHint = "identity" | "access" | "unknown";

export async function exchangePrivyTokenForBackendSession(
  privyToken: string,
  expectedWallet?: string,
  options?: { tokenHint?: PrivyTokenHint },
): Promise<SessionExchangeResult> {
  if (!privyToken) {
    clearAuthSession();
    return {
      ok: false,
      status: 400,
      reason: "bad_request",
      code: "MISSING_PRIVY_TOKEN",
      message: "Missing Privy token",
    };
  }

  const isJwt =
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(privyToken);
  if (AUTH_DEBUG) {
    const claims = decodeJwtClaims(privyToken);
    console.info("[auth] Sending Privy token to backend", {
      endpoint: `${API_BASE_URL}/auth/privy/session`,
      tokenHint: options?.tokenHint ?? "unknown",
      isJwt,
      tokenLength: privyToken.length,
      tokenPreview: `${privyToken.slice(0, 16)}...${privyToken.slice(-8)}`,
      claims: claims
        ? {
            iss: claims.iss ?? null,
            aud: claims.aud ?? null,
            sub: claims.sub ?? null,
            exp: claims.exp ?? null,
          }
        : null,
    });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/privy/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privyToken}`,
      },
    });
  } catch (error) {
    clearAuthSession();
    const message =
      error instanceof Error ? error.message : "Network error while exchanging Privy token";
    if (AUTH_DEBUG) {
      console.error("[auth] /auth/privy/session network error", { message });
    }
    return {
      ok: false,
      status: null,
      reason: "network",
      code: null,
      message,
    };
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    const failure = classifyFailure(res.status, body.code, body.message);
    if (AUTH_DEBUG) {
      console.error("[auth] /auth/privy/session failed", {
        status: res.status,
        reason: failure.reason,
        code: body.code,
        message: body.message,
        body: body.raw,
      });
    }
    clearAuthSession();
    return {
      ok: false,
      status: res.status,
      reason: failure.reason,
      code: body.code,
      message: failure.message,
    };
  }

  const payload = (await res.json()) as AuthSessionTokens;
  const next = normalizeSession(payload);
  if (!next) {
    clearAuthSession();
    return {
      ok: false,
      status: 200,
      reason: "invalid_response",
      code: "INVALID_SESSION_PAYLOAD",
      message: "Backend session payload is malformed",
    };
  }

  if (expectedWallet && next.wallet !== expectedWallet) {
    clearAuthSession();
    return {
      ok: false,
      status: 200,
      reason: "invalid_response",
      code: "WALLET_MISMATCH",
      message: "Backend session wallet mismatch",
    };
  }

  authSession = next;
  return {
    ok: true,
    wallet: next.wallet,
    accessToken: next.accessToken,
    accessTokenExpiresAt: next.accessTokenExpiresAt,
  };
}

export async function exchangePrivyIdentityTokenForBackendSession(
  identityToken: string,
  expectedWallet?: string,
): Promise<SessionExchangeResult> {
  return exchangePrivyTokenForBackendSession(identityToken, expectedWallet, {
    tokenHint: "identity",
  });
}

export function clearAuthSession() {
  authSession = null;
}

export function getCachedAccessToken(expectedWallet?: string): string | null {
  if (!authSession) return null;
  if (expectedWallet && authSession.wallet !== expectedWallet) {
    clearAuthSession();
    return null;
  }
  if (isExpired(authSession.accessTokenExpiresAt)) {
    return null;
  }
  return authSession.accessToken;
}

export async function getValidAccessToken(
  expectedWallet?: string,
): Promise<string | null> {
  return getCachedAccessToken(expectedWallet);
}
