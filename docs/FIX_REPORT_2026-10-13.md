# BAYCmc — Build audit & fix report (Oct 13, 2026)

Scope: Glyph / wallet sign-in modal, karaoke rooms (logic + audio), the four
requested features (admin panel, recording, backing-track upload, booking),
and a security pass across auth, RLS and server functions.

Status of this package: `tsc` clean, production build passes (client + SSR +
Cloudflare worker), CI guards pass (server-import, SSR polyfill), 42/42 unit
tests pass, the worker boots under `wrangler dev` and serves `/`, `/login`,
`/lobby`, `/karaoke`. Every Postgres migration was replayed in order on
Postgres 16 and an RPC test suite (stage, queue, mute, booking, settings,
room create/delete, profile trigger) passes — on a fresh DB **and** on a DB
that already had the old drizzle karaoke migration.

---

## 1. Critical findings (fix before anything else)

| # | Severity | Problem | Fix (in this package) |
|---|---|---|---|
| 1 | **Critical** | **Token-gate bypass.** `verifyOwnership` trusted a `linkedWallets` array sent by the browser. Anyone could sign with an empty wallet, list a whale's address, and be marked BAYC/MAYC-verified. | Server ignores client wallet lists. Linked wallets now come only from Glyph's API (queried server-side with the signer-bound Glyph token) or from `linked_wallets` rows proven by signature. `src/server/wallet.functions.ts` |
| 2 | **Critical** | **Account takeover / privilege theft.** `mergeAccounts` accepted any `otherUserId`. Any signed-in member could absorb another account — including its `super_admin` role — and delete it. | Merge / keep-separate re-run collision detection server-side and require the pair to match; collision sources limited to server-verified wallets. `src/server/account-merge.functions.ts` |
| 3 | High | **Any member could control / skip someone else's song.** In the (drizzle) RPCs, `karaoke_is_moderator` returned NULL with no active booking and `IF … AND NOT NULL` let the call through. | `COALESCE(..., false)`; covered by the SQL test suite. |
| 4 | High | **Queue griefing.** `karaoke_heartbeat(_room, _grace_s)` trusted the client's grace period — calling it with `0` evicted the singer and wiped the line. | Grace fixed server-side (45 s); 2-arg overload dropped. |
| 5 | High | **SIWE replay.** Nonce generated in the browser and never checked server-side → a captured signature worked for 10 minutes. | Server-issued, single-use nonce (`getSiweNonce`), atomically consumed. |
| 6 | Medium | Search-cache poisoning: any user could INSERT/UPDATE `karaoke_search_cache` (URLs served to everyone). | Client write policies dropped (server writes with service role). |
| 7 | Medium | Direct writes to `karaoke_sessions` / `karaoke_queue` still granted to `authenticated`. | Revoked; RPCs are the only write path (matches AGENTS.md). |
| 8 | Medium | Recordings bucket was **public** (anyone with a URL could download members' performances). | Bucket private; playback via 1-hour signed URLs; upload path + object existence validated. |
| 9 | Low | `.env` in the archive includes `GIPHY_API_KEY` (a server secret). | Rotate the Giphy key; keep `.env` out of the repo (add to `.gitignore`). The Supabase *publishable* key is meant to be public. |

---

## 2. Glyph wallet modal — "sign in with Glyph email OR a wallet"

### What was wrong
1. `<GlyphWalletProvider>` builds a wagmi config with **only** the Glyph connector and disables EIP-6963 discovery → MetaMask / Rabby / Coinbase / Ledger users could not sign in with the wallet that actually holds their ape.
2. `<GlyphWalletProvider>` returns `null` until Glyph's chain list loads → **the whole app rendered blank** during that request, and stayed blank if it failed (ad-blockers, Glyph outage).
3. The provider was swapped in after a dynamic import, changing the tree above `<Outlet/>` → the entire app **remounted once per page load** (double effects, double karaoke joins).
4. The header VIP button opened the modal **and** fired Glyph `connect()` on the same click — users never got a choice, and the async rejection was unhandled ("Glyph Wallet Connector not found" / popup blocked surfaced as nothing happening).
5. `/account-merge` used `useQuery` but the only `QueryClientProvider` was inside Glyph → crashed when Glyph didn't load.
6. Email/password members had **no header menu at all** (no Profile, no Sign out).
7. Wallet sign-in looked accounts up with `listUsers({ perPage: 1000 })` → returning wallets stop working after 1,000 members.

### What it does now
- **Entrance modal** offers: **Continue with Glyph** (email, social, Glyph wallet via Glyph's own popup) · **Connect a wallet** (every detected browser wallet by name + WalletConnect; mobile deep links to MetaMask / Coinbase apps) · link to **Email & password**.
- Then one gasless **"Sign to enter"** SIWE signature (nonce prefetched on connect so Glyph's popup opens inside the tap).
- Email members who open the modal are sent to **Profile → Linked Wallets** instead of being silently switched to a different account.
- Stable provider tree (QueryClient + wagmi always mounted, SSR-safe); Glyph and WalletConnect connectors are added after mount; their heavy SDKs are excluded from the server bundle.

Files: `GlyphAppProvider.tsx`, `lib/auth/useGlyphBridge.tsx`, `EntranceDialog.tsx`, `AppHeader.tsx`, `routes/login.tsx`, `server/wallet.functions.ts`.

**Setup you must do:** set `VITE_REOWN_PROJECT_ID` to your own Reown (WalletConnect) project and add your published domain + preview domain to its allow-list; set `SITE_DOMAIN` (server) to your production host.

---

## 3. Karaoke audit — what didn't match real karaoke apps

| # | Problem (why testing failed / felt broken) | Real-app behaviour | Fix |
|---|---|---|---|
| K1 | **The RPCs the client calls (`karaoke_heartbeat`, `claim_stage`, `control`, `end_turn`, `join/leave_queue`) existed only in `drizzle/migrations/`, which Lovable Cloud does not apply.** On any DB without them every karaoke action fails with "function does not exist". | — | New idempotent migration in `supabase/migrations/` recreates everything (safe whether or not drizzle ran). The UI now says so explicitly if they're missing. |
| K2 | **Any active booking locked the whole room** — non-hosts couldn't even join LiveKit. | A booking reserves the *stage*, the audience still watches. | Bookings/reservations reserve the stage only; only bans block entry. |
| K3 | **Music and voice never in sync.** Every viewer played their own YouTube copy (started at different times); the voice arrived separately over LiveKit. | Smule / StarMaker / KaraFun Party mix backing + voice on the singer's device and send ONE stream. | `KaraokePerformerEngine` mixes mic + backing track (+ optional YouTube tab audio) and publishes one `karaoke-mix` track; listeners mute their local YouTube copy when the music is in the mix. |
| K4 | **Phone singers sang over silence** (no tab-audio capture on mobile). | Uploaded / licensed instrumentals play on the singer's device. | Backing-track upload (see §4.3). |
| K5 | The mix bus and recorder **existed but were never mounted**; `saveKaraokeRecording` was never called → no recordings, ever. Even if mounted, the bus routed the music element into Web Audio with monitor = 0 → the singer would hear nothing. | Singer hears the track; every performance is saved. | Engine mounted; music monitor path added; one take recorded per song. |
| K6 | "Recent Takes" panel rendered **behind** the full-screen fixed shell (body scroll locked) → invisible / unreachable. | — | Moved into a "Room hub" slide-over (Rules · Book · Takes · Admin). |
| K7 | Late joiners started the lyric video at 0:00; `position_ms/position_at` were stored but never used; YouTube `listType=search` embeds were removed by YouTube in 2020. | Everyone sees the same second. | Start offset from server position + server clock skew; drift correction via YouTube iframe API; search embed removed. |
| K8 | "Singer Live" banner showed the **viewer's own** mic state. | Shows the performer's on-air state. | Computed from the performer's LiveKit track. |
| K9 | Mic volume slider applied a gain processor to *any* Microphone-source track (would wrap the whole mix); the room-wide mute only muted mics, a muted user could rejoin and talk. | — | Performer volume applied inside the bus; mutes enforced in LiveKit permissions and in the token (`canPublish:false`). |
| K10 | Promoted while not connected to LiveKit → the turn stalled. | — | Joining the line auto-connects; the machine shows a "Connect" prompt if needed. |
| K11 | Email accounts had no profile row → names showed as raw IDs. | — | Profile auto-created on sign-up (+ backfill). |
| K12 | `createBooking` demanded BAYC verification even for karaoke (RLS allowed it). | — | Karaoke / public rooms bookable by every member. |
| K13 | `/karaoke` always jumped to the first room, so a second room could never be listed. | — | Auto-jump only when exactly one room exists. |
| K14 | Mic DSP fixed regardless of setup. | Apps ask "headphones or speaker?" | Headphones mode (studio, DSP off) / Speaker mode (echo cancellation on). |

---

## 4. The four requested features (implemented)

### 4.1 Admin panel in karaoke rooms — rules, mute, delete
Room hub → **Admin** (admins; booking hosts get moderation only):
- **Rules & settings:** house rules text, max song length (auto-ends over-long songs), max slot length, bookings per member, booking window, booking-only mode, holders-first priority, allow YouTube / uploads / recording.
- **Members in the room:** Mute 10 min / 1 h / until lifted, Unmute, Kick, Ban (admin). Mutes are enforced by the database (no queue/stage) **and** LiveKit (publish permission revoked live and at next token).
- **Stage:** Skip performer, Clear the line, Lock/unlock room.
- **Delete room:** type-the-name confirmation → recordings files removed, DB cascade, LiveKit room closed. Also **Create / Delete rooms** at `/admin/karaoke`.

### 4.2 Recording — every performance saved and replayable
- Starts automatically when an on-air singer starts a song, pauses with the song, one take per song; saves what the room heard (voice + backing).
- Uploaded to the private bucket, listed under **Takes** with signed URLs; performer can make a take private or delete it; admins can delete any take; a "● REC" indicator shows while recording. Admin switch to disable recording per room.

### 4.3 Backing-track upload — real music for phone singers
- **My tracks** tab in the karaoke machine: upload MP3/M4A/WAV/OGG/WebM (≤ 30 MB) with optional lyrics; private by default, "Share with the club" toggle.
- Playing a track: it is decoded on the singer's phone, heard in their ears, and mixed with their voice into the single stream the room hears; play/pause/seek follow the server state; when the track ends the turn ends automatically. Lyrics appear on everyone's screen.

### 4.4 Booking — reserve a time slot and singer before joining
- Room hub → **Book**: date, 5-minute start time, length, singer (**me** or **another member** by username), optional song / artist / uploaded backing track, notes. Live list of upcoming slots; cancel by booker, singer or moderator.
- Server rules: no overlapping slots per room or per singer, booking window, per-member limit, mutes/bans respected, singer is notified.
- When a slot starts the reserved singer gets the stage as soon as they're in the room; if they don't show within 3 minutes the slot is marked no-show and open mic resumes. The waiting list shows "Next booked: … at …".

---

## 5. Deploy steps (in this order)

1. **Replace the code** in the GitHub repo connected to Lovable with this package (or upload it), commit, and let Lovable sync.
2. **Apply the two migrations** in `supabase/migrations/` (if Lovable doesn't pick them up automatically, use the Lovable prompt below or run them in the Cloud SQL editor, `…000001` first):
   - `20261013000001_karaoke_v2_authoritative_stage.sql`
   - `20261013000002_security_hardening.sql`
3. **Secrets (Cloud → Secrets):** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (without these every karaoke join fails with "LiveKit not configured"), `SUPABASE_SERVICE_ROLE_KEY`, `SITE_DOMAIN` (e.g. `baycmc.com`), `ETH_RPC_URL` (Alchemy/Infura mainnet), `FIRECRAWL_API_KEY` (song web-search; optional). Build-time: `VITE_REOWN_PROJECT_ID`.
4. **Rotate** `GIPHY_API_KEY` (it was in the uploaded `.env`).
5. Publish, then run the test checklist (§7) on the **published** URL — Glyph's popup is blocked inside the embedded editor preview.

### Lovable prompts (paste as-is)

**Apply the database changes**
> Apply the two new migrations in supabase/migrations (20261013000001_karaoke_v2_authoritative_stage.sql then 20261013000002_security_hardening.sql) exactly as written, then regenerate src/integrations/supabase/types.ts. Do not modify the SQL. Do not edit karaoke_sessions or karaoke_queue from the client — all karaoke writes stay in the karaoke_* RPCs per AGENTS.md.

**Your four original requests — already built; use these only if you need Lovable to adjust them:**
> Add an admin panel to karaoke rooms where I can set rules, mute members and delete rooms. — *Implemented as Room hub → Admin (KaraokeAdminPanel.tsx, karaoke-admin.functions.ts, RPCs karaoke_update_settings / karaoke_set_sanction / karaoke_admin_delete_room). Extend that panel rather than creating a new one.*

> Add a recording feature to the karaoke room so each performance is saved and replayable. — *Implemented in KaraokePerformerEngine.tsx (recorder) + recordings.functions.ts (private bucket, signed URLs) + Room hub → Takes.*

> Build the backing track upload so phone singers get real music in the karaoke room. — *Implemented as Karaoke Machine → My tracks (KaraokeTrackLibrary.tsx) mixed on the singer's device by audioMixBus.ts.*

> Build a karaoke booking system where members can reserve a time slot and singer before joining a room. — *Implemented as Room hub → Book (KaraokeBookingPanel.tsx) on RPCs karaoke_book_slot / karaoke_cancel_reservation; the stage hand-off happens in karaoke_heartbeat.*

---

## 6. Not changed — recommended follow-ups

- **Lockfiles / CI:** `package-lock.json` is out of sync with `package.json` (`npm ci` fails with ERESOLVE); `bun.lock` points at Lovable's private npm cache (GitHub Actions `bun install --frozen-lockfile` gets 403). CI smoke tests expect `dist/server/wrangler.json` but the build emits `.output/server/`. Either delete `package-lock.json` and regenerate `bun.lock` against the public registry, or make the GitHub workflow non-blocking.
- The production build needs roughly 5–6 GB of Node heap for the client bundle (wallet SDKs). This package already removed the wallet SDKs from the **server** bundle (the worker step used to run out of memory).
- `LinkedWalletsPanel` verifies signatures with EOA-only `verifyMessage`; smart-contract wallets (Safe) can't be linked. Use a public client's `verifyMessage` (ERC-1271/6492) if you need them.
- YouTube "Add music to mix" captures tab audio (desktop Chrome/Edge). Uploading licensed instrumentals is the reliable path; make sure members only upload music they have rights to.
- `profiles.wallet_address` is readable by every signed-in user (a later migration re-opened profiles). Consider selecting from `public_profiles` only.
- Below the `xl` breakpoint the room's right rail can mount twice (desktop aside is CSS-hidden, mobile copy mounts when opened) — harmless now, but worth de-duplicating.
- `createServerFn().inputValidator()` is deprecated in your TanStack Start version (build warnings) — rename to `.validator()` when convenient.

---

## 7. Test checklist (two phones + one laptop, published URL)

1. **Sign-in:** VIP → Continue with Glyph (email) → Sign to enter → lobby. Sign out. VIP → Connect a wallet → MetaMask → Sign → holder rooms unlock if the wallet holds BAYC/MAYC. Email/password sign-up still works and shows the account menu.
2. **Open mic:** A joins the line (auto-connects) → gets the stage → My tracks → upload an instrumental → Sing → Go live. B (phone) hears music + voice together; banner shows "Singer Live" and "● REC" for A.
3. Track ends → turn passes to B automatically. A's take appears under Takes and plays back.
4. **Booking:** A books B for the next 5-minute slot. When it starts, B gets the stage (Reserved); C can't claim it; after the slot, open mic resumes.
5. **Admin:** mute C for 10 min (C can't join the line / can't unmute), unmute; kick; set "Max song length 120 s" and watch an over-long song end; delete a test room from /admin/karaoke.
