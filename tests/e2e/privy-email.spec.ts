import { test, expect, devices } from "@playwright/test";

/**
 * Mobile E2E for the Privy email sign-in flow.
 *
 * Run against any environment whose origin is allowlisted in the Privy
 * dashboard:
 *   BASE_URL=https://<your-host> bunx playwright test tests/e2e/privy-email.spec.ts
 *
 * The spec asserts two independent things on BOTH iOS and Android profiles:
 *   1. The Privy email <input> can be focused on a mobile viewport (this is
 *      what gates the iOS/Android keyboard from opening).
 *   2. If the iframe is blocked, the in-app troubleshoot panel surfaces a
 *      frame-ancestors / CSP error (not a generic "something went wrong").
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const profiles = [
  { name: "iPhone 13 (iOS Safari)", device: devices["iPhone 13"] },
  { name: "Pixel 5 (Android Chrome)", device: devices["Pixel 5"] },
] as const;

for (const { name, device } of profiles) {
  test.describe(`Privy email sign-in — ${name}`, () => {
    test.use({ ...device });

    test("email input focuses on mobile, panel reports CSP block when iframe is denied", async ({
      page,
    }) => {
      const cspMessages: string[] = [];
      page.on("console", (msg) => {
        const t = msg.text();
        if (
          t.includes("frame-ancestors") ||
          t.includes("Frame ancestor") ||
          t.includes("Refused to display")
        ) {
          cspMessages.push(t);
        }
      });

      await page.goto(BASE_URL);

      await page
        .getByRole("button", { name: /entrance|enter|verify|sign in/i })
        .first()
        .click();

      const connect = page.getByRole("button", { name: /connect wallet/i });
      await connect.waitFor({ state: "visible", timeout: 15_000 });
      await connect.click();

      const emailInput = page
        .frameLocator('iframe[src*="privy.io"]')
        .locator('input[type="email"], input[name="email"], input[autocomplete="email"]')
        .first();
      const panel = page.getByTestId("privy-troubleshoot-panel");

      const result = await Promise.race([
        emailInput
          .waitFor({ state: "visible", timeout: 12_000 })
          .then(() => "email" as const)
          .catch(() => null),
        panel
          .getAttribute("data-status", { timeout: 12_000 })
          .then((s) => (s === "blocked" ? ("blocked" as const) : null))
          .catch(() => null),
      ]);

      if (result === "email") {
        await emailInput.tap();
        await emailInput.focus();
        const focused = await emailInput.evaluate((el) => el === document.activeElement);
        expect(focused, `email input should be focused after tap (${name})`).toBe(true);

        await emailInput.fill("test+e2e@example.com");
        await expect(emailInput).toHaveValue("test+e2e@example.com");
        return;
      }

      await expect(panel).toHaveAttribute("data-status", "blocked");
      await expect(panel).toContainText(/frame-ancestors|CSP/i);

      const textarea = page.getByTestId("privy-allowlist-textarea");
      await expect(textarea).toBeVisible();
      const value = await textarea.inputValue();
      expect(value).toMatch(/lovableproject\.com|lovable\.app/);

      expect(
        cspMessages.length,
        `expected a CSP/frame-ancestors console error (${name})`,
      ).toBeGreaterThan(0);
    });
  });
}
