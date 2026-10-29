import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_COLLECTIONS,
  CHAIN_APECHAIN,
  CHAIN_ETHEREUM,
  CHAIN_ROBINHOOD,
  TIP_COLLECTIONS,
  collectionByContract,
} from "@/lib/web3/constants";
import { addPendingTake, getPendingTakes, removePendingTake } from "@/lib/karaoke/pendingTakes";

describe("tip eligibility collections", () => {
  it("are exactly the active whitelisted collections", () => {
    expect(TIP_COLLECTIONS.map((c) => c.name).sort()).toEqual(
      [
        "Bored Ape Yacht Club",
        "CryptoPunks",
        "Geez on Ape",
        "Gobs on Ape",
        "Mutant Ape Yacht Club",
        "StonkBrokers",
        "Orca Business",
        "Temp Agency",
        "Ugly Duck Labs",
      ].sort(),
    );
  });

  it("checks each collection on the chain it lives on", () => {
    expect(collectionByContract("0xF3DFD71822b10F9F1e6f21097C29E36c4f3952c0")?.chainId).toBe(
      CHAIN_APECHAIN,
    );
    expect(collectionByContract("0xc60283eBe17F6A6d7b49C1Df3602f440D98f5d25")?.chainId).toBe(
      CHAIN_ROBINHOOD,
    );
    expect(collectionByContract("0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D")?.chainId).toBe(
      CHAIN_ETHEREUM,
    );
    expect(collectionByContract("0x0000000000000000000000000000000000000001")).toBeNull();
    expect(new Set(ALLOWED_COLLECTIONS.map((c) => c.contract.toLowerCase())).size).toBe(
      ALLOWED_COLLECTIONS.length,
    );
  });
});

vi.mock("@/server/ownership/chains", () => ({
  publicClientFor: (chainId: number) => ({
    readContract: async ({ address }: { address: string }) =>
      // Holder only of the ApeChain collection.
      chainId === CHAIN_APECHAIN && address.toLowerCase().startsWith("0xf3dfd") ? 2n : 0n,
  }),
}));

describe("scanAllCollections", () => {
  it("routes each contract to its own chain client", async () => {
    const { scanAllCollections } = await import("@/server/ownership/collectionScanner");
    const mainnet = { readContract: async () => 0n } as never;
    const rows = await scanAllCollections(
      mainnet,
      ["0x1111111111111111111111111111111111111111"],
      1n,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contract.toLowerCase()).toBe("0xf3dfd71822b10f9f1e6f21097c29e36c4f3952c0");
  });
});

describe("pending takes (never auto-saved)", () => {
  it("queues takes until the singer decides", () => {
    const save = vi.fn(async () => undefined);
    const take = {
      id: "t1",
      blob: new Blob(["x"]),
      mime: "audio/webm",
      durationMs: 60_000,
      title: "Song",
      artist: null,
      save,
    };
    addPendingTake(take);
    expect(getPendingTakes().map((t) => t.id)).toEqual(["t1"]);
    expect(save).not.toHaveBeenCalled();
    removePendingTake("t1");
    expect(getPendingTakes()).toHaveLength(0);
  });
});
