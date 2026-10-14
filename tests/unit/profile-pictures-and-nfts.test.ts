import { describe, expect, it } from "vitest";
import { avatarShapeClass, isDeviceAvatar } from "@/lib/profile-avatar";
import { mergeWalletNfts } from "@/lib/wallet-nfts";
import { ALLOWED_COLLECTIONS } from "@/lib/web3/constants";

describe("Global profile picture shapes", () => {
  it("keeps device uploads circular and NFT URLs square", () => {
    expect(
      isDeviceAvatar("https://example.test/storage/v1/object/public/avatars/user/photo.jpg"),
    ).toBe(true);
    expect(
      avatarShapeClass("https://example.test/storage/v1/object/public/avatars/user/photo.jpg"),
    ).toBe("rounded-full");
    expect(avatarShapeClass("https://example.test/nft/2931.png")).toBe("rounded-md");
    expect(avatarShapeClass(null)).toBe("rounded-full");
  });
});

describe("Connected wallet NFT aggregation", () => {
  const nft = (contract: string, tokenId = "1") => ({
    contract,
    tokenId,
    name: null,
    collection: null,
    image: null,
    openseaUrl: "",
  });
  it("includes every allowed collection across wallets", () => {
    const result = mergeWalletNfts(ALLOWED_COLLECTIONS.map((c) => [nft(c.contract)]));
    expect(result).toHaveLength(ALLOWED_COLLECTIONS.length);
  });
  it("deduplicates contract case and excludes non-whitelisted NFTs", () => {
    const contract = ALLOWED_COLLECTIONS[0].contract;
    expect(
      mergeWalletNfts([
        [nft(contract)],
        [nft(contract.toLowerCase()), nft("0x0000000000000000000000000000000000000001")],
      ]),
    ).toHaveLength(1);
  });
});
