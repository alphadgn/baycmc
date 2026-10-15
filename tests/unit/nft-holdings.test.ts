import { describe, expect, it } from "vitest";
import { holdingsFromTransfers } from "@/server/nft-holdings.server";

describe("holdingsFromTransfers", () => {
  it("keeps tokens received and not sent away later", () => {
    const held = holdingsFromTransfers([
      { id: 1n, in: true },
      { id: 2n, in: true },
      { id: 1n, in: false }, // sold
      { id: 3n, in: true },
      { id: 1n, in: true }, // bought back
    ]);
    expect([...held].sort()).toEqual([1n, 2n, 3n].sort());
  });
});
