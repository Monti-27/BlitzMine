type U64Like =
  | bigint
  | number
  | string
  | {
      toString: (base?: number) => string;
      toArrayLike?: (...args: unknown[]) => unknown;
      words?: unknown;
      _isBigNumber?: boolean;
      constructor?: { name?: string };
    };

function parseU64Like(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
      return null;
    }
    return BigInt(trimmed);
  }

  if (value && typeof value === 'object') {
    const candidate = value as {
      toString?: (base?: number) => string;
      toArrayLike?: (...args: unknown[]) => unknown;
      toArray?: (...args: unknown[]) => unknown;
      words?: unknown;
      _isBigNumber?: boolean;
      constructor?: { name?: string };
    };
    const toString = candidate.toString;
    const ctorName = candidate.constructor?.name ?? '';
    const looksLikeBn =
      typeof toString === 'function' &&
      (
        ctorName === 'BN' ||
        candidate._isBigNumber === true ||
        typeof candidate.toArrayLike === 'function' ||
        typeof candidate.toArray === 'function' ||
        Array.isArray(candidate.words)
      );

    if (looksLikeBn) {
      const serialized = toString.call(candidate, 10);
      if (!serialized || !/^-?\d+$/.test(serialized)) {
        return null;
      }
      return BigInt(serialized);
    }
  }

  return null;
}

export function bnToBigInt(value: U64Like): bigint {
  const parsed = parseU64Like(value);
  if (parsed === null) {
    throw new Error('Unable to normalize BN-like value to bigint');
  }
  return parsed;
}

export function tryU64LikeToBigInt(value: unknown): bigint | null {
  return parseU64Like(value);
}

export function u64LikeToBigInt(value: unknown): bigint {
  return parseU64Like(value) ?? 0n;
}

export function bigintToSafeInt(value: bigint, label = 'value'): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max || value < min) {
    throw new RangeError(`${label} exceeds Number safe integer range: ${value.toString()}`);
  }
  return Number(value);
}

export function bigintToJsonValue(value: bigint): string {
  return value.toString();
}
