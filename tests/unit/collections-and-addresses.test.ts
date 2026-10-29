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
    expect(ALLOWED_COLLECTIONS).toHaveLength(9);
  });

  it("whitelists Geez on Ape, Gobs on Ape and StonkBrokers like Temp Agency", () => {
    const temp = ALLOWED_COLLECTIONS.find((x) => x.label === "TEMP_AGENCY")!;
    for (const [label, contract, chainId] of [
      ["GEEZ_ON_APE", "0xb3443B6Bd585ba4118CaE2beDb61c7EC4a8281Df", 33139],
      ["GOBS_ON_APE", "0xBEbaa24108d6a03C7331464270b95278bBBE6Ff7", 33139],
      ["STONKBROKERS", "0x539CdD042c2f3d93EbC5BE7DfFf0c79F3B4fAbF0", 4663],
    ] as const) {
      const c = ALLOWED_COLLECTIONS.find((x) => x.label === label)!;
      expect(c.contract).toBe(contract);
      expect(c.chainId).toBe(chainId);
      expect(c.access).toBe(temp.access);
      expect(isAllowedCollection(contract.toLowerCase())).toBe(true);
    }
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

import { hasFullAccess, hasPartnerAccess } from "@/lib/web3/constants";
describe("access tiers", () => {
  it("BAYC / MAYC / CryptoPunks are full; Temp Agency, Orca, Ugly Duck are partner", () => {
    expect(hasFullAccess(["PUNKS"])).toBe(true);
    expect(hasFullAccess(["TEMP_AGENCY", "ORCA_BUSINESS", "UGLY_DUCK_LABS"])).toBe(false);
    expect(hasPartnerAccess(["UGLY_DUCK_LABS"])).toBe(true);
    expect(hasPartnerAccess(["BAYC"])).toBe(false);
  });
});
