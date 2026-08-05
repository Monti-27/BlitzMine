import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { Blitzmine } from "../target/types/blitzmine";
import idl from "../target/idl/blitzmine.json";

const BASE_RPC = process.env.BASE_RPC_URL ?? "http://127.0.0.1:8899";
const BASE_WS = process.env.BASE_WS_URL ?? "ws://127.0.0.1:8900";
const EPHEMERAL_RPC =
  process.env.EPHEMERAL_RPC_URL ?? "http://127.0.0.1:7799";
const EPHEMERAL_WS =
  process.env.EPHEMERAL_WS_URL ?? "ws://127.0.0.1:7800";
const ROUTER_RPC = process.env.ROUTER_RPC_URL ?? "http://127.0.0.1:6699";
const LOCAL_VALIDATOR = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);
const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const LOCAL_VRF_QUEUE = new PublicKey(
  "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT",
);
const ALL_SQUARES = new BN((1n << 25n) - 1n);
const FUNDED_AMOUNT = new BN(200_000_000);
const AMOUNT_PER_SQUARE = new BN(1_000_000);
const TOTAL_DEPLOYED_PER_MINER = AMOUNT_PER_SQUARE.muln(25);
const PROGRAM_ID = new PublicKey(
  "CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F",
);

type CycleSignatures = Record<string, string | string[]>;

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      lastValue = await read();
      if (ready(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }

  throw new Error(
    `${label} timed out: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastValue)}`,
  );
}

async function confirmAirdrop(
  connection: Connection,
  recipient: PublicKey,
  lamports: number,
) {
  const signature = await connection.requestAirdrop(recipient, lamports);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}

async function getDelegationStatus(account: PublicKey) {
  const response = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: account.toBase58(),
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message: string };
    result?: { isDelegated?: boolean; fqdn?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `router returned ${response.status}`);
  }
  return payload.result ?? { isDelegated: false };
}

async function getChainTime(connection: Connection) {
  const account = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!account || account.data.length < 40) {
    throw new Error("Clock sysvar is unavailable");
  }
  return Number(account.data.readBigInt64LE(32));
}

async function sendEphemeralTransaction(
  connection: Connection,
  transaction: Transaction,
  feePayer: Keypair,
  signers: Keypair[] = [],
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = feePayer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const uniqueSigners = [feePayer, ...signers].filter(
    (signer, index, values) =>
      values.findIndex((value) => value.publicKey.equals(signer.publicKey)) ===
      index,
  );
  transaction.partialSign(...uniqueSigners);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: true, preflightCommitment: "confirmed" },
  );
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err) {
    const executed = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    throw new Error(
      `Ephemeral transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}\n${executed?.meta?.logMessages?.join("\n") ?? "No transaction logs"}`,
    );
  }
  return signature;
}

function pda(seed: string, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];
}

function roundPda(roundId: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round"), new BN(roundId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

function minerPda(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("miner"), authority.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function expectedReward(round: {
  motherlode: BN;
  totalDeployed: BN;
  deployed: BN[];
  randomness: number[];
  id: BN;
}) {
  const total = BigInt(round.totalDeployed.toString());
  const winningDeployed = BigInt(round.deployed[0].toString());
  const adminFee = (total * 100n) / 10_000n;
  const adminFromWinning = (adminFee * winningDeployed) / total;
  const adminFromLosing = adminFee - adminFromWinning;
  const winningsPool = total - winningDeployed - adminFromLosing;
  const vaulted = (winningsPool * 1_000n) / 10_000n;
  const principal = winningDeployed - adminFromWinning;
  const winnings = winningsPool - vaulted;
  const motherlode = BigInt(round.motherlode.toString());
  return (principal + winnings + motherlode) / 2n;
}

describe("blitzmine full local cycle", () => {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          process.env.ADMIN_KEYPAIR_PATH ??
            path.join(__dirname, "..", "blitzmine-authority-keypair.json"),
          "utf8",
        ),
      ),
    ),
  );
  const players = [Keypair.generate(), Keypair.generate()];
  const baseConnection = new Connection(BASE_RPC, {
    commitment: "confirmed",
    wsEndpoint: BASE_WS,
  });
  const ephemeralConnection = new Connection(EPHEMERAL_RPC, {
    commitment: "confirmed",
    wsEndpoint: EPHEMERAL_WS,
  });
  const wallet = new anchor.Wallet(authority);
  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const ephemeralProvider = new AnchorProvider(ephemeralConnection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const baseProgram = new Program<Blitzmine>(idl as Blitzmine, baseProvider);
  const ephemeralProgram = new Program<Blitzmine>(
    idl as Blitzmine,
    ephemeralProvider,
  );
  const config = pda("config");
  const board = pda("board");
  const treasury = pda("treasury");
  const currentRound = roundPda(0);
  const nextRound = roundPda(1);
  const miners = players.map((player) => minerPda(player.publicKey));
  const signatures: CycleSignatures = {};

  it("runs delegation, mining, VRF, settlement, commit, undelegation, and claim", async () => {
    signatures.airdrops = await Promise.all(
      [authority, ...players].map((keypair) =>
        confirmAirdrop(
          baseConnection,
          keypair.publicKey,
          10 * anchor.web3.LAMPORTS_PER_SOL,
        ),
      ),
    );

    signatures.initialize = await baseProgram.methods
      .initialize()
      .accountsPartial({ admin: authority.publicKey })
      .signers([authority])
      .rpc();

    signatures.prepareRound = await baseProgram.methods
      .prepareRound(new BN(1))
      .accountsPartial({ payer: authority.publicKey })
      .signers([authority])
      .rpc();

    signatures.fundMiners = await Promise.all(
      players.map((player) =>
        baseProgram.methods
          .fundMiner(FUNDED_AMOUNT)
          .accountsPartial({ authority: player.publicKey })
          .signers([player])
          .rpc(),
      ),
    );

    const validatorAccount = {
      pubkey: LOCAL_VALIDATOR,
      isSigner: false,
      isWritable: false,
    };

    signatures.delegateGame = [
      await baseProgram.methods
        .delegateBoard()
        .accountsPartial({ admin: authority.publicKey, config, board })
        .remainingAccounts([validatorAccount])
        .signers([authority])
        .rpc(),
      await baseProgram.methods
        .delegateTreasury()
        .accountsPartial({ admin: authority.publicKey, config, treasury })
        .remainingAccounts([validatorAccount])
        .signers([authority])
        .rpc(),
      await baseProgram.methods
        .delegateRound(new BN(0))
        .accountsPartial({
          admin: authority.publicKey,
          config,
          round: currentRound,
        })
        .remainingAccounts([validatorAccount])
        .signers([authority])
        .rpc(),
      await baseProgram.methods
        .delegateRound(new BN(1))
        .accountsPartial({
          admin: authority.publicKey,
          config,
          round: nextRound,
        })
        .remainingAccounts([validatorAccount])
        .signers([authority])
        .rpc(),
    ];

    signatures.delegateMiners = [];
    for (let index = 0; index < players.length; index += 1) {
      const signature = await baseProgram.methods
        .delegateMiner()
        .accountsPartial({
          authority: players[index].publicKey,
          miner: miners[index],
        })
        .remainingAccounts([validatorAccount])
        .signers([players[index]])
        .rpc();
      (signatures.delegateMiners as string[]).push(signature);
    }

    await Promise.all(
      [board, treasury, currentRound, nextRound, ...miners].map((account) =>
        waitFor(
          `delegation ${account.toBase58()}`,
          () => getDelegationStatus(account),
          (status) => status.isDelegated === true,
        ),
      ),
    );

    for (const account of [board, treasury, currentRound, nextRound, ...miners]) {
      const baseAccount = await baseConnection.getAccountInfo(account, "confirmed");
      const ephemeralAccount = await ephemeralConnection.getAccountInfo(
        account,
        "confirmed",
      );
      assert.equal(baseAccount?.owner.toBase58(), DELEGATION_PROGRAM.toBase58());
      assert.equal(ephemeralAccount?.owner.toBase58(), PROGRAM_ID.toBase58());
    }

    const boardBeforeDeploy = await ephemeralProgram.account.board.fetch(board);
    assert.equal(boardBeforeDeploy.roundId.toNumber(), 0);
    assert.equal(boardBeforeDeploy.startTs.toNumber(), 0);
    assert.equal(boardBeforeDeploy.endTs.toString(), "9223372036854775807");
    assert.equal(boardBeforeDeploy.intermissionEndTs.toNumber(), 0);

    const deployTransaction = new Transaction();
    for (let index = 0; index < players.length; index += 1) {
      const transaction = await ephemeralProgram.methods
        .deploy(AMOUNT_PER_SQUARE, ALL_SQUARES, new BN(0))
        .accountsPartial({
          signer: players[index].publicKey,
          board,
          round: currentRound,
          miner: miners[index],
        })
        .transaction();
      deployTransaction.add(...transaction.instructions);
    }
    signatures.deploy = await sendEphemeralTransaction(
      ephemeralConnection,
      deployTransaction,
      players[0],
      [players[1]],
    );

    let staleNonceRejected = false;
    try {
      const transaction = await ephemeralProgram.methods
        .deploy(AMOUNT_PER_SQUARE, ALL_SQUARES, new BN(0))
        .accountsPartial({
          signer: players[0].publicKey,
          board,
          round: currentRound,
          miner: miners[0],
        })
        .transaction();
      await sendEphemeralTransaction(
        ephemeralConnection,
        transaction,
        players[0],
      );
    } catch (error) {
      staleNonceRejected = String(error).includes("Invalid transaction nonce");
    }
    assert.isTrue(staleNonceRejected);

    const deployedRound = await ephemeralProgram.account.round.fetch(currentRound);
    assert.equal(
      deployedRound.totalDeployed.toString(),
      TOTAL_DEPLOYED_PER_MINER.muln(2).toString(),
    );
    assert.equal(deployedRound.totalMiners.toNumber(), 2);
    deployedRound.deployed.forEach((amount) =>
      assert.equal(amount.toString(), AMOUNT_PER_SQUARE.muln(2).toString()),
    );

    const activeBoard = await ephemeralProgram.account.board.fetch(board);
    const roundEndsAt = activeBoard.endTs.toNumber();
    await waitFor(
      "round deadline",
      () => getChainTime(ephemeralConnection),
      (chainTime) => chainTime >= roundEndsAt,
      90_000,
      250,
    );

    const randomnessTransaction = await ephemeralProgram.methods
      .requestRandomness()
      .accountsPartial({
        payer: authority.publicKey,
        board,
        currentRound,
        nextRound,
        treasury,
        oracleQueue: LOCAL_VRF_QUEUE,
      })
      .transaction();
    signatures.randomnessRequest = await sendEphemeralTransaction(
      ephemeralConnection,
      randomnessTransaction,
      authority,
    );

    const resolvedRound = await waitFor(
      "VRF callback",
      () => ephemeralProgram.account.round.fetch(currentRound),
      (round) => round.resolved,
      45_000,
    );
    const advancedBoard = await ephemeralProgram.account.board.fetch(board);
    assert.equal(advancedBoard.roundId.toNumber(), 1);
    assert.isFalse(resolvedRound.canceled);
    assert.isAbove(resolvedRound.randomness.filter((byte) => byte !== 0).length, 0);

    const payoutPerMiner = expectedReward(resolvedRound);
    signatures.checkpoint = [];
    for (let index = 0; index < players.length; index += 1) {
      const transaction = await ephemeralProgram.methods
        .checkpoint(players[index].publicKey)
        .accountsPartial({
          caller: players[index].publicKey,
          board,
          miner: miners[index],
          round: currentRound,
        })
        .transaction();
      const signature = await sendEphemeralTransaction(
        ephemeralConnection,
        transaction,
        players[index],
      );
      (signatures.checkpoint as string[]).push(signature);
    }

    const checkpointedMiners = await Promise.all(
      miners.map((miner) => ephemeralProgram.account.miner.fetch(miner)),
    );
    const expectedMinerBalance =
      BigInt(FUNDED_AMOUNT.sub(TOTAL_DEPLOYED_PER_MINER).toString()) +
      payoutPerMiner;
    checkpointedMiners.forEach((miner) => {
      assert.equal(miner.checkpointId.toNumber(), 0);
      assert.equal(miner.roundId.toNumber(), 0);
      assert.equal(miner.rewardsSol.toString(), expectedMinerBalance.toString());
    });

    const commitGameTransaction = await ephemeralProgram.methods
      .commitGame()
      .accountsPartial({
        payer: authority.publicKey,
        board,
        round: currentRound,
        treasury,
      })
      .transaction();
    signatures.commitGame = await sendEphemeralTransaction(
      ephemeralConnection,
      commitGameTransaction,
      authority,
    );

    await waitFor(
      "game commit",
      () => baseProgram.account.board.fetch(board),
      (value) => value.roundId.toNumber() === 1,
      60_000,
    );

    const commitCheckpointTransaction = await ephemeralProgram.methods
      .commitCheckpoint()
      .accountsPartial({
        authority: players[1].publicKey,
        miner: miners[1],
        round: currentRound,
      })
      .transaction();
    signatures.commitCheckpoint = await sendEphemeralTransaction(
      ephemeralConnection,
      commitCheckpointTransaction,
      players[1],
    );

    await waitFor(
      "miner commit",
      () => baseProgram.account.miner.fetch(miners[1]),
      (value) => value.checkpointId.toNumber() === 0,
      60_000,
    );

    const undelegateTransaction = await ephemeralProgram.methods
      .undelegateMiner()
      .accountsPartial({
        authority: players[0].publicKey,
        miner: miners[0],
      })
      .transaction();
    signatures.undelegateMiner = await sendEphemeralTransaction(
      ephemeralConnection,
      undelegateTransaction,
      players[0],
    );

    await waitFor(
      "miner undelegation",
      () => getDelegationStatus(miners[0]),
      (status) => status.isDelegated === false,
      60_000,
    );
    const undelegatedAccount = await waitFor(
      "base miner restoration",
      () => baseConnection.getAccountInfo(miners[0], "confirmed"),
      (account) => account?.owner.equals(PROGRAM_ID) === true,
      60_000,
    );
    assert.equal(undelegatedAccount?.owner.toBase58(), PROGRAM_ID.toBase58());

    const baseMinerBeforeClaim = await baseProgram.account.miner.fetch(miners[0]);
    assert.equal(
      baseMinerBeforeClaim.rewardsSol.toString(),
      expectedMinerBalance.toString(),
    );
    const playerBalanceBefore = await baseConnection.getBalance(
      players[0].publicKey,
      "confirmed",
    );
    signatures.claim = await baseProgram.methods
      .claimSol()
      .accountsPartial({
        authority: players[0].publicKey,
        miner: miners[0],
      })
      .signers([players[0]])
      .rpc();
    const playerBalanceAfter = await baseConnection.getBalance(
      players[0].publicKey,
      "confirmed",
    );
    assert.equal(
      BigInt(playerBalanceAfter - playerBalanceBefore).toString(),
      expectedMinerBalance.toString(),
    );
    const baseMinerAfterClaim = await baseProgram.account.miner.fetch(miners[0]);
    assert.equal(baseMinerAfterClaim.rewardsSol.toNumber(), 0);
    assert.isTrue((await getDelegationStatus(miners[1])).isDelegated === true);

    const resultDirectory = path.join(__dirname, "..", ".local-e2e");
    fs.mkdirSync(resultDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(resultDirectory, "result.json"),
      `${JSON.stringify(
        {
          passedAt: new Date().toISOString(),
          programId: PROGRAM_ID.toBase58(),
          players: players.map((player) => player.publicKey.toBase58()),
          round: 0,
          totalDeployed: resolvedRound.totalDeployed.toString(),
          payoutPerMiner: payoutPerMiner.toString(),
          motherlode: resolvedRound.motherlode.toString(),
          signatures,
        },
        null,
        2,
      )}\n`,
    );
  });
});
