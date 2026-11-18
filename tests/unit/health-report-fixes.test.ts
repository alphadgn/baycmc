import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Shared mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  profiles: new Map<string, { wallet_address: string | null; username: string | null }>(),
  insert: vi.fn(),
  receipt: { status: "success", blockNumber: 10n } as { status: string; blockNumber: bigint },
  tx: { to: "", from: "", value: 1n } as { to: string; from: string; value: bigint },
  blockTs: 0n,
}));

function chain(table: string) {
  let eqValue: string | null = null;
  const self: Record<string, unknown> = {};
  const ret = () => self;
  for (const m of ["select", "not", "order", "limit", "in", "neq", "gte", "ilike"]) self[m] = ret;
  self.eq = (_c: string, v: string) => {
    eqValue = v;
    return self;
  };
  self.maybeSingle = async () => ({
    data: table === "profiles" ? (mocks.profiles.get(eqValue ?? "") ?? null) : null,
    error: null,
  });
  self.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  self.insert = (row: unknown) => {
    mocks.insert(table, row);
    return Promise.resolve({ error: null });
  };
  return self;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: (t: string) => chain(t) },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/server/club-configuration.server", () => ({
  activeCollections: async () => [
    {
      name: "Bored Ape Yacht Club",
      contract: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
      tips: true,
    },
  ],
}));
vi.mock("@/server/ownership/collectionScanner", () => ({
  scanAllCollections: async () => [{ contract: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" }],
}));
vi.mock("@/server/ownership/chains", () => ({
  publicClientFor: () => ({
    waitForTransactionReceipt: async () => mocks.receipt,
    getTransaction: async () => mocks.tx,
    getBlock: async () => ({ timestamp: mocks.blockTs }),
  }),
}));

import {
  authenticateRequest,
  consumeMemoryLimit,
  consumeRateLimit,
} from "@/server/api-auth.server";
import { TipError, verifyAndRecordTip } from "@/server/karaoke-tips.server";
import { acceptedSiweDomains, isReservedWalletEmail } from "@/lib/auth/siwe-domains";
import {
  OWNERSHIP_REVALIDATE_TTL_MS,
  markOwnershipRechecked,
  ownershipRecheckDue,
} from "@/lib/auth/revalidate-cache";
import { isMediaPlaying } from "@/lib/media-activity";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://isolated.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "isolated-publishable");
});

// ── P0-1: /api/chat auth + durable rate limit ──────────────────────────────
describe("/api/chat lock-down", () => {
  async function post(headers: Record<string, string> = {}) {
    const { Route } = await import("@/routes/api/chat");
    const handlers = (
      Route.options as unknown as {
        server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
      }
    ).server.handlers;
    return handlers.POST({
      request: new Request("https://baycmc.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ messages: [] }),
      }),
    });
  }

  it("refuses anonymous callers before any model call", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses an invalid token", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    expect((await post({ authorization: "Bearer nope" })).status).toBe(401);
  });

  it("returns 429 once the per-user budget is spent", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: [
        { allowed: false, remaining: 0, reset_at: new Date(Date.now() + 60_000).toISOString() },
      ],
      error: null,
    });
    const res = await post({ authorization: "Bearer good" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ _bucket: "api_chat", _subject: "u1" }),
    );
  });

  it("lets a signed-in member through (validation runs after auth)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: true, remaining: 29, reset_at: new Date().toISOString() }],
      error: null,
    });
    expect((await post({ authorization: "Bearer good" })).status).toBe(400);
  });
});

describe("rate limiter", () => {
  it("memory fallback enforces the window", () => {
    const key = `k-${Math.random()}`;
    expect(consumeMemoryLimit(key, 2, 1000, 0).allowed).toBe(true);
    expect(consumeMemoryLimit(key, 2, 1000, 1).allowed).toBe(true);
    expect(consumeMemoryLimit(key, 2, 1000, 2).allowed).toBe(false);
    expect(consumeMemoryLimit(key, 2, 1000, 2000).allowed).toBe(true);
  });

  it("falls back to memory when the database limiter is missing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const r = await consumeRateLimit("b", `s-${Math.random()}`, 1, 60);
    expect(r).toMatchObject({ allowed: true, source: "memory" });
  });

  it("bearer parsing", async () => {
    expect(await authenticateRequest(new Request("https://x.test"))).toBeNull();
  });
});

// ── P1: tip jar payer binding ──────────────────────────────────────────────
describe("tip verification", () => {
  const performer = "0x1111111111111111111111111111111111111111";
  const tipperWallet = "0x2222222222222222222222222222222222222222";
  const stranger = "0x3333333333333333333333333333333333333333";
  const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
  beforeEach(() => {
    mocks.profiles.set("perf", { wallet_address: performer, username: "perf" });
    mocks.profiles.set("tipper", { wallet_address: tipperWallet, username: "tipper" });
    mocks.blockTs = BigInt(Math.floor(Date.now() / 1000));
    mocks.tx = { to: performer, from: tipperWallet, value: 10n };
  });
  const tip = () =>
    verifyAndRecordTip({
      roomId: "room",
      tipperId: "tipper",
      recipientId: "perf",
      txHash: hash,
      generation: 1,
    });

  it("records a tip paid from the tipper's own wallet", async () => {
    await expect(tip()).resolves.toBeDefined();
    expect(mocks.insert).toHaveBeenCalledWith(
      "karaoke_tips",
      expect.objectContaining({ tipper_id: "tipper", from_address: tipperWallet }),
    );
  });

  it("rejects claiming someone else's transfer", async () => {
    mocks.tx = { to: performer, from: stranger, value: 10n };
    await expect(tip()).rejects.toBeInstanceOf(TipError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an old transfer replayed as a new tip", async () => {
    mocks.blockTs = BigInt(Math.floor(Date.now() / 1000) - 3 * 60 * 60);
    await expect(tip()).rejects.toThrow(/too old/);
  });
});

// ── P1: SIWE domain + reserved wallet email ────────────────────────────────
describe("SIWE domain allowlist", () => {
  it("ignores the Origin header once SITE_DOMAIN is configured", () => {
    const d = acceptedSiweDomains("baycmc.app, www.baycmc.app", "worker.internal", "evil.example");
    expect(d.has("baycmc.app")).toBe(true);
    expect(d.has("www.baycmc.app")).toBe(true);
    expect(d.has("evil.example")).toBe(false);
  });
  it("legacy: without SITE_DOMAIN the browser host is still accepted", () => {
    expect(
      acceptedSiweDomains(undefined, null, "preview.lovable.app").has("preview.lovable.app"),
    ).toBe(true);
  });
  it("reserved wallet-account email domain is refused for sign-up", () => {
    expect(isReservedWalletEmail("0xabc@wallet.baycmc.local")).toBe(true);
    expect(isReservedWalletEmail(" 0xABC@WALLET.BAYCMC.LOCAL ")).toBe(true);
    expect(isReservedWalletEmail("me@baycmc.app")).toBe(false);
  });
});

// ── P2: guard caching + inactivity media exemption ─────────────────────────
describe("verified-route ownership recheck throttle", () => {
  it("rechecks at most once per TTL per user", () => {
    expect(ownershipRecheckDue("user-a", 1_000)).toBe(true);
    markOwnershipRechecked("user-a", 1_000);
    expect(ownershipRecheckDue("user-a", 1_000 + OWNERSHIP_REVALIDATE_TTL_MS - 1)).toBe(false);
    expect(ownershipRecheckDue("user-a", 1_000 + OWNERSHIP_REVALIDATE_TTL_MS)).toBe(true);
    expect(ownershipRecheckDue("user-b", 1_000)).toBe(true);
  });
});

describe("inactivity media exemption", () => {
  const root = (els: Partial<HTMLMediaElement>[]) =>
    ({ querySelectorAll: () => els }) as unknown as Pick<Document, "querySelectorAll">;
  it("treats playing media as presence", () => {
    expect(isMediaPlaying(root([{ paused: false, ended: false, readyState: 4 }]))).toBe(true);
  });
  it("ignores paused or ended media", () => {
    expect(
      isMediaPlaying(
        root([
          { paused: true, ended: false, readyState: 4 },
          { paused: false, ended: true, readyState: 4 },
        ]),
      ),
    ).toBe(false);
  });
});
