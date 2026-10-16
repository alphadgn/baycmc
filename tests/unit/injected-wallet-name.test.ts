import { describe, expect, it } from "vitest";
import { injectedWalletName, walletLabel } from "@/lib/web3/injected-target";

describe("injected wallet name", () => {
  it("names Rabby even though it also claims MetaMask", () => {
    expect(injectedWalletName({ isRabby: true, isMetaMask: true })).toBe("Rabby Wallet");
  });
  it("names MetaMask, Coinbase and unknown wallets", () => {
    expect(injectedWalletName({ isMetaMask: true })).toBe("MetaMask");
    expect(injectedWalletName({ isCoinbaseWallet: true, isMetaMask: true })).toBe("Coinbase Wallet");
    expect(injectedWalletName({})).toBe("Browser wallet");
    expect(injectedWalletName(undefined)).toBe("Browser wallet");
  });
  it("never shows the raw 'Injected' label", () => {
    expect(walletLabel("Injected")).not.toMatch(/injected/i);
    expect(walletLabel("Rabby Wallet")).toBe("Rabby Wallet");
  });
});
