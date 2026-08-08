export function mapMiningErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lower = message.toLowerCase();

  if (
    lower.includes("checkpointrequired") ||
    lower.includes("checkpoint required") ||
    lower.includes("0x1776") ||
    lower.includes("6006")
  ) {
    return "Finalizing previous round. Please wait.";
  }

  if (
    lower.includes("authentication required") ||
    lower.includes("api error: 401") ||
    lower.includes("api error: 403")
  ) {
    return "Session expired. Please sign in again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Cannot reach backend right now. Please retry shortly.";
  }
  if (lower.includes("api error: 429")) {
    return "Too many requests right now. Please try again shortly.";
  }
  if (/api error: 5\d\d/.test(lower)) {
    return "Cannot reach backend right now. Please retry shortly.";
  }
  if (lower.includes("cancel") || lower.includes("reject")) {
    return "Transaction was cancelled.";
  }
  if (
    lower.includes("insufficient funds") ||
    lower.includes("insufficient lamports") ||
    lower.includes("insufficient balance")
  ) {
    return "Not enough SOL to deploy. Please top up your wallet.";
  }
  return fallback;
}
