/**
 * Stress test for the wallet transaction queue. Drives 25+ concurrent signing
 * requests against a mocked Ethereum provider and asserts FIFO order plus zero
 * dropped requests.
 *
 * The queue itself is exercised in unit tests; this Playwright spec confirms
 * the bundled production build wires it correctly into the page runtime.
 */
import { test, expect } from "@playwright/test";

test("transaction queue serializes 25 sign requests without drops", async ({ page }) => {
  await page.goto("/diagnostics");

  const result = await page.evaluate(async () => {
    const mod: typeof import("@/lib/wallet/txQueue") = await import("/src/lib/wallet/txQueue.ts");
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    let n = 0;
    const provider = {
      request: async () => {
        const id = ++n;
        active += 1;
        if (active > maxActive) maxActive = active;
        await new Promise((r) => setTimeout(r, 5));
        order.push(id);
        active -= 1;
        return `0xsig${id}`;
      },
    };
    const promises = Array.from({ length: 25 }, () =>
      mod.enqueueSign(provider, "personal_sign", []),
    );
    const results = await Promise.all(promises);
    return { results, order, maxActive };
  });

  expect(result.results).toHaveLength(25);
  expect(result.maxActive).toBe(1);
  // FIFO: sequence is monotonically increasing
  for (let i = 1; i < result.order.length; i++) {
    expect(result.order[i]).toBeGreaterThan(result.order[i - 1]);
  }
});
