import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  buildCheckpointInstruction,
  buildDelegateMinerInstruction,
  buildDeployInstruction,
  buildFundMinerInstruction,
  getMinerPda,
  getRoundPda,
  u64ToLeBytes,
} from "./blitzmine-program";
import { PROGRAM_ID } from "./constants";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("blitzmine-program encoding", () => {
  it("encodes u64 values into deterministic little-endian bytes", () => {
    assert.equal(toHex(u64ToLeBytes(0)), "0000000000000000");
    assert.equal(toHex(u64ToLeBytes(1)), "0100000000000000");
    assert.equal(toHex(u64ToLeBytes(4_294_967_295)), "ffffffff00000000");
    assert.equal(
      toHex(u64ToLeBytes(9_007_199_254_740_991)),
      "ffffffffffff1f00",
    );
    assert.equal(
      toHex(u64ToLeBytes(BigInt("18446744073709551615"))),
      "ffffffffffffffff",
    );
  });

  it("encodes the replay-protected deploy payload", () => {
    const key = new PublicKey("11111111111111111111111111111111");
    const instruction = buildDeployInstruction(
      key,
      key,
      key,
      key,
      BigInt(1),
      BigInt(3),
      BigInt(9),
    );

    assert.equal(instruction.data.length, 32);
    assert.deepEqual(
      Array.from(instruction.data.subarray(0, 8)),
      [67, 36, 143, 118, 36, 164, 92, 217],
    );
    assert.equal(toHex(instruction.data.subarray(8, 16)), "0100000000000000");
    assert.equal(toHex(instruction.data.subarray(16, 24)), "0300000000000000");
    assert.equal(toHex(instruction.data.subarray(24, 32)), "0900000000000000");
  });

  it("derives round PDAs from explicit u64 seeds", () => {
    const roundId = 42;
    const [derived] = getRoundPda(roundId);
    const [expected] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("round"), u64ToLeBytes(roundId)],
      new PublicKey(PROGRAM_ID),
    );

    assert.equal(derived.toBase58(), expected.toBase58());
  });

  it("builds the complete session account flow", () => {
    const authority = new PublicKey("11111111111111111111111111111111");
    const [miner] = getMinerPda(authority);
    const fund = buildFundMinerInstruction(authority, BigInt(10));
    const delegate = buildDelegateMinerInstruction(authority);
    const checkpoint = buildCheckpointInstruction(
      authority,
      authority,
      BigInt(7),
    );

    assert.equal(fund.keys.length, 3);
    assert.equal(fund.keys[1].pubkey.toBase58(), miner.toBase58());
    assert.equal(delegate.keys.length, 8);
    assert.equal(delegate.keys[4].pubkey.toBase58(), miner.toBase58());
    assert.equal(checkpoint.keys.length, 4);
    assert.equal(checkpoint.data.length, 40);
    assert.equal(checkpoint.keys[2].pubkey.toBase58(), miner.toBase58());
  });

  it("routes local delegation to the local validator", () => {
    const authority = new PublicKey("11111111111111111111111111111111");
    const validator = new PublicKey(
      "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    );
    const delegate = buildDelegateMinerInstruction(authority, validator);

    assert.equal(delegate.keys.length, 9);
    assert.equal(delegate.keys[8].pubkey.toBase58(), validator.toBase58());
  });
});
