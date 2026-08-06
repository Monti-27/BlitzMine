import { PublicKey } from '@solana/web3.js';
import { BigIntInterceptor } from './bigint.interceptor';

describe('BigIntInterceptor', () => {
  it('serializes Solana public keys as base58 strings', () => {
    const interceptor = new BigIntInterceptor();
    const serialize = (
      interceptor as unknown as { serialize: (value: unknown) => unknown }
    ).serialize.bind(interceptor);
    const publicKey = new PublicKey('Gk8m1GyRmWtkeUZCsspH7DjJnUiw4uR9jXJrbhYqpbiN');

    expect(serialize({ topMiner: publicKey })).toEqual({
      topMiner: publicKey.toBase58(),
    });
  });
});
