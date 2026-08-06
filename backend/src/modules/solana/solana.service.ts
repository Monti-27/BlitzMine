import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountInfo,
  Commitment,
  Connection,
  Context,
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Idl,
  Program,
  Wallet,
} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import * as idlJson from '../../idl/blitzmine.json';
import { tryU64LikeToBigInt } from '../../common/numeric/u64';
import {
  getBoardPda,
  getConfigPda,
  getMinerPda,
  getRoundPda,
  getTreasuryPda,
} from '../../utils/solana.helpers';

const IDL = idlJson as unknown as Idl;
const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  '5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc',
);
const DEFAULT_EPHEMERAL_TEST_QUEUE = new PublicKey(
  'Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT',
);
const VRF_PROGRAM_ID = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');

export interface BoardAccount {
  roundId: bigint;
  startTs: bigint;
  endTs: bigint;
  intermissionEndTs: bigint;
  epochId: bigint;
  vrfRequestedAt: bigint;
  requestNonce: bigint;
  vrfRequested: boolean;
  vrfFulfilled: boolean;
  bump: number;
  startSlot: bigint;
  endSlot: bigint;
  currentSlot: bigint;
  canDeploy: boolean;
  requiresCheckpoint: boolean;
  vrfAccount: PublicKey;
}

export interface RoundAccount {
  id: bigint;
  deployed: bigint[];
  randomness: number[];
  count: bigint[];
  expiresAt: bigint;
  motherlode: bigint;
  rentPayer: PublicKey;
  totalDeployed: bigint;
  totalMiners: bigint;
  totalVaulted: bigint;
  totalWinnings: bigint;
  requestNonce: bigint;
  resolved: boolean;
  canceled: boolean;
  bump: number;
  slotHash: number[];
  topMiner: PublicKey;
  topMinerReward: bigint;
}

export interface MinerAccount {
  authority: PublicKey;
  deployed: bigint[];
  checkpointFee: bigint;
  checkpointId: bigint;
  rewardsSol: bigint;
  roundId: bigint;
  lastClaimSolAt: bigint;
  lifetimeRewardsSol: bigint;
  lifetimeDeployed: bigint;
  transactionNonce: bigint;
  bump: number;
}

export interface TreasuryAccount {
  motherlode: bigint;
  totalVaulted: bigint;
  adminFees: bigint;
  bump: number;
}

export interface RoundMinerSnapshot {
  authority: PublicKey;
  deployed: bigint[];
}

type SolanaCluster = 'mainnet' | 'devnet' | 'testnet';
type SolanaPrivyChain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

interface SolanaRuntimeNetwork {
  cluster: SolanaCluster;
  rpcUrl: string;
  wsUrl: string | null;
  programId: string;
  privyChain: SolanaPrivyChain;
  genesisHash: string | null;
  routerUrl: string;
  ephemeralRpcUrl: string | null;
}

interface DelegationStatus {
  isDelegated: boolean;
  fqdn?: string;
}

class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.payer]);
    } else {
      transaction.partialSign(this.payer);
    }
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return Promise.all(transactions.map((transaction) => this.signTransaction(transaction)));
  }
}

function accountDiscriminator(name: string): Buffer {
  const account = IDL.accounts?.find((item) => item.name === name);
  if (!account || !Array.isArray(account.discriminator) || account.discriminator.length !== 8) {
    throw new Error(`IDL missing account discriminator for ${name}`);
  }
  return Buffer.from(account.discriminator);
}

const DISCRIMINATORS = {
  Board: accountDiscriminator('Board'),
  Config: accountDiscriminator('Config'),
  Miner: accountDiscriminator('Miner'),
  Round: accountDiscriminator('Round'),
  Treasury: accountDiscriminator('Treasury'),
};

@Injectable()
export class SolanaService implements OnModuleInit {
  private readonly logger = new Logger(SolanaService.name);
  private baseConnection: Connection;
  private gameConnection: Connection;
  private adminKeypair: Keypair | null = null;
  private programId: PublicKey;
  private coder: BorshAccountsCoder;
  private runtimeCluster: SolanaCluster = 'devnet';
  private runtimeRpcUrl = '';
  private runtimeWsUrl: string | null = null;
  private runtimePrivyChain: SolanaPrivyChain = 'solana:devnet';
  private routerUrl = '';
  private configuredEphemeralRpcUrl = '';
  private configuredEphemeralWsUrl = '';
  private validator: PublicKey | null = null;
  private activeEphemeralRpcUrl: string | null = null;
  private coreDelegationReady = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.runtimeRpcUrl = this.config.getOrThrow<string>('solana.rpcUrl');
    this.runtimeWsUrl = this.config.get<string>('solana.wsUrl') ?? null;
    this.runtimeCluster = this.config.getOrThrow<SolanaCluster>('solana.cluster');
    this.runtimePrivyChain = this.config.getOrThrow<SolanaPrivyChain>('solana.privyChain');
    this.routerUrl = this.config.getOrThrow<string>('solana.routerUrl');
    this.configuredEphemeralRpcUrl = this.config.get<string>('solana.ephemeralRpcUrl') ?? '';
    this.configuredEphemeralWsUrl = this.config.get<string>('solana.ephemeralWsUrl') ?? '';
    this.programId = new PublicKey(this.config.getOrThrow<string>('solana.programId'));
    this.baseConnection = new Connection(this.runtimeRpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: this.runtimeWsUrl ?? undefined,
    });
    this.gameConnection = this.baseConnection;
    this.coder = new BorshAccountsCoder(IDL);
    this.adminKeypair = this.parseAdminKeypair(
      this.config.get<string>('solana.adminKeypair') ?? '',
    );

    const validator = this.config.get<string>('solana.validator') ?? '';
    this.validator = validator ? new PublicKey(validator) : null;
    await this.refreshGameConnection();

    this.logger.log(
      `Solana runtime ready on ${this.activeEphemeralRpcUrl ?? this.runtimeRpcUrl}`,
    );
  }

  async getRuntimeNetwork(): Promise<SolanaRuntimeNetwork> {
    const genesisHash = await this.baseConnection.getGenesisHash().catch(() => null);
    return {
      cluster: this.runtimeCluster,
      rpcUrl: this.runtimeRpcUrl,
      wsUrl: this.runtimeWsUrl,
      programId: this.programId.toBase58(),
      privyChain: this.runtimePrivyChain,
      genesisHash,
      routerUrl: this.routerUrl,
      ephemeralRpcUrl: this.activeEphemeralRpcUrl,
    };
  }

  getConnection(): Connection {
    return this.gameConnection;
  }

  getBaseConnection(): Connection {
    return this.baseConnection;
  }

  getProgramId(): PublicKey {
    return this.programId;
  }

  getVrfProgramId(): PublicKey {
    return VRF_PROGRAM_ID;
  }

  getAdminPublicKey(): PublicKey | null {
    return this.adminKeypair?.publicKey ?? null;
  }

  async getCurrentSlot(): Promise<number> {
    return this.gameConnection.getSlot('confirmed');
  }

  async refreshGameConnection(): Promise<void> {
    const [board] = getBoardPda(this.programId);
    const status = await this.getDelegationStatus(board).catch(() => null);
    const endpoint = status?.isDelegated
      ? this.normalizeEndpoint(status.fqdn || this.configuredEphemeralRpcUrl)
      : this.normalizeEndpoint(this.configuredEphemeralRpcUrl);

    if (!endpoint) {
      this.gameConnection = this.baseConnection;
      this.activeEphemeralRpcUrl = null;
      return;
    }

    if (endpoint === this.activeEphemeralRpcUrl) return;
    this.gameConnection = new Connection(endpoint, {
      commitment: 'confirmed',
      wsEndpoint: this.configuredEphemeralWsUrl || undefined,
    });
    this.activeEphemeralRpcUrl = endpoint;
  }

  async getDelegationStatus(account: PublicKey): Promise<DelegationStatus> {
    const response = await fetch(this.routerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: account.toBase58(),
        method: 'getDelegationStatus',
        params: [account.toBase58()],
      }),
    });
    if (!response.ok) {
      throw new Error(`Magic Router returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      result?: DelegationStatus;
      error?: { message?: string };
    };
    if (body.error) throw new Error(body.error.message || 'Magic Router request failed');
    if (!body.result) throw new Error('Magic Router returned no delegation status');
    return body.result;
  }

  async fetchBoard(): Promise<BoardAccount | null> {
    const [pda] = getBoardPda(this.programId);
    return this.fetchAccount<BoardAccount>('Board', pda);
  }

  async fetchRound(roundId: number): Promise<RoundAccount | null> {
    const [pda] = getRoundPda(this.programId, roundId);
    return this.fetchAccount<RoundAccount>('Round', pda);
  }

  async fetchBaseRound(roundId: number): Promise<RoundAccount | null> {
    const [pda] = getRoundPda(this.programId, roundId);
    const info = await this.baseConnection.getAccountInfo(pda, 'confirmed');
    return info ? this.decodeAccount<RoundAccount>('Round', info.data) : null;
  }

  async fetchMiner(authority: PublicKey): Promise<MinerAccount | null> {
    const [pda] = getMinerPda(this.programId, authority);
    return this.fetchAccount<MinerAccount>('Miner', pda);
  }

  async fetchTreasury(): Promise<TreasuryAccount | null> {
    const [pda] = getTreasuryPda(this.programId);
    return this.fetchAccount<TreasuryAccount>('Treasury', pda);
  }

  async fetchMinersForRound(roundId: number): Promise<RoundMinerSnapshot[]> {
    const targetRoundId = BigInt(roundId);
    const accounts = await this.gameConnection.getProgramAccounts(this.programId, {
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(DISCRIMINATORS.Miner) } }],
    });
    return accounts.flatMap(({ account }) => {
      try {
        const miner = this.decodeAccount<MinerAccount>('Miner', account.data);
        if (miner.roundId !== targetRoundId || !miner.deployed.some((value) => value > 0n)) {
          return [];
        }
        return [{ authority: miner.authority, deployed: miner.deployed }];
      } catch {
        return [];
      }
    });
  }

  decodeAccount<T>(accountName: string, data: Buffer): T {
    const decoded = this.normalizeDecodedAccount(this.coder.decode(accountName, data)) as Record<
      string,
      unknown
    >;
    return this.addCompatibilityFields(accountName, decoded) as T;
  }

  identifyAccount(data: Buffer): string | null {
    if (data.length < 8) return null;
    const discriminator = data.subarray(0, 8);
    for (const [name, expected] of Object.entries(DISCRIMINATORS)) {
      if (discriminator.equals(expected)) return name;
    }
    return null;
  }

  onProgramAccountChange(
    callback: (accountInfo: AccountInfo<Buffer>, context: Context, pubkey: PublicKey) => void,
  ): number {
    return this.gameConnection.onProgramAccountChange(
      this.programId,
      (account, context) => callback(account.accountInfo, context, account.accountId),
      'confirmed',
    );
  }

  async ensureInitialized(): Promise<void> {
    const admin = this.requireAdmin();
    const [config] = getConfigPda(this.programId);
    const [board] = getBoardPda(this.programId);
    const [treasury] = getTreasuryPda(this.programId);
    const [round] = getRoundPda(this.programId, 0);
    const accounts = await this.baseConnection.getMultipleAccountsInfo(
      [config, board, treasury, round],
      'confirmed',
    );
    const existingCount = accounts.filter(Boolean).length;
    if (existingCount === accounts.length) return;
    if (existingCount !== 0) {
      throw new Error('BlitzMine initialization is incomplete');
    }
    const program = this.getProgram(this.baseConnection, admin);
    await (program.methods as any)
      .initialize()
      .accountsPartial({ admin: admin.publicKey })
      .rpc({ commitment: 'confirmed', skipPreflight: false });
  }

  async requestLocalAirdrop(wallet: PublicKey): Promise<{
    signature: string;
    lamports: number;
  }> {
    const enabled = (process.env.LOCAL_DEV_FAUCET_ENABLED ?? '').trim() === 'true';
    if (
      !enabled ||
      process.env.NODE_ENV === 'production' ||
      !this.isLocalEndpoint(this.runtimeRpcUrl)
    ) {
      throw new Error('Local wallet funding is unavailable');
    }
    const lamports = 5_000_000_000;
    const signature = await this.baseConnection.requestAirdrop(wallet, lamports);
    const latest = await this.baseConnection.getLatestBlockhash('confirmed');
    const confirmation = await this.baseConnection.confirmTransaction(
      { signature, ...latest },
      'confirmed',
    );
    if (confirmation.value.err) {
      throw new Error(`Local wallet funding failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    return { signature, lamports };
  }

  async buildAndSendResetTx(currentRoundId: number): Promise<string> {
    const admin = this.requireAdmin();
    const [board] = getBoardPda(this.programId);
    const [currentRound] = getRoundPda(this.programId, currentRoundId);
    const [nextRound] = getRoundPda(this.programId, currentRoundId + 1);
    const [treasury] = getTreasuryPda(this.programId);
    const [programIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from('identity')],
      this.programId,
    );
    const oracleQueue = this.isLocalEndpoint(this.activeEphemeralRpcUrl)
      ? DEFAULT_EPHEMERAL_TEST_QUEUE
      : DEFAULT_EPHEMERAL_QUEUE;
    const program = this.getProgram(this.gameConnection, admin);
    return (program.methods as any)
      .requestRandomness()
      .accountsStrict({
        payer: admin.publicKey,
        board,
        currentRound,
        nextRound,
        treasury,
        oracleQueue,
        programIdentity,
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .rpc(this.transactionOptions(this.gameConnection));
  }

  async buildAndSendCancelRoundTx(currentRoundId: number): Promise<string> {
    const admin = this.requireAdmin();
    const [board] = getBoardPda(this.programId);
    const [currentRound] = getRoundPda(this.programId, currentRoundId);
    const [nextRound] = getRoundPda(this.programId, currentRoundId + 1);
    const program = this.getProgram(this.gameConnection, admin);
    return (program.methods as any)
      .cancelRound()
      .accountsStrict({ caller: admin.publicKey, board, currentRound, nextRound })
      .rpc(this.transactionOptions(this.gameConnection));
  }

  async buildAndSendCommitGameTx(roundId: number): Promise<string> {
    const admin = this.requireAdmin();
    const [board] = getBoardPda(this.programId);
    const [round] = getRoundPda(this.programId, roundId);
    const [treasury] = getTreasuryPda(this.programId);
    const program = this.getProgram(this.gameConnection, admin);
    return (program.methods as any)
      .commitGame()
      .accountsStrict({
        payer: admin.publicKey,
        board,
        round,
        treasury,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .rpc(this.transactionOptions(this.gameConnection));
  }

  async ensureRoundPreparedAndDelegated(roundId: number): Promise<void> {
    const admin = this.requireAdmin();
    const [round] = getRoundPda(this.programId, roundId);
    const [config] = getConfigPda(this.programId);
    const existing = await this.baseConnection.getAccountInfo(round, 'confirmed');
    const baseProgram = this.getProgram(this.baseConnection, admin);

    if (!existing) {
      await (baseProgram.methods as any)
        .prepareRound(new BN(roundId))
        .accountsPartial({ payer: admin.publicKey, round })
        .rpc({ commitment: 'confirmed', skipPreflight: false });
    }

    const status = await this.getDelegationStatus(round);
    if (status.isDelegated) return;

    let builder = (baseProgram.methods as any)
      .delegateRound(new BN(roundId))
      .accountsPartial({ admin: admin.publicKey, config, round });
    if (this.validator) {
      builder = builder.remainingAccounts([
        { pubkey: this.validator, isSigner: false, isWritable: false },
      ]);
    }
    await builder.rpc({ commitment: 'confirmed', skipPreflight: false });
  }

  async ensureCoreDelegated(roundId: number): Promise<void> {
    if (this.coreDelegationReady) return;
    const admin = this.requireAdmin();
    const [config] = getConfigPda(this.programId);
    const [board] = getBoardPda(this.programId);
    const [treasury] = getTreasuryPda(this.programId);
    const [round] = getRoundPda(this.programId, roundId);
    const program = this.getProgram(this.baseConnection, admin);
    const targets = [
      {
        account: treasury,
        build: () =>
          (program.methods as any)
            .delegateTreasury()
            .accountsPartial({ admin: admin.publicKey, config, treasury }),
      },
      {
        account: round,
        build: () =>
          (program.methods as any)
            .delegateRound(new BN(roundId))
            .accountsPartial({ admin: admin.publicKey, config, round }),
      },
      {
        account: board,
        build: () =>
          (program.methods as any)
            .delegateBoard()
            .accountsPartial({ admin: admin.publicKey, config, board }),
      },
    ];

    for (const target of targets) {
      const status = await this.getDelegationStatus(target.account);
      if (status.isDelegated) continue;
      let builder = target.build();
      if (this.validator) {
        builder = builder.remainingAccounts([
          { pubkey: this.validator, isSigner: false, isWritable: false },
        ]);
      }
      await builder.rpc({ commitment: 'confirmed', skipPreflight: false });
    }
    this.coreDelegationReady = true;
  }

  async buildAndSendCheckpointTx(minerAuthority: PublicKey, roundId: number): Promise<string> {
    const caller = this.requireAdmin();
    const [board] = getBoardPda(this.programId);
    const [miner] = getMinerPda(this.programId, minerAuthority);
    const [round] = getRoundPda(this.programId, roundId);
    const program = this.getProgram(this.gameConnection, caller);
    return (program.methods as any)
      .checkpoint(minerAuthority)
      .accountsStrict({ caller: caller.publicKey, board, miner, round })
      .rpc(this.transactionOptions(this.gameConnection));
  }

  async buildAndSendCloseTx(_roundId: number, _rentPayer: PublicKey): Promise<string> {
    throw new Error('Round closure is disabled until delegated account closure is finalized');
  }

  async buildAndSendMineTx(_minerAuthority: PublicKey, _roundId: number): Promise<string> {
    throw new Error('Server-side mining is disabled; deploy transactions require the miner signature');
  }

  private async fetchAccount<T>(accountName: string, pubkey: PublicKey): Promise<T | null> {
    let info = await this.gameConnection.getAccountInfo(pubkey, 'confirmed');
    if (!info && this.gameConnection !== this.baseConnection) {
      info = await this.baseConnection.getAccountInfo(pubkey, 'confirmed');
    }
    return info ? this.decodeAccount<T>(accountName, info.data) : null;
  }

  private getProgram(connection: Connection, keypair: Keypair): Program {
    const provider = new AnchorProvider(connection, new KeypairWallet(keypair), {
      commitment: 'confirmed' as Commitment,
      preflightCommitment: 'confirmed' as Commitment,
    });
    return new Program(IDL, provider);
  }

  private requireAdmin(): Keypair {
    if (!this.adminKeypair) throw new Error('ADMIN_KEYPAIR is required for lifecycle transactions');
    return this.adminKeypair;
  }

  private parseAdminKeypair(value: string): Keypair | null {
    if (!value.trim()) return null;
    try {
      const bytes = value.trim().startsWith('[')
        ? Uint8Array.from(JSON.parse(value) as number[])
        : bs58.decode(value.trim());
      return Keypair.fromSecretKey(bytes);
    } catch {
      throw new Error('ADMIN_KEYPAIR must be a base58 secret key or JSON byte array');
    }
  }

  private normalizeEndpoint(value: string | undefined): string | null {
    const endpoint = value?.trim();
    if (!endpoint) return null;
    return endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : `https://${endpoint}`;
  }

  private isLocalEndpoint(value: string | null): boolean {
    return Boolean(value && (value.includes('localhost') || value.includes('127.0.0.1')));
  }

  private transactionOptions(connection: Connection): {
    commitment: Commitment;
    skipPreflight: boolean;
  } {
    const isLocalEphemeral =
      this.isLocalEndpoint(connection.rpcEndpoint) &&
      connection.rpcEndpoint !== this.baseConnection.rpcEndpoint;
    return {
      commitment: 'confirmed',
      skipPreflight: isLocalEphemeral,
    };
  }

  private normalizeDecodedAccount(value: unknown): unknown {
    if (typeof value === 'number') return value;
    const bigint = tryU64LikeToBigInt(value);
    if (bigint !== null) return bigint;
    if (Array.isArray(value)) return value.map((item) => this.normalizeDecodedAccount(item));
    if (!value || typeof value !== 'object') return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()),
        this.normalizeDecodedAccount(item),
      ]),
    );
  }

  private addCompatibilityFields(
    accountName: string,
    decoded: Record<string, unknown>,
  ): Record<string, unknown> {
    if (accountName === 'Board') {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const endTs = decoded.endTs as bigint;
      const intermissionEndTs = decoded.intermissionEndTs as bigint;
      const vrfRequested = decoded.vrfRequested === true;
      return {
        ...decoded,
        startSlot: decoded.startTs,
        endSlot: decoded.endTs,
        currentSlot: now,
        canDeploy:
          now >= intermissionEndTs &&
          !vrfRequested &&
          (endTs === 9223372036854775807n || now < endTs),
        requiresCheckpoint: vrfRequested || (endTs !== 9223372036854775807n && now >= endTs),
        vrfAccount: PublicKey.default,
      };
    }
    if (accountName === 'Round') {
      return {
        ...decoded,
        slotHash: decoded.randomness,
        topMiner: PublicKey.default,
        topMinerReward: 0n,
      };
    }
    return decoded;
  }
}
