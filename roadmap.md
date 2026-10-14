# Karaoke overhaul roadmap

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
