# Auth Rebuild Plan

Two clean layers, no overlap:

- **AUTHENTICATION (who you are):** Supabase Auth issues the session and the JWT every RLS policy already trusts. Login UI is Privy's modal (email / Google / wallet). After Privy login, the embedded wallet signs a SIWE-style nonce, a server function verifies it and signs the user into Supabase. Supabase remains the only session authority.
- **AUTHORIZATION (what you can do):** A server function calls `balanceOf` on BAYC (`0xBC4C…f13D`) and MAYC (`0x60E4…a7c6`) using `ETH_RPC_URL`, writes `user_verifications.bayc_verified` + `bayc_collection`. Existing `is_token_proof_verified` / `is_lifer` SQL helpers and every RLS policy keep working unchanged.

## What gets deleted

- `src/components/EntranceDialog.tsx` Tokenproof tab + `pollTokenproofSession` flow
- `src/server/tokenproof.functions.ts`, `src/server/token-proof.server.ts`
- `src/lib/baycmc/verifiedSession.ts` (localStorage/cookie session cache — no longer needed; DB is truth)
- `src/components/PrivyTroubleshootPanel.tsx`, `src/components/PrivyVerifyCard.tsx` (replaced)
- `src/components/Web3Provider.tsx`, `src/lib/web3/appkit.ts` (AppKit/Wagmi — Privy replaces it)
- `src/lib/wallet/useWallet.ts` (already a stub)
- `src/server/wallet-password.ts` if unused after rewrite

## What gets added / rewritten

1. **`src/components/PrivyAppProvider.tsx`** — single provider, exact spec config:
   ```
   loginMethods: ['email','google','twitter','wallet']
   embeddedWallets: { ethereum: { createOnLogin: 'all-users' } }
   appearance: { theme: 'dark' }
   ```
   Mounted once in `__root.tsx`. No retries, no manual `createWallet`.

2. **`src/components/EntranceDialog.tsx`** — replaced with a thin component that calls `login()` from `usePrivy()`. No tabs, no polling, no localStorage.

3. **`src/lib/auth/usePrivySupabaseBridge.ts`** (new client hook) — when `ready && authenticated && embeddedWallet?.address` and there is no Supabase session, run the bridge once:
   - Call `requestSiweNonce({ address })` server fn
   - `embeddedWallet.sign(message)` (Privy embedded wallet signs without UX prompt)
   - Call `verifySiweAndSignIn({ address, signature, nonce })` server fn → returns a Supabase session (`access_token` + `refresh_token`)
   - `supabase.auth.setSession(...)` → onAuthStateChange fires → app is signed in

4. **`src/server/siwe.functions.ts`** (new) —
   - `requestSiweNonce`: insert into existing `auth_nonces` table (already exists with `wallet_address`, `nonce`, `expires_at`, `consumed`), return nonce.
   - `verifySiweAndSignIn`: verify EIP-191 signature with viem, mark nonce consumed, then with `supabaseAdmin`:
     - Find or create auth user with email = `${address}@wallet.baycmc` (or use `admin.createUser` + magic-link generation), upsert `profiles.wallet_address`, `admin.generateLink({ type: 'magiclink' })` → exchange for session via `verifyOtp({ token_hash, type: 'magiclink' })`. Return `{ access_token, refresh_token }` to client.

5. **`src/server/verification.functions.ts`** — replace Tokenproof body with on-chain check:
   - `verifyNftOwnership({ address })`: viem `createPublicClient({ transport: http(process.env.ETH_RPC_URL) })`, `balanceOf(address)` on BAYC then MAYC; pick first non-zero, set `bayc_verified=true`, `bayc_collection='BAYC'|'MAYC'`, `bayc_token_ids=[]` (we don't need IDs for gating). Server fn protected by `requireSupabaseAuth`.

6. **`src/lib/baycmc/useVerificationStatus.ts`** — unchanged interface, still reads `user_verifications`. Add a `verify()` action that calls `verifyNftOwnership`.

7. **`src/components/AppHeader.tsx`** — drop the `verifiedSession` cache logic; show pill purely from `useAuth()` + `useVerificationStatus()`. Trigger `verifyNftOwnership` automatically once after Supabase session + wallet are ready and `bayc_verified` is false.

8. **`src/routes/_authenticated.tsx`** — keep as-is (Supabase session gate). Add a sibling `_verified.tsx` layout that additionally requires `bayc_verified=true` (loader queries `user_verifications`). Move `rooms`, `lifers`, `ape-rides`, `messages` under it. `feed` and `profile` stay under `_authenticated` only (public lobby tier).

## Database

No schema changes required. Reuses:
- `auth_nonces` (already has wallet_address/nonce/expires_at/consumed)
- `user_verifications.bayc_verified` / `bayc_collection`
- `is_token_proof_verified` / `is_lifer` SQL functions
- All RLS policies unchanged

## Secrets

Already present: `PRIVY_APP_ID`, `ETH_RPC_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No new secrets.

Need to confirm: `VITE_PRIVY_APP_ID` is exposed to the client bundle (Privy SDK requires the app ID at provider mount). If only `PRIVY_APP_ID` exists server-side I'll add the `VITE_` mirror.

## Why this kills the infinite loop

The current loop is fed by the Supabase-session-vs-Privy-wallet round trip happening inside the verify card. Once the bridge runs **once** at app root (ref-guarded by address) and the verify card is gone, there's nothing left to re-enter.

## Out of scope (intentionally)

- No UI redesign
- No changes to `Lumina`, `delegate.cash`, or `otherpage` admin paths
- No changes to LiveKit, Ape Rides logic, messaging, posts, room booking — all keep working because RLS keys haven't moved.
- Removing AppKit/Wagmi only if no other code path imports them; otherwise left in place and unused.

After approval I'll execute in this order: (1) Privy provider + bridge + SIWE server fn, (2) replace Entrance dialog, (3) on-chain verify server fn, (4) header cleanup, (5) `_verified` layout, (6) delete old files, (7) verify with `invoke-server-function` + console logs on the live build.