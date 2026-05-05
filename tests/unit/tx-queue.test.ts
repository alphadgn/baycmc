// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueSign,
  enqueueSend,
  __resetQueueForTests,
  getQueueState,
} from "@/lib/wallet/txQueue";

type ProviderLike = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

function makeProvider(impl: (call: number, method: string) => Promise<unknown>): ProviderLike {
  let n = 0;
  return {
    request: ({ method }) => {
      n += 1;
      return impl(n, method);
    },
  };
}

describe("transaction queue", () => {
  beforeEach(() => {
    __resetQueueForTests();
  });

  it("serializes concurrent sign requests in FIFO order", async () => {
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    const provider = makeProvider(async (call) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      order.push(call);
      active -= 1;
      return `0xsig${call}`;
    });

    const results = await Promise.all([
      enqueueSign(provider, "personal_sign", ["a", "0x1"]),
      enqueueSign(provider, "personal_sign", ["b", "0x1"]),
      enqueueSign(provider, "personal_sign", ["c", "0x1"]),
    ]);
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(["0xsig1", "0xsig2", "0xsig3"]);
  });

  it("retries transient RPC failures with backoff", async () => {
    let calls = 0;
    const provider: ProviderLike = {
      request: async () => {
        calls += 1;
        if (calls < 3) throw new Error("network error");
        return "0xhash";
      },
    };
    const hash = await enqueueSend(
      provider,
      { from: "0x0", to: "0x1" },
      { maxAttempts: 4 },
    );
    expect(hash).toBe("0xhash");
    expect(calls).toBe(3);
  });

  it("does not retry user rejections", async () => {
    let calls = 0;
    const provider: ProviderLike = {
      request: async () => {
        calls += 1;
        throw new Error("User rejected the request");
      },
    };
    await expect(
      enqueueSign(provider, "personal_sign", [], { maxAttempts: 5 }),
    ).rejects.toThrow(/user rejected/i);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts on persistent transient errors", async () => {
    let calls = 0;
    const provider: ProviderLike = {
      request: async () => {
        calls += 1;
        throw new Error("network timeout");
      },
    };
    await expect(
      enqueueSign(provider, "personal_sign", [], { maxAttempts: 2 }),
    ).rejects.toThrow(/timeout/);
    expect(calls).toBe(2);
  });

  it("processes 25 sequential signs without dropping any", async () => {
    const provider = makeProvider(async (n) => {
      await new Promise((r) => setTimeout(r, 1));
      return `0x${n}`;
    });
    const ps = Array.from({ length: 25 }, (_, i) =>
      enqueueSign(provider, "personal_sign", [`m${i}`]),
    );
    const out = await Promise.all(ps);
    expect(out).toHaveLength(25);
    expect(new Set(out).size).toBe(25);
    expect(getQueueState().depth).toBe(0);
  });

  it("rejects send response that isn't a string hash", async () => {
    const provider: ProviderLike = { request: async () => 42 };
    await expect(enqueueSend(provider, { from: "0x0", to: "0x1" })).rejects.toThrow(
      /Unexpected/,
    );
  });

  it("validates exponential backoff timing between retries", async () => {
    const stamps: number[] = [];
    const provider: ProviderLike = {
      request: async () => {
        stamps.push(Date.now());
        if (stamps.length < 3) throw new Error("rate limit");
        return "ok";
      },
    };
    const t0 = Date.now();
    await enqueueSign(provider, "personal_sign", [], { maxAttempts: 3 });
    const elapsed = Date.now() - t0;
    // 500ms + 1500ms = 2000ms minimum for two backoffs
    expect(elapsed).toBeGreaterThanOrEqual(1800);
    vi.useRealTimers();
  }, 10_000);
});
