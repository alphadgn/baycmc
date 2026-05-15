import { test, expect, devices } from "@playwright/test";

/**
 * E2E coverage for the regression that the Entrance / Sign-in button must
 * NEVER become inoperable, plus delegate.cash vault-to-hot wallet auth
 * (including the revoked-delegation case).
 *
 * Runs in incognito (each Playwright `context()` is isolated, equivalent to
 * a fresh incognito window). The full vault flow requires three optional
 * env vars; tests are skipped cleanly when they are absent so CI stays green
 * on machines without test wallets.
 *
 *   BASE_URL                      — origin of the app (default localhost)
 *   PRIVY_TEST_EMAIL              — email Privy delivers a code to
 *   PRIVY_TEST_OTP                — current OTP (manual / mailbox-piped)
 *   VAULT_HOT_WALLET_ADDRESS      — hot wallet that vault delegates to
 *   VAULT_HOT_WALLET_PK           — private key for SIWE signing
 *   VAULT_ADDRESS                 — cold vault holding the BAYC/MAYC
 *   DELEGATION_REVOKED            — "1" to assert revoked-delegation path
 *   EXCLUSIVE_ROOM_ID             — token-proof/lifer room id for revoked-access gate test
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Entrance button is always operable", () => {
  test.use({ ...devices["Desktop Chrome"] });

  test("renders, is enabled, and opens the Privy modal on first click", async ({
    browser,
  }) => {
    // Fresh incognito context — no cached Supabase / Privy session.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(BASE_URL);

    const entrance = page
      .getByRole("button", { name: /entrance|enter|verify|sign in/i })
      .first();
    await expect(entrance).toBeVisible({ timeout: 15_000 });
    await expect(entrance).toBeEnabled();
    await expect(entrance).not.toHaveAttribute("aria-disabled", "true");

    await entrance.click();

    // Privy modal must mount on first click — the regression we are guarding
    // against was the button silently no-op'ing on first render.
    const modal = page
      .locator(
        'iframe[src*="privy.io"], [data-privy-dialog], [role="dialog"]:has-text(/email|wallet/i)',
      )
      .first();
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test("button does not become inoperable after a cancelled login", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL);

    const entrance = page
      .getByRole("button", { name: /entrance|enter|verify|sign in/i })
      .first();

    for (let i = 0; i < 3; i++) {
      await expect(entrance).toBeEnabled();
      await entrance.click();
      // Dismiss via Escape — simulates a user closing the modal.
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }

    // Final assertion: still operable on the 4th attempt.
    await expect(entrance).toBeVisible();
    await expect(entrance).toBeEnabled();
    await entrance.click();
    const modal = page
      .locator('iframe[src*="privy.io"], [role="dialog"]')
      .first();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});

test.describe("Vault-to-hot wallet authentication via delegate.cash", () => {
  const HOT = process.env.VAULT_HOT_WALLET_ADDRESS;
  const HOT_PK = process.env.VAULT_HOT_WALLET_PK;
  const VAULT = process.env.VAULT_ADDRESS;
  const REVOKED = process.env.DELEGATION_REVOKED === "1";
  const EXCLUSIVE_ROOM_ID = process.env.EXCLUSIVE_ROOM_ID;

  test.skip(
    !HOT || !HOT_PK || !VAULT,
    "Set VAULT_HOT_WALLET_ADDRESS / VAULT_HOT_WALLET_PK / VAULT_ADDRESS to run vault flow",
  );

  test("hot wallet authenticates on behalf of vault (incognito)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL);

    // Drive the SIWE handshake through the server fn directly so we don't
    // need a real injected wallet. The browser context still proves the
    // server fn is reachable from a fresh incognito session.
    const result = await page.evaluate(
      async ({ hot, hotPk }) => {
        // viem is bundled — pull it via dynamic import to keep the test
        // independent of app internals.
        const viem = await import(
          /* @vite-ignore */ "https://esm.sh/viem@2?bundle"
        );
        const { privateKeyToAccount } = await import(
          /* @vite-ignore */ "https://esm.sh/viem@2/accounts?bundle"
        );
        const { SiweMessage } = await import(
          /* @vite-ignore */ "https://esm.sh/siwe@2?bundle"
        );

        const account = privateKeyToAccount(hotPk as `0x${string}`);
        const msg = new SiweMessage({
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
        const message = msg.prepareMessage();
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
          // viem may be tree-shaken; reference to silence the unused warning.
          _v: typeof viem,
        };
      },
      { hot: HOT, hotPk: HOT_PK },
    );

    expect(result.status, "verifyPrivyOwnership reachable").toBeLessThan(500);

    if (REVOKED) {
      // Revoked-delegation expectation: server still mints a Supabase
      // session (lobby access) but `verified` is false and the reason
      // mentions delegation/lobby — never throws or hangs the button.
      expect(result.body).toMatch(/"verified":\s*false/);
      expect(result.body).toMatch(/lobby|delegate|BAYC\/MAYC/i);
    } else {
      // Active delegation: verified=true, basis=delegated, vault echoed back.
      expect(result.body).toMatch(/"verified":\s*true/);
      expect(result.body).toMatch(/"verificationBasis":\s*"delegated"/);
      expect(result.body.toLowerCase()).toContain(VAULT!.toLowerCase());
    }

    await context.close();
  });

  test("revoked delegation/BAYC is blocked from exclusive room entry and LiveKit tokens", async ({
    browser,
  }) => {
    test.skip(!REVOKED || !EXCLUSIVE_ROOM_ID, "Set DELEGATION_REVOKED=1 and EXCLUSIVE_ROOM_ID");

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL);

    const result = await page.evaluate(
      async ({ hotPk, roomId }) => {
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
        const verifyRes = await fetch("/_serverFn/verifyPrivyOwnership", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { message, signature } }),
        });
        const verifyText = await verifyRes.text();
        const accessToken = verifyText.match(/"access_token"\s*:\s*"([^"]+)"/)?.[1] ?? null;
        const tokenRes = accessToken
          ? await fetch("/_serverFn/getLivekitToken", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ data: { roomId } }),
            })
          : null;
        return {
          verifyText,
          tokenStatus: tokenRes?.status ?? 0,
          tokenText: tokenRes ? await tokenRes.text() : "missing session",
        };
      },
      { hotPk: HOT_PK, roomId: EXCLUSIVE_ROOM_ID },
    );

    expect(result.verifyText).toMatch(/"verified":\s*false/);
    expect(result.tokenStatus).toBeLessThan(500);
    expect(result.tokenText).toMatch(/"ok":\s*false|BAYC|revoked|access is no longer active/i);

    await page.goto(`${BASE_URL}/rooms/${EXCLUSIVE_ROOM_ID}`);
    await page.getByTestId("enter-exclusive-room").click();
    await expect(page.getByTestId("exclusive-access-loss")).toBeVisible({ timeout: 15_000 });

    await context.close();
  });
});
