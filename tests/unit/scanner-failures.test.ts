import { describe, expect, it } from "vitest";
import { scanCollectionsDetailed } from "@/server/ownership/collectionScanner";

describe("scanCollectionsDetailed", () => {
  it("reports RPC failures separately instead of treating them as 0", async () => {
    let calls = 0;
    const client = {
      readContract: async ({ address }: { address: string }) => {
        calls++;
        if (address === "0x00000000000000000000000000000000000000aa") throw new Error("429");
        return 3n;
      },
    } as never;
    const res = await scanCollectionsDetailed(
      client,
      ["0x1111111111111111111111111111111111111111"],
      ["0x00000000000000000000000000000000000000aa", "0x00000000000000000000000000000000000000bb"],
      123n,
    );
    expect(res.rows.map((r) => r.contract)).toEqual(["0x00000000000000000000000000000000000000bb"]);
    expect([...res.failed]).toEqual(["0x00000000000000000000000000000000000000aa"]);
    expect(calls).toBe(4); // 3 attempts for the failing one + 1
  });
});
