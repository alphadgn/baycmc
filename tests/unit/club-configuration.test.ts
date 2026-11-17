import { describe, expect, it } from "vitest";
import { clubConfigurationSchema, parseClubConfiguration } from "@/lib/club-configuration";
import { mergeWalletNfts } from "@/lib/wallet-nfts";

const contract = "0x1111111111111111111111111111111111111111";
const collection = {
  label: "TEST_COLLECTION",
  name: "Test collection",
  contract,
  chainId: 1 as const,
  active: true,
  tips: false,
  access: "partner" as const,
};
const configuration = { collections: [collection], rules: "", socialLinks: [] };
describe("club configuration", () => {
  it("accepts a newly allowlisted collection", () => {
    expect(clubConfigurationSchema.parse(configuration).collections[0].contract).toBe(contract);
  });
  it("shows only enabled saved collections in wallet assets", () => {
    const nft = {
      contract,
      tokenId: "2931",
      name: null,
      collection: null,
      image: null,
      openseaUrl: "https://opensea.io",
    };
    expect(mergeWalletNfts([[nft]], [collection])).toEqual([nft]);
    expect(mergeWalletNfts([[nft]], [{ ...collection, active: false }])).toEqual([]);
    expect(mergeWalletNfts([[nft]], [])).toEqual([]);
  });
  it("rejects duplicate contracts regardless of address case", () => {
    expect(
      clubConfigurationSchema.safeParse({
        ...configuration,
        collections: [collection, { ...collection, label: "OTHER" }],
      }).success,
    ).toBe(false);
  });
  it("rejects unsafe social links", () => {
    expect(
      clubConfigurationSchema.safeParse({
        ...configuration,
        socialLinks: [{ label: "Link", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      clubConfigurationSchema.safeParse({
        ...configuration,
        socialLinks: [{ label: "Link", url: "https://x.com/bayc" }],
      }).success,
    ).toBe(true);
  });
  it("does not repopulate deliberately empty collections", () => {
    expect(parseClubConfiguration(configuration).collections).toHaveLength(1);
    expect(parseClubConfiguration({ ...configuration, collections: [] }).collections).toEqual([]);
  });
});
