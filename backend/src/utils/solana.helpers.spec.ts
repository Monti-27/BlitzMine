import { Connection, PublicKey } from '@solana/web3.js';
import {
  getConnection,
  getPublicKey,
  findPda,
  getBoardPda,
  getRoundPda,
  getMinerPda,
  lamportsToSol,
} from './solana.helpers';

// A known valid Solana program ID for testing PDA derivation
const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

describe('solana.helpers', () => {
  describe('getConnection', () => {
    it('should return a Connection instance', () => {
      const conn = getConnection('https://api.devnet.solana.com');
      expect(conn).toBeInstanceOf(Connection);
    });
  });

  describe('getPublicKey', () => {
    it('should convert a valid address string to a PublicKey', () => {
      const pk = getPublicKey('11111111111111111111111111111111');
      expect(pk).toBeInstanceOf(PublicKey);
      expect(pk.toBase58()).toBe('11111111111111111111111111111111');
    });
  });

  describe('findPda', () => {
    it('should return a [PublicKey, number] tuple', () => {
      const result = findPda(PROGRAM_ID, [Buffer.from('test')]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(PublicKey);
      expect(typeof result[1]).toBe('number');
    });
  });

  describe('getBoardPda', () => {
    it('should derive a PDA using the "board" seed', () => {
      const [pda, bump] = getBoardPda(PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');

      // Verify it matches manual derivation with the same seed
      const [expectedPda, expectedBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('board')],
        PROGRAM_ID,
      );
      expect(pda.equals(expectedPda)).toBe(true);
      expect(bump).toBe(expectedBump);
    });
  });

  describe('getRoundPda', () => {
    it('should derive a PDA using "round" seed and round ID bytes', () => {
      const roundId = 42;
      const [pda, bump] = getRoundPda(PROGRAM_ID, roundId);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');

      // Verify it matches manual derivation with the same seeds
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(roundId));
      const [expectedPda, expectedBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('round'), buf],
        PROGRAM_ID,
      );
      expect(pda.equals(expectedPda)).toBe(true);
      expect(bump).toBe(expectedBump);
    });
  });

  describe('getMinerPda', () => {
    it('should derive a PDA using "miner" seed and authority public key', () => {
      const authority = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const [pda, bump] = getMinerPda(PROGRAM_ID, authority);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');

      // Verify it matches manual derivation with the same seeds
      const [expectedPda, expectedBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('miner'), authority.toBuffer()],
        PROGRAM_ID,
      );
      expect(pda.equals(expectedPda)).toBe(true);
      expect(bump).toBe(expectedBump);
    });
  });

  describe('lamportsToSol', () => {
    it('should convert 1_000_000_000 lamports to 1 SOL', () => {
      expect(lamportsToSol(1_000_000_000)).toBe(1);
    });

    it('should convert 500_000_000 lamports to 0.5 SOL', () => {
      expect(lamportsToSol(500_000_000)).toBe(0.5);
    });
  });

});
