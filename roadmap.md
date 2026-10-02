# Karaoke overhaul roadmap

- [x] Sound fixes (single renderer, Enable room sound, real mic gain, AEC on, no speaker pickup, tab-hide keeps stage)
- [ ] Shared stage state: versioned session (play/pause/seek/stop/song, revision) via server functions
- [ ] Queue/handoff via transactional DB functions (join/leave, claim, end+promote, force-skip, lease recovery)
- [ ] Backing tracks: admin upload of authorized audio, catalog source type, app-audio playback mode
- [ ] Recording wired to mixed pipeline (blocked on backing-track path)
- [ ] Real-device / load tests (needs physical devices — user)
