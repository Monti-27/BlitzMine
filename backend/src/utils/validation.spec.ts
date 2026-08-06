import { isValidSolanaAddress, isValidSignature } from './validation';

describe('validation', () => {
  describe('isValidSolanaAddress', () => {
    it('should return true for the system program address (valid base58 public key)', () => {
      expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
    });

    it('should return false for a clearly invalid address string', () => {
      expect(isValidSolanaAddress('not-a-valid-address')).toBe(false);
    });

    it('should return false for an empty string', () => {
      expect(isValidSolanaAddress('')).toBe(false);
    });
  });

  describe('isValidSignature', () => {
    it('should return true for a valid base58 string of 87-88 characters', () => {
      // 88-character base58 string using only valid base58 characters
      const validSig =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQU';
      expect(isValidSignature(validSig)).toBe(true);
    });

    it('should return false for a string that is too short', () => {
      expect(isValidSignature('abc123')).toBe(false);
    });

    it('should return false for a string containing invalid base58 characters (0, O, I, l)', () => {
      // 88 characters but includes '0' which is not valid base58
      const invalidSig = '0'.repeat(88);
      expect(isValidSignature(invalidSig)).toBe(false);
    });
  });
});
