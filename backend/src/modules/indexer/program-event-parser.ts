import { BorshCoder, EventParser, Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import * as idlJson from '../../idl/blitzmine.json';
import { bigintToSafeInt, u64LikeToBigInt } from '../../common/numeric/u64';

const IDL = idlJson as unknown as Idl;
const CODER = new BorshCoder(IDL);

export const U64_MAX = (1n << 64n) - 1n;

export interface ParsedDeployEvent {
  authority: string;
  signer: string;
  amount: bigint;
  mask: bigint;
  roundId: number;
  strategy: bigint;
  totalSquares: number;
  timestampSec: number | null;
}

export interface ParsedFulfillRoundEvent {
  roundId: number;
  winningSquare: number | null;
  totalWinnings: bigint;
  timestampSec: number | null;
}

function toPubkey(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toBase58' in value) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return '';
}

function parseNamedEvents(
  programId: PublicKey,
  logs: string[],
  eventName: string,
): Array<Record<string, unknown>> {
  try {
    const parser = new EventParser(programId, CODER);
    const parsed = Array.from(parser.parseLogs(logs))
      .filter((event) => event.name === eventName)
      .map((event) => event.data as Record<string, unknown>);
    if (parsed.length > 0) return parsed;
  } catch {}

  const prefix = 'Program data: ';
  return logs.flatMap((log) => {
    if (!log.startsWith(prefix)) return [];
    const decoded = CODER.events.decode(log.slice(prefix.length));
    if (!decoded || decoded.name !== eventName) return [];
    return [decoded.data as Record<string, unknown>];
  });
}

export function parseDeployEventsFromLogs(
  programId: PublicKey,
  logs: string[],
): ParsedDeployEvent[] {
  const parsed: ParsedDeployEvent[] = [];

  for (const data of parseNamedEvents(programId, logs, 'DeployEvent')) {
    const amount = u64LikeToBigInt(data.amount);
    const mask = u64LikeToBigInt(data.mask);
    const roundIdRaw = u64LikeToBigInt(data.roundId ?? data.round_id);
    const strategy = data.strategy === undefined ? U64_MAX : u64LikeToBigInt(data.strategy);
    const totalSquaresRaw = u64LikeToBigInt(data.totalSquares ?? data.total_squares);
    const tsRaw = u64LikeToBigInt(data.ts);
    const authority = toPubkey(data.authority);
    const signer = toPubkey(data.signer);

    let roundId: number;
    let totalSquares: number;
    try {
      roundId = bigintToSafeInt(roundIdRaw, 'deployEvent.roundId');
      totalSquares = bigintToSafeInt(totalSquaresRaw, 'deployEvent.totalSquares');
    } catch {
      continue;
    }
    const timestampSec = (() => {
      if (tsRaw <= 0n) return null;
      try {
        return bigintToSafeInt(tsRaw, 'deployEvent.ts');
      } catch {
        return null;
      }
    })();

    if (!authority || !signer || roundId < 0 || !Number.isFinite(roundId)) {
      continue;
    }

    parsed.push({
      authority,
      signer,
      amount,
      mask,
      roundId,
      strategy,
      totalSquares: Number.isFinite(totalSquares) && totalSquares > 0 ? totalSquares : 0,
      timestampSec,
    });
  }

  return parsed;
}

export function parseFulfillRoundEventsFromLogs(
  programId: PublicKey,
  logs: string[],
): ParsedFulfillRoundEvent[] {
  const parsed: ParsedFulfillRoundEvent[] = [];

  for (const data of parseNamedEvents(programId, logs, 'FulfillRoundEvent')) {
    const roundIdRaw = u64LikeToBigInt(data.roundId ?? data.round_id);
    const winningSquareRaw = u64LikeToBigInt(data.winningSquare ?? data.winning_square);
    const totalWinnings = u64LikeToBigInt(data.totalWinnings ?? data.total_winnings);
    const tsRaw = u64LikeToBigInt(data.ts);

    let roundId: number;
    try {
      roundId = bigintToSafeInt(roundIdRaw, 'fulfillRoundEvent.roundId');
    } catch {
      continue;
    }

    let winningSquare: number | null = null;
    if (winningSquareRaw !== U64_MAX) {
      try {
        const candidate = bigintToSafeInt(
          winningSquareRaw,
          'fulfillRoundEvent.winningSquare',
        );
        if (candidate >= 0 && candidate < 25) {
          winningSquare = candidate;
        }
      } catch {
        winningSquare = null;
      }
    }

    const timestampSec = (() => {
      if (tsRaw <= 0n) return null;
      try {
        return bigintToSafeInt(tsRaw, 'fulfillRoundEvent.ts');
      } catch {
        return null;
      }
    })();

    parsed.push({
      roundId,
      winningSquare,
      totalWinnings,
      timestampSec,
    });
  }

  return parsed;
}
