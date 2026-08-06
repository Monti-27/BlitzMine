import { registerAs } from '@nestjs/config';

const isProduction = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
type SolanaCluster = 'mainnet' | 'devnet' | 'testnet';

function isTruthyEnv(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function normalizeCluster(raw: string | undefined): SolanaCluster {
  const value = (raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'mainnet':
      return 'mainnet';
    case 'devnet':
      return 'devnet';
    case 'testnet':
      return 'testnet';
    default:
      throw new Error(
        'Invalid SOLANA_CLUSTER. Allowed values: mainnet, devnet, testnet',
      );
  }
}

function toPrivyChain(cluster: SolanaCluster): 'solana:mainnet' | 'solana:devnet' | 'solana:testnet' {
  switch (cluster) {
    case 'mainnet':
      return 'solana:mainnet';
    case 'devnet':
      return 'solana:devnet';
    case 'testnet':
      return 'solana:testnet';
  }
}

function assertMainnetSafeConfig(
  cluster: SolanaCluster,
  rpcUrl: string,
  programId: string,
) {
  if (!rpcUrl || !programId) {
    throw new Error(
      'SOLANA_RPC_URL and PROGRAM_ID must be configured in production',
    );
  }

  if (!isProduction) return;

  const allowNonMainnet = isTruthyEnv(
    process.env.ALLOW_NON_MAINNET_IN_PRODUCTION,
  );

  if (cluster !== 'mainnet') {
    if (allowNonMainnet) {
      return;
    }
    throw new Error(
      'Production backend must run with SOLANA_CLUSTER=mainnet. If this is an intentional staging/devnet deployment, set ALLOW_NON_MAINNET_IN_PRODUCTION=true.',
    );
  }
}

export default registerAs('solana', () => ({
  ...(function buildConfig() {
    const cluster = normalizeCluster(process.env.SOLANA_CLUSTER);
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
    const wsUrl = process.env.SOLANA_WS_URL?.trim();
    const programId = process.env.PROGRAM_ID?.trim();

    if (!rpcUrl || !programId) {
      throw new Error('SOLANA_RPC_URL and PROGRAM_ID are required');
    }

    assertMainnetSafeConfig(cluster, rpcUrl, programId);

    return {
      cluster,
      rpcUrl,
      wsUrl,
      programId,
      privyChain: toPrivyChain(cluster),
      adminKeypair: process.env.ADMIN_KEYPAIR || '',
      routerUrl:
        process.env.MAGIC_ROUTER_URL?.trim() ||
        (cluster === 'mainnet'
          ? 'https://router.magicblock.app/'
          : 'https://devnet-router.magicblock.app/'),
      ephemeralRpcUrl: process.env.EPHEMERAL_RPC_URL?.trim() || '',
      ephemeralWsUrl: process.env.EPHEMERAL_WS_URL?.trim() || '',
      validator: process.env.EPHEMERAL_VALIDATOR?.trim() || '',
    };
  })(),
}));
