import { PublicKey } from '@solana/web3.js';

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function isValidSignature(signature: string): boolean {
  return /^[A-HJ-NP-Za-km-z1-9]{64,128}$/.test(signature);
}
