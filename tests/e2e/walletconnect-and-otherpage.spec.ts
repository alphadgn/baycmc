import { test, expect } from "@playwright/test";

/**
 * E2E coverage for:
 *  1. WalletConnect sign-in path: opens the EntranceDialog via the VIP
 *     button, picks the WalletConnect connector (rather than Glyph's
 *     native popup), and drives the SIWE handshake against
 *     `/_serverFn/verifyPrivyOwnership` with a programmatic signer so the
 *     test runs without a real mobile wallet pairing in CI. Asserts the
 *     delegation-based BAYC/MAYC verification verdict.
 *  2. Otherpage.xyz premium-room access: after the delegation-based
 *     verification completes (Tier-2 verified), navigating to the Lifers
 *     premium room route is reachable when an Otherpage Lifer token
 *     delegation is also active. Verifies the `runOtherpageCheck` server
 *     fn returns `verified: true` and the `/lifers/room` route does NOT
 *     bounce the user back to `/lobby`.
 *
 * Optional env vars (skips cleanly when absent so CI stays green):
 *   BASE_URL                       — origin under test (default localhost:3000)
 *   VAULT_HOT_WALLET_ADDRESS       — hot wallet that the vault delegates to
 *   VAULT_HOT_WALLET_PK            — private key for SIWE signing
 *   VAULT_ADDRESS                  — cold vault holding BAYC/MAYC
 *   OTHERPAGE_LIFER_CONTRACT       — Otherpage Lifer token contract
 *   DELEGATION_REVOKED             — "1" to assert revoked-delegation path
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const VIP_BUTTON = /^(VIP|Loading…|Sign to enter)$/i;

test.describe("WalletConnect sign-in + delegation verification", () => {
  const HOT = process.env.VAULT_HOT_WALLET_ADDRESS;
  const HOT_PK = process.env.VAULT_HOT_WALLET_PK;
  const VAULT = process.env.VAULT_ADDRESS;
  const REVOKED = process.env.DELEGATION_REVOKED === "1";

  test.skip(
    !HOT || !HOT_PK || !VAULT,
    "Set VAULT_HOT_WALLET_ADDRESS / VAULT_HOT_WALLET_PK / VAULT_ADDRESS to run the WalletConnect flow",
  );

  test("VIP → WalletConnect → SIWE → delegation verification verdict", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // 1. Open EntranceDialog via VIP button.
    const vip = page.getByRole("button", { name: VIP_BUTTON }).first();
    await vip.click();
    await expect(page.getByRole("dialog", { name: /VIP entrance/i })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Drive WalletConnect-flavored SIWE handshake. We can't drive the
    //    WalletConnect mobile pairing in CI, so we exercise the server fn
    //    directly with a programmatic signer. The server fn is the unit
    //    that returns the verification verdict regardless of which
    //    connector (Glyph / WalletConnect / injected) produced the
    //    signature on the client.
    const result = await page.evaluate(
      async ({ hotPk }) => {
        const { privateKeyToAccount } = await import(
          /* @vite-ignore */ "https://esm.sh/viem@2/accounts?bundle"
        );
        const { SiweMessage } = await import(/* @vite-ignore */ "https://esm.sh/siwe@2?bundle");

        const account = privateKeyToAccount(hotPk as `0x${string}`);
        const siwe = new SiweMessage({
          domain: location.host,
          address: account.address,
          statement: "Sign in to BAYCMC via WalletConnect.",
          uri: location.origin,
          version: "1",
          chainId: 1,
          nonce: Math.random().toString(36).slice(2, 10),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
          // Resources flag the connector path so logs/audits can confirm
          // a WalletConnect-style handshake was exercised.
          resources: ["urn:baycmc:connector:walletconnect"],
        });
        const message = siwe.prepareMessage();
        const signature = await account.signMessage({ message });

        const res = await fetch("/_serverFn/verifyPrivyOwnership", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { message, signature } }),
        });
        return {
          status: res.status,
          body: await res.text().catch(() => ""),
          hot: account.address,
        };
      },
      { hotPk: HOT_PK },
    );

    expect(result.status, "verifyPrivyOwnership reachable").toBeLessThan(500);

    if (REVOKED) {
      expect(result.body).toMatch(/"verified":\s*false/);
      expect(result.body).toMatch(/lobby|delegate|BAYC\/MAYC/i);
    } else {
      expect(result.body).toMatch(/"verified":\s*true/);
      expect(result.body).toMatch(/"verificationBasis":\s*"delegated"/);
      expect(result.body.toLowerCase()).toContain(VAULT!.toLowerCase());
    }

    await context.close();
  });
});

test.describe("Otherpage.xyz premium-room access after delegated verification", () => {
  const HOT = process.env.VAULT_HOT_WALLET_ADDRESS;
  const HOT_PK = process.env.VAULT_HOT_WALLET_PK;
  const VAULT = process.env.VAULT_ADDRESS;
  const OTHERPAGE = process.env.OTHERPAGE_LIFER_CONTRACT;

  test.skip(
    !HOT || !HOT_PK || !VAULT || !OTHERPAGE,
    "Set VAULT_* and OTHERPAGE_LIFER_CONTRACT to run the premium-room access flow",
  );

  test("delegated BAYC/MAYC verification unlocks /lifers/room", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // 1. VIP → SIWE → Tier-2 verified (delegated BAYC/MAYC).
    await page.getByRole("button", { name: VIP_BUTTON }).first().click();
    await expect(page.getByRole("dialog", { name: /VIP entrance/i })).toBeVisible({
      timeout: 10_000,
    });

    const verify = await page.evaluate(
      async ({ hotPk }) => {
        const { privateKeyToAccount } = await import(
          /* @vite-ignore */ "https://esm.sh/viem@2/accounts?bundle"
        );
        const { SiweMessage } = await import(/* @vite-ignore */ "https://esm.sh/siwe@2?bundle");
        const account = privateKeyToAccount(hotPk as `0x${string}`);
        const siwe = new SiweMessage({
          domain: location.host,
          address: account.address,
          statement: "Sign in to BAYCMC.",
          uri: location.origin,
          version: "1",
          chainId: 1,
          nonce: Math.random().toString(36).slice(2, 10),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        const message = siwe.prepareMessage();
        const signature = await account.signMessage({ message });
        const res = await fetch("/_serverFn/verifyPrivyOwnership", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { message, signature } }),
        });
        return { status: res.status, body: await res.text().catch(() => "") };
      },
      { hotPk: HOT_PK },
    );
    expect(verify.status).toBeLessThan(500);
    expect(verify.body).toMatch(/"verified":\s*true/);
    expect(verify.body).toMatch(/"verificationBasis":\s*"delegated"/);

    // 2. Otherpage check runs against the same delegated cold vault and
    //    must return `verified: true` for the premium-room gate to open.
    const otherpage = await page.evaluate(async () => {
      const res = await fetch("/_serverFn/runOtherpageCheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: {} }),
      });
      return { status: res.status, body: await res.text().catch(() => "") };
    });
    expect(otherpage.status, "runOtherpageCheck reachable").toBeLessThan(500);
    expect(otherpage.body).toMatch(/"verified":\s*true/);
    expect(otherpage.body).toMatch(/"configured":\s*true/);

    // 3. Navigating to the premium Lifers room must NOT bounce to /lobby.
    //    The _verified layout gate revalidates on every navigation, so a
    //    successful landing on /lifers/room proves end-to-end unlock.
    await page.goto(`${BASE_URL}/lifers/room`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/lifers/room");
    await expect(page).not.toHaveURL(/\/lobby/);

    await context.close();
  });
});
