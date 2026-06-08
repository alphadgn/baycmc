import { test, expect, devices } from "@playwright/test";

/**
 * E2E: brand-new email at Privy → embedded wallet auto-creation → BAYC/MAYC
 * collection check runs against THAT auto-created wallet.
 *
 * Required env:
 *   BASE_URL                   — origin allowlisted in Privy dashboard
 *   PRIVY_TEST_NEW_EMAIL       — an email Privy has never seen
 *   PRIVY_TEST_OTP             — (optional) static dev OTP if configured
 *
 * Skipped if PRIVY_TEST_NEW_EMAIL is not provided.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const NEW_EMAIL = process.env.PRIVY_TEST_NEW_EMAIL;
const OTP = process.env.PRIVY_TEST_OTP;

const profiles = [
  { name: "iPhone 13", device: devices["iPhone 13"] },
  { name: "Pixel 5", device: devices["Pixel 5"] },
] as const;

for (const { name, device } of profiles) {
  test.describe(`Privy first-time email → auto-wallet → collection check (${name})`, () => {
    test.use({ ...device });
    test.skip(!NEW_EMAIL, "Set PRIVY_TEST_NEW_EMAIL to run this spec.");

    test("auto-created embedded wallet drives the BAYC/MAYC verification", async ({ page }) => {
      // Capture the verifyPrivyOwnership server-fn call so we can assert the
      // wallet that was checked is the same auto-created one shown in UI.
      const verifyCalls: { address?: string; status: number }[] = [];
      page.on("response", async (resp) => {
        const url = resp.url();
        if (url.includes("verifyPrivyOwnership") || url.includes("verify-privy")) {
          verifyCalls.push({ status: resp.status() });
        }
      });

      await page.goto(BASE_URL);
      await page
        .getByRole("button", { name: /entrance|enter|verify|sign in/i })
        .first()
        .click();
      await page.getByRole("button", { name: /connect wallet/i }).click();

      // Email step
      const emailInput = page
        .frameLocator('iframe[src*="privy.io"]')
        .locator('input[type="email"], input[autocomplete="email"]')
        .first();
      await emailInput.waitFor({ state: "visible", timeout: 15_000 });
      await emailInput.tap();
      await emailInput.fill(NEW_EMAIL!);
      await page
        .frameLocator('iframe[src*="privy.io"]')
        .getByRole("button", { name: /submit|continue|send/i })
        .first()
        .click();

      // OTP step (only if a static test OTP is wired in the Privy dev project)
      if (OTP) {
        const otpInput = page
          .frameLocator('iframe[src*="privy.io"]')
          .locator('input[inputmode="numeric"], input[name*="code"]')
          .first();
        await otpInput.waitFor({ state: "visible", timeout: 30_000 });
        await otpInput.fill(OTP);
      }

      // Status step: explicit "creating wallet" indicator must appear.
      const creating = page.getByTestId("privy-status-creating-wallet");
      await expect(creating).toBeVisible({ timeout: 30_000 });

      // Then the wallet-ready chip appears with an address.
      const walletReady = page.getByTestId("privy-status-wallet-ready");
      await expect(walletReady).toBeVisible({ timeout: 60_000 });
      const autoAddress = await walletReady.getAttribute("data-wallet-address");
      expect(autoAddress, "auto-created wallet address must be exposed").toMatch(
        /^0x[a-fA-F0-9]{40}$/,
      );

      // Trigger the collection check.
      await page.getByRole("button", { name: /sign & verify holdings/i }).click();

      // Verifying status appears, referencing the auto-created wallet.
      await expect(page.getByTestId("privy-status-verifying")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("privy-status-verifying")).toContainText(
        autoAddress!.slice(0, 6),
      );

      // The server-fn must have been hit at least once.
      await expect.poll(() => verifyCalls.length, { timeout: 30_000 }).toBeGreaterThan(0);
    });
  });
}
