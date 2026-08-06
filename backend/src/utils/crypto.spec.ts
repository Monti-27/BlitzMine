import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import { verifyWalletSignature } from './crypto';

describe('crypto', () => {
  // Generate a real nacl keypair for testing
  const keypair = nacl.sign.keyPair();
  const publicKeyBase58 = bs58.encode(keypair.publicKey);

  describe('verifyWalletSignature', () => {
    it('should return true for a correctly signed message', () => {
      const message = 'BlitzMine Chat Auth: test-wallet:1700000000';
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
      const signatureBase58 = bs58.encode(signatureBytes);

      const result = verifyWalletSignature(message, signatureBase58, publicKeyBase58);
      expect(result).toBe(true);
    });

    it('should return false when the message does not match the signature', () => {
      const originalMessage = 'BlitzMine Chat Auth: test-wallet:1700000000';
      const messageBytes = new TextEncoder().encode(originalMessage);
      const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
      const signatureBase58 = bs58.encode(signatureBytes);

      const wrongMessage = 'BlitzMine Chat Auth: wrong-wallet:9999999999';
      const result = verifyWalletSignature(wrongMessage, signatureBase58, publicKeyBase58);
      expect(result).toBe(false);
    });

    it('should return false for a malformed signature string', () => {
      const message = 'BlitzMine Chat Auth: test-wallet:1700000000';
      const result = verifyWalletSignature(message, 'not-a-valid-signature!!!', publicKeyBase58);
      expect(result).toBe(false);
    });
  });
});
