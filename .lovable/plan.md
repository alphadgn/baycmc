## Restructure access into 3 tiers + remove Tokenproof

### Tier model
- **Lobby** — any signed-in Privy user. New default landing after sign-in for non-holders.
- **Verified Holder** — Privy + on-chain BAYC/MAYC ownership confirmed (existing `bayc_verified`).
- **Lifer** — Verified Holder + Otherpage (existing `is_lifer`).

### 1. Remove Tokenproof
- Delete `src/server/tokenproof.functions.ts` (if still present) and any Tokenproof UI in `EntranceDialog.tsx`.
- Strip Tokenproof copy across the app (landing, headers, modals).
- Remove the `TOKENPROOF_*` secret from project config (note for user: secret remains in vault unless deleted via UI).
- Privy becomes the sole auth path; Supabase session is minted immediately on Privy login with no ownership requirement.

### 2. Database / RLS migration
- Rename SQL helper `is_token_proof_verified` → `is_verified_holder` (keep old as alias wrapper for backward compat to avoid breaking dependent policies during rollout).
- Add `SELECT` policies:
  - `rooms`: any authenticated user can read (locked preview).
  - `profiles`: any authenticated user can read public columns (username, avatar_url, bio). Tighten current policy that limits SELECT to self.
- Confirm posts/messages/room_bookings/ape_rides remain gated behind `is_verified_holder()` for INSERT/UPDATE; add explicit SELECT denies for lobby (currently `posts`/`messages` allow all authenticated reads — change to `is_verified_holder(auth.uid())` for SELECT too).
- Lifer tables stay on `is_lifer()`.

### 3. Route restructure
- Keep `_authenticated.tsx` as the lobby gate (Supabase session required).
- Create `src/routes/_authenticated/_verified.tsx` pathless layout — `beforeLoad` checks `bayc_verified`; redirects to `/lobby` if not.
- Move under `_verified`: `feed`, `messages`, `rooms`, `rooms.$roomId`, `ape-rides`, `ape-rides.$rideId`.
- Lifer routes remain nested with their existing dual-check gate.
- New `src/routes/_authenticated/lobby.tsx` — welcome card, locked rooms grid, public-profile directory.
- Update `src/routes/index.tsx` post-login redirect: verified → `/feed`, otherwise → `/lobby`.

### 4. Client state & nav
- `useVerificationStatus`: rename `tokenProof` → `isVerifiedHolder`; add `isLobby` (signed-in but not verified). Keep `tokenProof` as a deprecated alias for one pass to avoid breaking imports while files are updated.
- `AppHeader`:
  - Lobby user → Home, Lobby, Profile, gold **"Verify holder access"** CTA (opens verification modal).
  - Verified → Feed, Messages, Rooms, Ape Rides, Profile + "Verified" badge in WalletPill area.
  - Lifer adds Lifers / Lifer Chat (unchanged).
- `EntranceDialog` becomes pure Privy sign-in (no ownership step). New `VerifyHolderDialog` triggered from the header CTA + every locked room card runs the existing `verifyPrivyOwnership` flow.

### 5. Locked rooms preview
- Reuse existing room card component; add a `locked` variant: subtle backdrop-blur, gold lock icon overlay, "Verify to unlock" CTA that opens `VerifyHolderDialog`. Disable Enter/Book actions.
- Public profile directory on `/lobby`: simple grid pulling `profiles` (username, avatar, bio).

### 6. Copy updates
- Landing "How access works":
  1. Sign in (any wallet or email) → enter the lobby.
  2. Verify your BAYC/MAYC to unlock conference rooms and events.
  3. Hold a Lifer token to unlock the secret Lifer clubhouse.
- Strip Tokenproof mentions from any marketing copy.

### Technical notes
- The `usePrivyBridge` already mints a Supabase session for any Privy login regardless of NFT ownership (per prior work) — verify and keep. The bridge stops being a verification gate; verification is an explicit user action.
- RLS changes affect existing verified users only via the rename — alias function preserves behavior.
- Profiles RLS change is the biggest blast-radius item: add an `is_public` column? No — per spec, all signed-in users can browse the directory. Limit columns selected on the lobby page to avoid exposing wallet_address: query only `id, username, avatar_url, bio` from client-side calls in lobby contexts.

### Out of scope
- Editing the locked-state visual to "premium" beyond a clean blur + gold lock (aesthetic polish can iterate after).
- Migrating existing Tokenproof-verified users (none exist in production per prior context).

### Files touched (approx)
- New: `src/routes/_authenticated/lobby.tsx`, `src/routes/_authenticated/_verified.tsx`, `src/components/VerifyHolderDialog.tsx`, `src/components/LockedRoomCard.tsx`, supabase migration.
- Edited: `AppHeader.tsx`, `EntranceDialog.tsx`, `useVerificationStatus.ts`, `routes/index.tsx`, `routes/_authenticated/feed.tsx` + siblings (move under `_verified`), landing copy in `routes/index.tsx`.
- Deleted: `src/server/tokenproof.functions.ts` (if present), any `tokenproofVerifiedSession` helpers.
