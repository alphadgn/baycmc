# Karaoke overhaul roadmap

## Approved workflow revision (review only; no shared database changes or publishing)
- [x] Prepare session-bound single-use Event Stream grants and live media enforcement
- [x] Regular conference rooms without performer UI; preserve booked admission
- [x] Karaoke waitlist pulse and ordered authoritative handoff (SQL staged, not applied)
- [x] Isolated lifecycle/concurrency tests and room-entry regression checks
- [x] Document unapplied SQL, deployment prerequisites, and unverified live flows
- [ ] Live media verification — blocked by intentionally unapplied SQL, unconfigured scheduler/webhook and live staff/member test sessions; review details in docs/review/WORKFLOW_REVIEW.md

## Room chat and club administration
- [x] Add room-scoped live chat in conference and karaoke rooms
- [x] Add collection management connected to ownership and NFT display
- [x] Add club rules and social links editing with member-facing display
- [x] Verify signed-in room-message delivery and readback; 24 regression tests passed
- [ ] Verify settings save with a super-admin account — current signed-in account has no admin role

## Global pictures and chat opening
- [x] Apply NFT versus device photo shapes to every profile picture display
- [x] Open every chat thread at the newest messages, including delayed media
- [x] Verify picture rendering and chat opening regressions (49 tests pass; signed-in lobby opens at bottom; live circular and square pictures render)
- [x] Display whitelisted NFTs from every verified connected wallet on the profile (aggregation/filter regression passes; signed-in account returns a real empty collection; populated multi-wallet UI not verified)

## Screenshot fixes
- [x] Alchemy NFT lookup — ALCHEMY_API_KEY secret saved, wallet-assets functions wired to it, live lookup verified (key valid; Glyph wallet holds 0 NFTs, BAYC #2931 owner returns 1)
- [x] Synchronize profile badges and global verification displays (shared snapshot; regression test passes)
- [x] Shrink floating help button and move left above room controls (phone viewport and opening checked)

- [x] Sound fixes (single renderer, Enable room sound, real mic gain, AEC on, no speaker pickup, tab-hide keeps stage)
- [x] Shared stage state: versioned session (play/pause/seek/stop/song, revision) via server functions
- [x] Queue/handoff via transactional DB functions (join/leave, claim, end+promote, force-skip, lease recovery)
- [ ] Backing tracks: admin upload of authorized audio, catalog source type, app-audio playback mode — blocked: user has no licensed tracks yet
- [ ] Recording wired to mixed pipeline (blocked on backing-track path)
- [ ] Real-device / load tests (needs physical devices — user)
