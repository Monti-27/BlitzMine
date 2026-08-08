export const NUM_SQUARES = 25;
export const GRID_SIZE = 5;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export type SolanaCluster = "mainnet" | "devnet" | "testnet";
type SolanaPrivyChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

function normalizeCluster(raw: string | undefined): SolanaCluster {
  const value = (raw ?? "").trim().toLowerCase();
  switch (value) {
    case "mainnet":
      return "mainnet";
    case "devnet":
      return "devnet";
    case "testnet":
      return "testnet";
    default:
      throw new Error(
        "Invalid NEXT_PUBLIC_SOLANA_CLUSTER. Allowed values: mainnet, devnet, testnet.",
      );
  }
}

function clusterToPrivyChain(cluster: SolanaCluster): SolanaPrivyChain {
  switch (cluster) {
    case "mainnet":
      return "solana:mainnet";
    case "devnet":
      return "solana:devnet";
    case "testnet":
      return "solana:testnet";
  }
}

function normalizeOptionalPrivyChain(
  raw: string | undefined,
): SolanaPrivyChain | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  switch (value) {
    case "solana:mainnet":
    case "mainnet":
      return "solana:mainnet";
    case "solana:devnet":
    case "devnet":
      return "solana:devnet";
    case "solana:testnet":
    case "testnet":
      return "solana:testnet";
    default:
      throw new Error(
        "Invalid NEXT_PUBLIC_SOLANA_CHAIN. Allowed values: mainnet, devnet, testnet (with or without solana: prefix).",
      );
  }
}

function isTruthyEnv(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const SOLANA_CLUSTER = normalizeCluster(
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
);

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ?? "";
export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID?.trim() ?? "";
export const SOL_PRICE_MINT =
  process.env.NEXT_PUBLIC_SOL_PRICE_MINT?.trim() ||
  "So11111111111111111111111111111111111111112";

function normalizeSolPriceApiUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  const defaultV3Url = `https://lite-api.jup.ag/price/v3?ids=${SOL_PRICE_MINT}`;
  if (!value) return defaultV3Url;

  if (/price\.jup\.ag/i.test(value)) {
    return defaultV3Url;
  }

  return value;
}

export const SOL_PRICE_API_URL = normalizeSolPriceApiUrl(
  process.env.NEXT_PUBLIC_SOL_PRICE_API_URL,
);
export const SOL_PRICE_POLL_MS = 5_000;
export const WALLET_BALANCE_POLL_MS = 5_000;

if (!SOLANA_RPC_URL || !PROGRAM_ID) {
  throw new Error(
    "Missing Solana runtime config. Set NEXT_PUBLIC_SOLANA_RPC_URL and NEXT_PUBLIC_PROGRAM_ID.",
  );
}

export const SOLANA_PRIVY_CHAIN = clusterToPrivyChain(SOLANA_CLUSTER);

const configuredPrivyChain = normalizeOptionalPrivyChain(
  process.env.NEXT_PUBLIC_SOLANA_CHAIN,
);

if (configuredPrivyChain && configuredPrivyChain !== SOLANA_PRIVY_CHAIN) {
  throw new Error(
    "NEXT_PUBLIC_SOLANA_CHAIN does not match NEXT_PUBLIC_SOLANA_CLUSTER.",
  );
}

const allowNonMainnetInProduction = isTruthyEnv(
  process.env.NEXT_PUBLIC_ALLOW_NON_MAINNET_IN_PRODUCTION,
);

if (
  IS_PRODUCTION &&
  SOLANA_CLUSTER !== "mainnet" &&
  !allowNonMainnetInProduction
) {
  throw new Error(
    "Production frontend must use NEXT_PUBLIC_SOLANA_CLUSTER=mainnet. If this is an intentional staging/devnet build, set NEXT_PUBLIC_ALLOW_NON_MAINNET_IN_PRODUCTION=true.",
  );
}
