import { describe, expect, it } from "vitest";
import {
  ALLOWED_COLLECTIONS,
  COLLECTION_REGISTRY,
  REQUIRED_COLLECTIONS,
  collectionNameForLabel,
  isAllowedCollection,
} from "@/lib/web3/constants";
import { shortAddress } from "@/lib/short-address";

describe("inactive collections", () => {
  it("keeps Pudgy Penguins and Lil Pudgys on file but grants nothing", () => {
    for (const label of ["PUDGY_PENGUINS", "LIL_PUDGYS"]) {
      const c = COLLECTION_REGISTRY.find((x) => x.label === label);
      expect(c?.contract).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(c?.active).toBe(false);
      expect(ALLOWED_COLLECTIONS.some((x) => x.label === label)).toBe(false);
      expect(isAllowedCollection(c!.contract)).toBe(false);
      expect(REQUIRED_COLLECTIONS.includes(c!.contract as `0x${string}`)).toBe(false);
    }
    expect(ALLOWED_COLLECTIONS).toHaveLength(6);
  });

  it("shows human collection names", () => {
    expect(collectionNameForLabel("UGLY_DUCK_LABS")).toBe("Ugly Duck Labs");
    expect(collectionNameForLabel("PUNKS")).toBe("CryptoPunks");
    expect(collectionNameForLabel(null)).toBeNull();
  });
});

describe("shortAddress", () => {
  it("never throws for accounts without a wallet", () => {
    expect(shortAddress(null)).toBe("—");
    expect(shortAddress(undefined, "anon")).toBe("anon");
    expect(shortAddress("0xd796bd30280ac676a1a2f01b3c0279f786ed33c0")).toBe("0xd796…33c0");
  });
});
