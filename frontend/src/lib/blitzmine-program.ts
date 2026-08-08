import {
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

const programId = new PublicKey(PROGRAM_ID);
const delegationProgramId = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const magicProgramId = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
const magicContextId = new PublicKey(
  "MagicContext1111111111111111111111111111111",
);
const localValidatorId = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);
const systemProgramId = SystemProgram.programId;
const textEncoder = new TextEncoder();
const u64Max = BigInt("18446744073709551615");
const minerDiscriminator = Uint8Array.from([
  223, 113, 15, 54, 123, 122, 140, 100,
]);
const fundMinerDiscriminator = Uint8Array.from([
  60, 175, 6, 99, 192, 119, 247, 73,
]);
const delegateMinerDiscriminator = Uint8Array.from([
  147, 64, 185, 95, 175, 41, 244, 201,
]);
const deployDiscriminator = Uint8Array.from([
  67, 36, 143, 118, 36, 164, 92, 217,
]);
const checkpointDiscriminator = Uint8Array.from([
  213, 200, 19, 204, 240, 143, 184, 252,
]);
const undelegateMinerDiscriminator = Uint8Array.from([
  45, 173, 155, 21, 123, 96, 109, 93,
]);
const claimSolDiscriminator = Uint8Array.from([
  139, 113, 179, 189, 190, 30, 132, 195,
]);
const programValidation = new Map<string, Promise<void>>();

export interface MinerState {
  authority: PublicKey;
  checkpointFee: bigint;
  checkpointId: bigint;
  rewardsSol: bigint;
  roundId: bigint;
  transactionNonce: bigint;
}

export interface DelegationStatus {
  isDelegated: boolean;
  fqdn?: string;
}

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function instructionData(data: Uint8Array): Buffer {
  return data as unknown as Buffer;
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function assertU64(value: bigint | number | string): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < BigInt(0) || parsed > u64Max)
    throw new Error("u64 value out of range");
  return parsed;
}

export function u64ToLeBytes(value: bigint | number | string): Uint8Array {
  let remaining = assertU64(value);
  const output = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1) {
    output[index] = Number(remaining & BigInt(255));
    remaining >>= BigInt(8);
  }
  return output;
}

export function getBoardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([bytes("board")], programId);
}

export function getRoundPda(roundId: number | bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [bytes("round"), u64ToLeBytes(roundId)],
    programId,
  );
}

export function getMinerPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [bytes("miner"), authority.toBytes()],
    programId,
  );
}

function getBufferMinerPda(miner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [bytes("buffer"), miner.toBytes()],
    programId,
  )[0];
}

function getDelegationRecordPda(miner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [bytes("delegation"), miner.toBytes()],
    delegationProgramId,
  )[0];
}

function getDelegationMetadataPda(miner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [bytes("delegation-metadata"), miner.toBytes()],
    delegationProgramId,
  )[0];
}

async function assertProgramAccountExists(
  connection: Connection,
): Promise<void> {
  const endpoint = connection.rpcEndpoint;
  const existing = programValidation.get(endpoint);
  if (existing) return existing;
  const validation = connection
    .getAccountInfo(programId, "confirmed")
    .then((account) => {
      if (!account)
        throw new Error(`BlitzMine program is not available on ${endpoint}`);
    })
    .catch((error) => {
      programValidation.delete(endpoint);
      throw error;
    });
  programValidation.set(endpoint, validation);
  return validation;
}

async function buildTransaction(
  signer: PublicKey,
  connection: Connection,
  instructions: TransactionInstruction[],
): Promise<VersionedTransaction> {
  await assertProgramAccountExists(connection);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function buildFundMinerInstruction(
  authority: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [miner] = getMinerPda(authority);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: miner, isSigner: false, isWritable: true },
      { pubkey: systemProgramId, isSigner: false, isWritable: false },
    ],
    data: instructionData(
      concatBytes(fundMinerDiscriminator, u64ToLeBytes(amount)),
    ),
  });
}

export function buildDelegateMinerInstruction(
  authority: PublicKey,
  validator?: PublicKey,
): TransactionInstruction {
  const [miner] = getMinerPda(authority);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: getBufferMinerPda(miner), isSigner: false, isWritable: true },
      {
        pubkey: getDelegationRecordPda(miner),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: getDelegationMetadataPda(miner),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: miner, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: delegationProgramId, isSigner: false, isWritable: false },
      { pubkey: systemProgramId, isSigner: false, isWritable: false },
      ...(validator
        ? [{ pubkey: validator, isSigner: false, isWritable: false }]
        : []),
    ],
    data: instructionData(delegateMinerDiscriminator),
  });
}

export function buildDeployInstruction(
  signer: PublicKey,
  board: PublicKey,
  round: PublicKey,
  miner: PublicKey,
  amount: bigint,
  mask: bigint,
  expectedNonce: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: board, isSigner: false, isWritable: true },
      { pubkey: round, isSigner: false, isWritable: true },
      { pubkey: miner, isSigner: false, isWritable: true },
    ],
    data: instructionData(
      concatBytes(
        deployDiscriminator,
        u64ToLeBytes(amount),
        u64ToLeBytes(mask),
        u64ToLeBytes(expectedNonce),
      ),
    ),
  });
}

export function buildCheckpointInstruction(
  caller: PublicKey,
  minerAuthority: PublicKey,
  roundId: bigint,
): TransactionInstruction {
  const [board] = getBoardPda();
  const [miner] = getMinerPda(minerAuthority);
  const [round] = getRoundPda(roundId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: board, isSigner: false, isWritable: false },
      { pubkey: miner, isSigner: false, isWritable: true },
      { pubkey: round, isSigner: false, isWritable: true },
    ],
    data: instructionData(
      concatBytes(checkpointDiscriminator, minerAuthority.toBytes()),
    ),
  });
}

export function buildUndelegateMinerInstruction(
  authority: PublicKey,
): TransactionInstruction {
  const [miner] = getMinerPda(authority);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: miner, isSigner: false, isWritable: true },
      { pubkey: magicProgramId, isSigner: false, isWritable: false },
      { pubkey: magicContextId, isSigner: false, isWritable: true },
    ],
    data: instructionData(undelegateMinerDiscriminator),
  });
}

export function buildClaimSolInstruction(
  authority: PublicKey,
): TransactionInstruction {
  const [miner] = getMinerPda(authority);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: miner, isSigner: false, isWritable: true },
    ],
    data: instructionData(claimSolDiscriminator),
  });
}

export function buildFundMinerTransaction(
  authority: PublicKey,
  amount: bigint,
  connection: Connection,
): Promise<VersionedTransaction> {
  return buildTransaction(authority, connection, [
    buildFundMinerInstruction(authority, amount),
  ]);
}

export function buildDelegateMinerTransaction(
  authority: PublicKey,
  connection: Connection,
): Promise<VersionedTransaction> {
  const validator =
    connection.rpcEndpoint.includes("localhost") ||
    connection.rpcEndpoint.includes("127.0.0.1")
      ? localValidatorId
      : undefined;
  return buildTransaction(authority, connection, [
    buildDelegateMinerInstruction(authority, validator),
  ]);
}

export function buildDeployTransaction(
  authority: PublicKey,
  roundId: number,
  amount: bigint,
  mask: bigint,
  expectedNonce: bigint,
  connection: Connection,
): Promise<VersionedTransaction> {
  const [board] = getBoardPda();
  const [round] = getRoundPda(roundId);
  const [miner] = getMinerPda(authority);
  return buildTransaction(authority, connection, [
    buildDeployInstruction(
      authority,
      board,
      round,
      miner,
      amount,
      mask,
      expectedNonce,
    ),
  ]);
}

export function buildCheckpointTransaction(
  authority: PublicKey,
  roundId: bigint,
  connection: Connection,
): Promise<VersionedTransaction> {
  return buildTransaction(authority, connection, [
    buildCheckpointInstruction(authority, authority, roundId),
  ]);
}

export function buildUndelegateMinerTransaction(
  authority: PublicKey,
  connection: Connection,
): Promise<VersionedTransaction> {
  return buildTransaction(authority, connection, [
    buildUndelegateMinerInstruction(authority),
  ]);
}

export function buildClaimSolTransaction(
  authority: PublicKey,
  connection: Connection,
): Promise<VersionedTransaction> {
  return buildTransaction(authority, connection, [
    buildClaimSolInstruction(authority),
  ]);
}

export async function fetchMinerState(
  connection: Connection,
  authority: PublicKey,
): Promise<MinerState | null> {
  const [miner] = getMinerPda(authority);
  const account = await connection.getAccountInfo(miner, "confirmed");
  if (!account) return null;
  const data = account.data;
  if (data.length < 305) throw new Error("Miner account data is incomplete");
  for (let index = 0; index < minerDiscriminator.length; index += 1) {
    if (data[index] !== minerDiscriminator[index])
      throw new Error("Invalid miner account");
  }
  return {
    authority: new PublicKey(data.subarray(8, 40)),
    checkpointFee: readU64(data, 240),
    checkpointId: readU64(data, 248),
    rewardsSol: readU64(data, 264),
    roundId: readU64(data, 272),
    transactionNonce: readU64(data, 296),
  };
}

export async function getDelegationStatus(
  routerUrl: string,
  account: PublicKey,
): Promise<DelegationStatus> {
  const response = await fetch(routerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: account.toBase58(),
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  if (!response.ok)
    throw new Error(`Magic Router returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    result?: DelegationStatus;
    error?: { message?: string };
  };
  if (payload.error)
    throw new Error(payload.error.message ?? "Magic Router request failed");
  if (!payload.result)
    throw new Error("Magic Router returned no delegation status");
  return payload.result;
}

export function normalizeEphemeralEndpoint(
  value: string | null | undefined,
): string | null {
  const endpoint = value?.trim();
  if (!endpoint) return null;
  return endpoint.startsWith("http://") || endpoint.startsWith("https://")
    ? endpoint
    : `https://${endpoint}`;
}
