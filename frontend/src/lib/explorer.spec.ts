import { describe, expect, it } from "bun:test";
import { buildTransactionExplorerUrl } from "./explorer";

describe("buildTransactionExplorerUrl", () => {
  it("targets the ephemeral RPC as a custom cluster", () => {
    expect(
      buildTransactionExplorerUrl(
        "resolution-signature",
        "devnet",
        "http://127.0.0.1:7799",
      ),
    ).toBe(
      "https://explorer.solana.com/tx/resolution-signature?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A7799",
    );
  });

  it("falls back to the configured public cluster", () => {
    expect(buildTransactionExplorerUrl("signature", "devnet")).toBe(
      "https://explorer.solana.com/tx/signature?cluster=devnet",
    );
    expect(buildTransactionExplorerUrl("signature", "mainnet")).toBe(
      "https://explorer.solana.com/tx/signature",
    );
  });
});
