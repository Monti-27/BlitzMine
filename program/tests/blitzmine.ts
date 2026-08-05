import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import * as fs from "fs";
import { Blitzmine } from "../target/types/blitzmine";

describe("blitzmine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Blitzmine as Program<Blitzmine>;
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          `${__dirname}/../blitzmine-authority-keypair.json`,
          "utf-8",
        ),
      ),
    ),
  );
  const player = Keypair.generate();
  const fundedAmount = new anchor.BN(250_000_000);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [boardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("board")],
    program.programId,
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId,
  );
  const roundPda = (roundId: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("round"),
        new anchor.BN(roundId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];
  const [minerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("miner"), player.publicKey.toBuffer()],
    program.programId,
  );

  before(async () => {
    for (const recipient of [authority.publicKey, player.publicKey]) {
      const signature = await provider.connection.requestAirdrop(
        recipient,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
  });

  it("initializes the game", async () => {
    await program.methods
      .initialize()
      .accounts({ admin: authority.publicKey })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const config = await program.account.config.fetch(configPda);
    const board = await program.account.board.fetch(boardPda);
    const treasury = await program.account.treasury.fetch(treasuryPda);
    const round = await program.account.round.fetch(roundPda(0));

    assert.isTrue(config.initialized);
    assert.equal(config.admin.toBase58(), authority.publicKey.toBase58());
    assert.equal(board.roundId.toNumber(), 0);
    assert.equal(board.endTs.toString(), new anchor.BN(2).pow(new anchor.BN(63)).subn(1).toString());
    assert.isFalse(board.vrfRequested);
    assert.isFalse(board.vrfFulfilled);
    assert.equal(treasury.motherlode.toNumber(), 0);
    assert.equal(treasury.adminFees.toNumber(), 0);
    assert.equal(round.id.toNumber(), 0);
    assert.isFalse(round.resolved);
  });

  it("prepares the next round", async () => {
    await program.methods
      .prepareRound(new anchor.BN(1))
      .accounts({ payer: authority.publicKey })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const round = await program.account.round.fetch(roundPda(1));
    assert.equal(round.id.toNumber(), 1);
    assert.equal(round.rentPayer.toBase58(), authority.publicKey.toBase58());
    assert.equal(round.totalDeployed.toNumber(), 0);
  });

  it("funds a miner before delegation", async () => {
    await program.methods
      .fundMiner(fundedAmount)
      .accounts({ authority: player.publicKey })
      .signers([player])
      .rpc({ commitment: "confirmed" });

    const miner = await program.account.miner.fetch(minerPda);
    const accountBalance = await provider.connection.getBalance(minerPda);
    const rent = await provider.connection.getMinimumBalanceForRentExemption(
      program.account.miner.size,
    );

    assert.equal(miner.authority.toBase58(), player.publicKey.toBase58());
    assert.equal(miner.rewardsSol.toString(), fundedAmount.toString());
    assert.equal(miner.checkpointFee.toNumber(), 10_000);
    assert.equal(miner.transactionNonce.toNumber(), 0);
    assert.equal(miner.roundId.toString(), new anchor.BN(2).pow(new anchor.BN(64)).subn(1).toString());
    assert.equal(accountBalance, rent + fundedAmount.toNumber() + 10_000);
  });
});
