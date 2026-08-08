export interface WalletAvatarTheme {
  mode: "solid" | "gradient";
  background: string;
  border: string;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

export function normalizeAvatarSeed(walletOrFallback?: string | null): string {
  const normalized = walletOrFallback?.trim().toLowerCase();
  if (normalized && normalized.length > 0) {
    return normalized;
  }
  return "blitzmine:default";
}

function hueFrom(hash: number, shift: number): number {
  return (hash + shift) % 360;
}

export function getWalletAvatarTheme(
  walletOrFallback?: string | null,
): WalletAvatarTheme {
  const seed = normalizeAvatarSeed(walletOrFallback);
  const hash = hashSeed(seed);

  const hueBase = hueFrom(hash, 0);
  const hueOffset = 34 + ((hash >>> 8) % 54);
  const hueAlt = hueFrom(hueBase, hueOffset);
  const angle = 120 + (hash % 40);

  const saturation = 60 + ((hash >>> 16) % 12);
  const light = 44 + ((hash >>> 20) % 10);

  const useGradient = (hash & 1) === 1;

  if (!useGradient) {
    const bg = hsl(hueBase, saturation, light);
    return {
      mode: "solid",
      background: bg,
      border: hsl(hueBase, saturation, Math.max(light - 12, 28)),
    };
  }

  const start = hsl(
    hueBase,
    Math.min(saturation + 7, 76),
    Math.min(light + 7, 64),
  );
  const end = hsl(
    hueAlt,
    Math.max(saturation - 6, 46),
    Math.max(light - 7, 30),
  );

  return {
    mode: "gradient",
    background: `linear-gradient(${angle}deg, ${start} 0%, ${end} 100%)`,
    border: hsl(hueAlt, saturation, Math.max(light - 10, 26)),
  };
}
