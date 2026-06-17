# NFT Ownership Validation + Delegate Resolution Refactor

## Goal

Replace today's "connected-wallet-only-ish" gating with a single ownership engine that authorizes a user if **any** wallet in their graph (connected, linked, delegate, vault) holds BAYC (`0xBC4CA0…f13D`) or MAYC (`0x60E4…a7c6`). This engine becomes the sole gate for clubhouse / rooms / posting / lifers / livekit.

## What already exists (keep, refactor, don't duplicate)

- `src/server/ownership.server.ts` — `recomputeOwnership(userId)`: already does direct balanceOf, delegate.cash incoming delegations (contract-level for BAYC/MAYC + wallet-level), walks `linked_wallets`, and walks each linked wallet's delegate vaults. Writes `user_verifications`.
- `src/server/verification.functions.ts` — thin server fn wrapping `recomputeOwnership`.
- `src/lib/baycmc/useVerificationStatus.ts` — single hook all UI uses for `isVerifiedHolder` / `isLifer` / `isAdmin`.
- `src/routes/_authenticated/_verified.tsx`, `_authenticated/lifers.tsx` — beforeLoad calls `revalidateOwnership` then checks `user_verifications`.
- `src/server/livekit.functions.ts` — server-side gate on room entry.
- `src/lib/web3/constants.ts` — `BAYC_CONTRACT`, `DELEGATE_REGISTRY_V2`, `ETH_RPC_URL`.
- `linked_wallets` table with signature-verified rows; `LinkedWalletsPanel` UI.
- `/verify` walkthrough route.

So phases 1–4 are mostly already in place — this refactor extends and centralizes, it does not rebuild from zero.

## Gap list (what's actually wrong / missing)

1. `MAYC` is hardcoded as a string in `ownership.server.ts` — not in `constants.ts`. No `REQUIRED_COLLECTIONS` export.
2. `resolveDelegatedVaults` only walks **incoming** delegations (delegate → vaults). It does not walk **outgoing** delegations (vault → delegates) for the user's wallets. If the user signs in with a vault wallet that delegated to another address, we don't pick up the delegate. (`getOutgoingDelegations` on Registry v2.)
3. Resolution logic is inlined inside `recomputeOwnership`. There is no reusable, return-the-graph `resolveOwnership(userId)` that returns `{ allowed, ownership[], scanned[] }`. Livekit, hooks, /verify all need it.
4. No structured `console.group("NFT Gate")` logging or telemetry events.
5. Short-TTL cache exists only implicitly (`user_verifications` row + hook refetch). No explicit `ownership:<wallet>:<block>` 60s memo on the server to dedupe parallel balanceOf calls within a request burst.
6. Client `useVerificationStatus` doesn't return the wallet graph (scanned/ownership) — `/verify` and any debug panel can't show *why* a user passed.
7. Acceptance scenarios aren't covered by a single unit test.

## Files to add

```text
src/server/ownership/
  collections.ts          # REQUIRED_COLLECTIONS + ERC721 ABI
  delegateResolver.ts     # incoming + outgoing delegate.cash walk
  collectionScanner.ts    # balanceOf fan-out per (wallet, contract)
  ownershipCache.ts       # in-memory 60s memo keyed by wallet+block
  resolveOwnership.ts     # main engine: returns OwnershipResult
```

`src/state/authGate.ts` — pure selector over `useVerificationStatus` exposing `{ signedIn, ownershipResolved, ownsRequiredAsset, showLobby, showConferenceRooms, showClubhouse, showPosting }`. UI consumes this, not raw flags.

`tests/unit/resolve-ownership.test.ts` — 8 acceptance scenarios with mocked viem client + delegate registry.

## Files to refactor

- `src/lib/web3/constants.ts` — add `MAYC_CONTRACT`, export `REQUIRED_COLLECTIONS`.
- `src/server/ownership.server.ts` — `recomputeOwnership` becomes a thin wrapper around `resolveOwnership(userId)` that persists the result to `user_verifications` and triggers Otherpage/Lumina. Returns the same `OwnershipSnapshot` shape so callers don't break.
- `src/server/verification.functions.ts` — add `getOwnershipGraph` server fn returning the full `OwnershipResult` for UI debug panels.
- `src/server/livekit.functions.ts` — keep calling `recomputeOwnership` (no behavior change; just rides on the engine).
- `src/lib/baycmc/useVerificationStatus.ts` — add optional `graph` field populated from `getOwnershipGraph` when caller asks; default behavior unchanged.
- `src/routes/verify.tsx` — render `graph.scanned` + `graph.ownership` once signed in so the walkthrough actually shows the wallet graph.
- AppHeader / nav / any component currently doing `walletConnected` gating — replace direct flag reads with `authGate` selector. Sweep: `rg "walletConnected|isAuthenticated &&" src` and migrate consumers.

## Engine contract

```ts
type OwnershipResult = {
  allowed: boolean;
  ownership: Array<{ wallet: string; contract: string; balance: number }>;
  scanned: string[];          // every address we balanceOf'd
  edges: Array<{ from: string; to: string; via: "linked" | "delegate-in" | "delegate-out" | "vault" }>;
  blockNumber: bigint;
};
```

Algorithm (mirrors the spec):

1. Seed set = `profile.wallet_address` (lowercased).
2. Add `linked_wallets` rows where `verified_at is not null`.
3. For each address in the set, in parallel:
   - `getIncomingDelegations(addr)` → add `from` vaults (filter for BAYC/MAYC contract-level or all/wallet-level with empty rights).
   - `getOutgoingDelegations(addr)` → add `to` delegates (same filter).
4. Dedupe (lowercased), cap at 32 addresses to bound RPC.
5. `collectionScanner.scan(addresses, REQUIRED_COLLECTIONS)` → multicall-style parallel `balanceOf`. Cache each `(wallet, contract, block)` for 60s in `ownershipCache`.
6. Build `OwnershipResult`. `allowed = ownership.length > 0`.
7. Emit structured log (`console.group("NFT Gate")` with connected / linked / delegates / scanned / ownership).

## Cache + refresh

- `ownershipCache`: `Map<\`${wallet}:${contract}:${block}\`, { balance, expires }>` with 60s TTL. Used only inside a single Worker invocation lifetime — Workers are short-lived so this is a request-burst memo, not a global cache. `user_verifications` row remains the persisted truth.
- Client: TanStack Query (where used) gets `staleTime: 60_000`, `retry: 2`, `refetchOnReconnect: true`.
- Refresh triggers (already wired via `baycmc:verification-refresh`): login, reconnect, manual refresh, account-merge. Add: delegate-update (new event fired by `LinkedWalletsPanel` after add/remove).

## AuthGate centralization

```ts
// src/state/authGate.ts
export function useAuthGate() {
  const v = useVerificationStatus();
  return {
    signedIn: !v.loading && (v.isLobby || v.isVerifiedHolder),
    ownershipResolved: !v.loading,
    ownsRequiredAsset: v.isVerifiedHolder,
    showLobby: v.isLobby || v.isVerifiedHolder,
    showConferenceRooms: v.isVerifiedHolder,
    showClubhouse: v.isVerifiedHolder,
    showPosting: v.isVerifiedHolder,
    showLifers: v.isLifer,
    isAdmin: v.isAdmin,
  };
}
```

All header/nav/menu logic migrates to this. Server-side gates (`_verified`, `lifers`, livekit, RLS) stay as they are — they already hit the engine.

## Observability

In `resolveOwnership`, behind a `if (process.env.NODE_ENV !== "production" || process.env.NFT_GATE_DEBUG)` guard, emit the structured `console.group` from the spec plus single-line telemetry events: `nft-gate.wallet-scanned`, `delegate-found`, `ownership-confirmed`, `ownership-denied`. Same events fired on the client when `authGate` flips reveal/hide.

## Acceptance tests

`tests/unit/resolve-ownership.test.ts` mocks viem `readContract` + delegate registry and covers the 8 scenarios from the spec. Run via `bunx vitest run tests/unit/resolve-ownership.test.ts`.

## Out of scope

- Visual/UI design changes (constraint: keep existing UI intact).
- Removing Privy — Privy is the email/embedded-wallet provider, not an ownership oracle here; existing code does not use Privy for NFT checks (only Glyph's connected address). Sweep will confirm and remove any leftover Privy-based ownership references if found.
- Replacing the `user_verifications` table — keep as the persisted snapshot the RLS helpers read.

## Risk / rollback

- Engine is additive: `recomputeOwnership`'s public signature is preserved. If the engine regresses, revert `ownership.server.ts` to call the prior inline logic.
- Cap of 32 scanned addresses prevents RPC blowups from pathological delegate graphs.
