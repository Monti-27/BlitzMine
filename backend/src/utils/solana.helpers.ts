import { Connection, PublicKey, Commitment } from '@solana/web3.js';

export function getConnection(rpcUrl: string, commitment: Commitment = 'confirmed'): Connection {
  return new Connection(rpcUrl, commitment);
}

export function getPublicKey(address: string): PublicKey {
  return new PublicKey(address);
}

export function findPda(programId: PublicKey, seeds: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function getBoardPda(programId: PublicKey): [PublicKey, number] {
  return findPda(programId, [Buffer.from('board')]);
}

export function getConfigPda(programId: PublicKey): [PublicKey, number] {
  return findPda(programId, [Buffer.from('config')]);
}

export function getRoundPda(programId: PublicKey, roundId: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(roundId));
  return findPda(programId, [Buffer.from('round'), buf]);
}

export function getMinerPda(programId: PublicKey, authority: PublicKey): [PublicKey, number] {
  return findPda(programId, [Buffer.from('miner'), authority.toBuffer()]);
}

export function getTreasuryPda(programId: PublicKey): [PublicKey, number] {
  return findPda(programId, [Buffer.from('treasury')]);
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / 1e9;
}
