# Karaoke overhaul roadmap

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
