import { test, expect, devices } from "@playwright/test";

/**
 * Focused regression test: clicking the VIP button on the landing page
 * MUST open the EntranceDialog every single time, and the dialog must
 * remain open until the user explicitly closes it (via the close
 * button or the Escape key). Runs on both desktop and mobile.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

for (const profile of [
  { name: "desktop", device: devices["Desktop Chrome"] },
  { name: "mobile", device: devices["iPhone 13"] },
]) {
  test(`VIP button opens EntranceDialog on every click — ${profile.name}`, async ({ browser }) => {
    const context = await browser.newContext({ ...profile.device });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const vipButton = page.locator('[data-vip-trigger="true"]').first();
    await expect(vipButton).toBeVisible({ timeout: 15_000 });

    // Repeat 3 times: click → modal appears → close → modal gone.
    for (let i = 0; i < 3; i++) {
      await vipButton.click();
      const dialog = page.getByRole("dialog").filter({ hasText: /VIP Entrance/i });
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Dialog must NOT auto-close: still visible after a beat.
      await page.waitForTimeout(750);
      await expect(dialog).toBeVisible();

      // Close via Escape so the next iteration starts clean.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden({ timeout: 5_000 });
    }

    await context.close();
  });
}
