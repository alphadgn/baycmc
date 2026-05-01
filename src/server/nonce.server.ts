// Server-only helpers for SIWE nonce lifecycle.
// Pure functions live here so they can be unit-tested with a mock supabase client
// without touching the network. Never import from client code.

export interface NonceRow {
  id: string;
  consumed: boolean;
  expires_at: string;
  wallet_address: string;
}

export interface NonceStore {
  fetch(args: { nonce: string; walletLower: string }): Promise<{
    data: NonceRow | null;
    error: { message: string } | null;
  }>;
  claim(args: { id: string; nowIso: string }): Promise<{
    rowsAffected: number;
    error: { message: string } | null;
  }>;
}

export type NonceFailure =
  | { kind: "lookup_failed"; message: string }
  | { kind: "unknown" }
  | { kind: "already_used" }
  | { kind: "expired" }
  | { kind: "claim_failed"; message: string }
  | { kind: "race_lost" };

export type NonceResult =
  | { ok: true; rowId: string }
  | { ok: false; failure: NonceFailure };

/**
 * Validate a nonce against (wallet, expiry, single-use) and atomically claim it.
 * Atomicity is delegated to the store's `claim` (a conditional UPDATE in production).
 *
 * Order:
 *   1. lookup by (nonce, wallet) — wallet binding prevents cross-wallet replay
 *   2. reject if consumed or expired (fast-path; gives a precise error message)
 *   3. caller verifies signature (NOT here — this fn is auth-agnostic)
 *   4. caller invokes claim() to compare-and-swap
 *
 * For tests, this function exposes both the lookup decision and the claim outcome.
 */
export async function inspectNonce(
  store: Pick<NonceStore, "fetch">,
  args: { nonce: string; walletLower: string; nowMs: number },
): Promise<NonceResult> {
  const { data, error } = await store.fetch({
    nonce: args.nonce,
    walletLower: args.walletLower,
  });
  if (error) return { ok: false, failure: { kind: "lookup_failed", message: error.message } };
  if (!data) return { ok: false, failure: { kind: "unknown" } };
  if (data.consumed) return { ok: false, failure: { kind: "already_used" } };
  if (new Date(data.expires_at).getTime() < args.nowMs) {
    return { ok: false, failure: { kind: "expired" } };
  }
  return { ok: true, rowId: data.id };
}

export async function claimNonce(
  store: Pick<NonceStore, "claim">,
  args: { id: string; nowIso: string },
): Promise<NonceResult> {
  const { rowsAffected, error } = await store.claim(args);
  if (error) return { ok: false, failure: { kind: "claim_failed", message: error.message } };
  if (rowsAffected === 0) return { ok: false, failure: { kind: "race_lost" } };
  return { ok: true, rowId: args.id };
}
