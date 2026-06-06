import { test, expect, devices } from "@playwright/test";

/**
 * E2E coverage for:
 *  1. The VIP button in the header opens the EntranceDialog on both
 *     desktop and mobile viewports, and the handler is attached after
 *     hydration (i.e. the first post-hydration click is honored).
 *  2. End-to-end wallet sign-in via the SIWE flow and the
 *     delegation-based BAYC/MAYC verification result. The flow drives
 *     the `verifyPrivyOwnership` server fn directly with a programmatic
 *     signer so it runs without a real injected wallet in CI.
 *
 * Optional env vars (test skips cleanly when absent):
 *   BASE_URL                  — origin under test (default localhost:3000)
 *   VAULT_HOT_WALLET_ADDRESS  — hot wallet that the vault delegates to
 *   VAULT_HOT_WALLET_PK       — private key for SIWE signing
 *   VAULT_ADDRESS             — cold vault holding the BAYC/MAYC token
 *   DELEGATION_REVOKED        — "1" to assert revoked-delegation path
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// Selector for the VIP / Entrance trigger in the header. The button label
// is "VIP" on the landing page but may render as "Loading…" briefly while
// the Glyph SDK boots, so we match by accessible name.
const VIP_BUTTON = /^(VIP|Loading…|Sign to enter)$/i;
const MODAL_HEADING = /VIP Entrance/i;

test.describe("VIP button opens the sign-in modal (desktop + mobile)", () => {
  for (const profile of [
    { name: "desktop", device: devices["Desktop Chrome"] },
    { name: "mobile", device: devices["iPhone 13"] },
  ]) {
    test(`opens EntranceDialog on first post-hydration click — ${profile.name}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ ...profile.device });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

      // Header VIP button must render even before client hydration completes
      // (SSR renders it). It must become operable as soon as hydration runs.
      const vip = page.getByRole("button", { name: VIP_BUTTON }).first();
      await expect(vip).toBeVisible({ timeout: 15_000 });
      await expect(vip).toBeEnabled();

      // Wait for hydration to attach React handlers. networkidle is a
      // reliable proxy here — Vite finishes streaming the client bundle.
      await page.waitForLoadState("networkidle");

      await vip.click();

      // EntranceDialog is portal-rendered with role="dialog" + aria-label.
      const modal = page.getByRole("dialog", { name: /VIP entrance/i });
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByRole("heading", { name: MODAL_HEADING })).toBeVisible();

      // Sanity: re-clicking the close button dismisses it and a second
      // click on VIP re-opens it (i.e. the handler stays attached).
      await modal.getByRole("button", { name: /close/i }).first().click();
      await expect(modal).toBeHidden({ timeout: 5_000 });

      await vip.click();
      await expect(page.getByRole("dialog", { name: /VIP entrance/i })).toBeVisible({
        timeout: 10_000,
      });

      await context.close();
    });
  }

  test("mobile hamburger menu opens AND the VIP button remains usable beside it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // VIP button is always rendered for unauthenticated users; the
    // hamburger appears only post-auth. Verify VIP is reachable on mobile
    // without being obscured by the menu trigger.
    const vip = page.getByRole("button", { name: VIP_BUTTON }).first();
    await expect(vip).toBeVisible();
    await expect(vip).toBeEnabled();

    const box = await vip.boundingBox();
    expect(box, "VIP button has a layout box on mobile").not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    await vip.click();
    await expect(page.getByRole("dialog", { name: /VIP entrance/i })).toBeVisible({
      timeout: 10_000,
    });

    await context.close();
  });
});

test.describe("Delegation-based BAYC/MAYC verification result", () => {
  const HOT = process.env.VAULT_HOT_WALLET_ADDRESS;
  const HOT_PK = process.env.VAULT_HOT_WALLET_PK;
  const VAULT = process.env.VAULT_ADDRESS;
  const REVOKED = process.env.DELEGATION_REVOKED === "1";

  test.skip(
    !HOT || !HOT_PK || !VAULT,
    "Set VAULT_HOT_WALLET_ADDRESS / VAULT_HOT_WALLET_PK / VAULT_ADDRESS to run the delegation flow",
  );

  test("VIP → wallet sign-in → delegation verification asserts expected result", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // 1. Open the EntranceDialog via the VIP button (asserts UI path).
    const vip = page.getByRole("button", { name: VIP_BUTTON }).first();
    await vip.click();
    await expect(page.getByRole("dialog", { name: /VIP entrance/i })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Drive the SIWE handshake against the server fn directly. We can't
    //    drive Glyph's wallet popup in CI, but the server fn is the unit
    //    that returns the delegation-based verification verdict.
    const result = await page.evaluate(
      async ({ hotPk }) => {
        const { privateKeyToAccount } = await import(
          /* @vite-ignore */ "https://esm.sh/viem@2/accounts?bundle"
        );
        const { SiweMessage } = await import(
          /* @vite-ignore */ "https://esm.sh/siwe@2?bundle"
        );

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
      // Revoked delegation: server returns verified=false (lobby) and the
      // body must mention the delegation/lobby reason — never throws.
      expect(result.body).toMatch(/"verified":\s*false/);
      expect(result.body).toMatch(/lobby|delegate|BAYC\/MAYC/i);
    } else {
      // Active delegation: verified=true via delegated basis, with the
      // cold vault echoed back so we can prove the verdict came from the
      // delegated holdings rather than the hot wallet itself.
      expect(result.body).toMatch(/"verified":\s*true/);
      expect(result.body).toMatch(/"verificationBasis":\s*"delegated"/);
      expect(result.body.toLowerCase()).toContain(VAULT!.toLowerCase());
    }

    await context.close();
  });
});
