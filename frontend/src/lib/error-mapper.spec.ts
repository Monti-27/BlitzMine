import { describe, expect, it } from "bun:test";
import { mapMiningErrorMessage } from "./error-mapper";

describe("mapMiningErrorMessage", () => {
  it("maps checkpoint-required anchors to user-safe message", () => {
    expect(
      mapMiningErrorMessage(
        new Error("AnchorError: CheckpointRequired code=6006"),
        "fallback",
      ),
    ).toBe("Finalizing previous round. Please wait.");

    expect(
      mapMiningErrorMessage(
        new Error("custom program error: 0x1776"),
        "fallback",
      ),
    ).toBe("Finalizing previous round. Please wait.");
  });
});
