import type { SolanaCluster } from "@/lib/constants";

export function buildTransactionExplorerUrl(
  signature: string,
  cluster: SolanaCluster,
  rpcUrl?: string | null,
): string {
  const transactionPath = `https://explorer.solana.com/tx/${encodeURIComponent(signature.trim())}`;
  const endpoint = rpcUrl?.trim();

  if (endpoint) {
    const query = new URLSearchParams({
      cluster: "custom",
      customUrl: endpoint,
    });
    return `${transactionPath}?${query.toString()}`;
  }

  return cluster === "mainnet"
    ? transactionPath
    : `${transactionPath}?cluster=${cluster}`;
}
