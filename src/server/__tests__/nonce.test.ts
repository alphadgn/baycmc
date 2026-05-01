import { describe, expect, it, vi } from "vitest";
import {
  claimNonce,
  inspectNonce,
  type NonceRow,
  type NonceStore,
} from "../nonce.server";

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NONCE = "deadbeef";
const ROW_ID = "row-1";
const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function makeRow(overrides: Partial<NonceRow> = {}): NonceRow {
  return {
    id: ROW_ID,
    consumed: false,
    expires_at: FUTURE,
    wallet_address: WALLET,
    ...overrides,
  };
}

function makeStore(opts: {
  row?: NonceRow | null;
  fetchError?: { message: string } | null;
  claimRowsAffected?: number;
  claimError?: { message: string } | null;
}): NonceStore {
  return {
    fetch: vi.fn(async () => ({
      data: opts.row ?? null,
      error: opts.fetchError ?? null,
    })),
    claim: vi.fn(async () => ({
      rowsAffected: opts.claimRowsAffected ?? 0,
      error: opts.claimError ?? null,
    })),
  };
}

describe("inspectNonce", () => {
  it("accepts a fresh, unused, wallet-bound nonce", async () => {
    const store = makeStore({ row: makeRow() });
    const res = await inspectNonce(store, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(res).toEqual({ ok: true, rowId: ROW_ID });
  });

  it("rejects unknown nonces", async () => {
    const store = makeStore({ row: null });
    const res = await inspectNonce(store, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe("unknown");
  });

  it("rejects already-consumed nonces (replay)", async () => {
    const store = makeStore({ row: makeRow({ consumed: true }) });
    const res = await inspectNonce(store, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe("already_used");
  });

  it("rejects expired nonces", async () => {
    const store = makeStore({ row: makeRow({ expires_at: PAST }) });
    const res = await inspectNonce(store, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe("expired");
  });

  it("propagates lookup errors", async () => {
    const store = makeStore({ fetchError: { message: "db down" } });
    const res = await inspectNonce(store, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failure.kind).toBe("lookup_failed");
      if (res.failure.kind === "lookup_failed") {
        expect(res.failure.message).toBe("db down");
      }
    }
  });
});

describe("claimNonce (compare-and-swap)", () => {
  it("succeeds when one row is updated", async () => {
    const store = makeStore({ claimRowsAffected: 1 });
    const res = await claimNonce(store, { id: ROW_ID, nowIso: new Date().toISOString() });
    expect(res).toEqual({ ok: true, rowId: ROW_ID });
  });

  it("rejects when zero rows are affected (concurrent replay)", async () => {
    const store = makeStore({ claimRowsAffected: 0 });
    const res = await claimNonce(store, { id: ROW_ID, nowIso: new Date().toISOString() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe("race_lost");
  });

  it("propagates claim errors", async () => {
    const store = makeStore({ claimError: { message: "constraint" } });
    const res = await claimNonce(store, { id: ROW_ID, nowIso: new Date().toISOString() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe("claim_failed");
  });
});

describe("nonce lifecycle (replay scenario)", () => {
  it("first verify wins, second verify with same nonce loses race", async () => {
    // Two concurrent verifications inspect the same fresh row simultaneously.
    const row = makeRow();
    const sharedStore: NonceStore = {
      fetch: vi.fn(async () => ({ data: row, error: null })),
      // Only the first claim sees rowsAffected=1; the second sees 0 because
      // the WHERE consumed=false predicate no longer matches.
      claim: vi
        .fn()
        .mockResolvedValueOnce({ rowsAffected: 1, error: null })
        .mockResolvedValueOnce({ rowsAffected: 0, error: null }),
    };

    const insp1 = await inspectNonce(sharedStore, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    const insp2 = await inspectNonce(sharedStore, {
      nonce: NONCE,
      walletLower: WALLET,
      nowMs: Date.now(),
    });
    expect(insp1.ok).toBe(true);
    expect(insp2.ok).toBe(true); // both see "fresh" before either claims

    const claim1 = await claimNonce(sharedStore, {
      id: ROW_ID,
      nowIso: new Date().toISOString(),
    });
    const claim2 = await claimNonce(sharedStore, {
      id: ROW_ID,
      nowIso: new Date().toISOString(),
    });
    expect(claim1.ok).toBe(true);
    expect(claim2.ok).toBe(false);
    if (!claim2.ok) expect(claim2.failure.kind).toBe("race_lost");
  });
});
