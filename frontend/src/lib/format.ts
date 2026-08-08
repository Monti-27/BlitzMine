export function lamportsToSol(lamports: number | string | bigint): number {
  return Number(lamports) / 1e9;
}

export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const absolute = Math.abs(value);
  let minimumFractionDigits = 2;
  let maximumFractionDigits = 2;

  if (absolute > 0 && absolute < 0.01) {
    minimumFractionDigits = 4;
    maximumFractionDigits = 6;
  } else if (absolute > 0 && absolute < 1) {
    minimumFractionDigits = 2;
    maximumFractionDigits = 4;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping: false,
  }).format(value);
}

function trimTrailingFractionZeros(value: string, minDecimals: number): string {
  if (!value.includes(".")) return value;
  const [integerPart, fractionalPart] = value.split(".");
  let next = fractionalPart;
  while (next.length > minDecimals && next.endsWith("0")) {
    next = next.slice(0, -1);
  }
  if (next.length === 0) return integerPart;
  return `${integerPart}.${next}`;
}

export function formatSol(
  value: number,
  maxDecimals = 9,
  minDecimals = 0,
): string {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  const boundedMax = Math.max(0, maxDecimals);
  const boundedMin = Math.max(0, Math.min(minDecimals, boundedMax));

  let decimals = boundedMax;
  if (absolute === 0) {
    decimals = boundedMin;
  } else if (absolute >= 1) {
    decimals = Math.min(boundedMax, Math.max(boundedMin, 4));
  } else {
    const scale = Math.ceil(-Math.log10(absolute)) + 2;
    decimals = Math.min(boundedMax, Math.max(boundedMin, scale));
  }

  const fixed = value.toFixed(decimals);
  return trimTrailingFractionZeros(fixed, boundedMin);
}
