# Plan — 6 fixes & features

## 1. Admin "Reseed now" button + refresh
**File:** `src/routes/_authenticated/admin.karaoke.tsx`
- Rename current button to "Seed catalog" and add a second "Reseed now" button that calls the same `seedKaraokeCatalog` server fn.
- After completion, immediately re-fetch a new `getKaraokeCatalogStats` server fn (see #3) and show the updated counts inline.
- Show toast on success/failure.

## 2. Mobile hint overlay for Music Machine
**File:** `src/components/KaraokeMusicBoard.tsx`
- On screens `<768px`, on first open of music machine per session (sessionStorage flag `mm-hint-seen`), show a dismissable bottom-sheet overlay listing: Search, Play, Pause, Stop, Minimize, Close.
- Anchored above safe-area inset, never covers the controls themselves. Dismissed with "Got it" or auto-dismiss after 6s.

## 3. Admin seed report
**Files:**
- `src/lib/karaoke.functions.ts` — modify `seedKaraokeCatalog` to return `{ inserted, skipped, total, lastSeededAt }`. Track skipped duplicates by checking returned rows from upsert (compare pre-existing `normalized_title`s vs newly inserted). Persist `last_seeded_at` in `app_settings` with key `karaoke_catalog_seed`.
- Add new server fn `getKaraokeCatalogStats` returning `{ totalSongs, lastSeededAt, lastInserted, lastSkipped }` (reads from `karaoke_songs` count + `app_settings`).
- `src/routes/_authenticated/admin.karaoke.tsx` — render a stats card at the top: Total songs, Last seeded at, Last run inserted/skipped.

No DB migration required — uses existing `app_settings` table.

## 4. ApeRides AR ape filter
**Approach:** Face-tracked overlay using MediaPipe FaceLandmarker + a textured plane locked to head bounds, using the user's verified BAYC PFP image as the texture. Honest scope: this is a 2D PFP plane locked to face — not a true 3D rigged model, because no 3D ape mesh is available without FLTRapp access.

**New files:**
- `src/components/ApeArFilter.tsx` — wraps a `<video>` + `<canvas>`. Loads MediaPipe via dynamic import (client-only). Reads BAYC PFP URL from `user_verifications.bayc_token_ids[0]` → composes `https://img.seadn.io/...` URL. Draws PFP scaled to face bounding box each frame.
- Toggle button "🦍 Ape AR" added to ApeRides host/rider join UI (locate join flow in `src/routes/_authenticated/_verified/ape-rides.tsx` and/or `ape-rides.$rideId.tsx`).

**Deps:** `@mediapipe/tasks-vision` (small, WASM, runs in browser).

**Constraints I'll be upfront about in UI:** Heavy on low-end mobile; toggleable; falls back to plain camera if MediaPipe fails to load.

## 5. Restore hidden containers in karaoke room
**File:** `src/components/KaraokeStage.tsx`
- Audit each container that can slide off / minimize (waiting list, music machine pulsing button, performer panel). Ensure each has a visible restore affordance always within viewport (`bottom: env(safe-area-inset-bottom) + 1rem`, `right: env(safe-area-inset-right) + 1rem`).
- Add a "Show all panels" reset button in the top right of `KaraokeStage` that resets all positions/visibility state.

## 6. Karaoke mic → LiveKit during video playback
**File:** `src/components/KaraokeMusicBoard.tsx` + check `src/components/KaraokeStage.tsx`
- LiveKit room is already connected. Currently the YouTube iframe may auto-mute the local mic or not publish it. 
- Wire a "Mic" toggle button into the music machine transport controls (next to Pause/Stop). Toggles `localParticipant.setMicrophoneEnabled(true/false)` from LiveKit room context.
- Ensure when video starts playing, mic is NOT auto-muted (currently nothing mutes it, but I'll verify).
- The YouTube video audio is played locally per user via the iframe (already in sync via shared `karaoke_sessions.video_id`); singer's mic goes through LiveKit and is heard by all + included in any LiveKit recording.

## Technical notes
- All UI work uses existing semantic tokens (`text-gold`, `glass`, `bg-gradient-gold`).
- Mobile breakpoint via existing `useIsMobile()` hook.
- MediaPipe dynamic-imported behind a "Enable Ape AR" toggle so it never loads for users who don't opt in.
- No schema changes. New `app_settings` row created on first seed.
