# BAYCmc workflow revision — review only

No publishing or shared-database writes were performed.

## Prepared changes
- Event Stream enters viewer-only, including staff. Start atomically claims a broadcast bound to the authenticated session before enabling media permissions. Admin and Super Admin need no grant; members consume one grant. Idempotent retry requires the same broadcast/session; competing attempts cannot claim another broadcast.
- End consumes the broadcast; manual sign-out and inactivity close the session and expire unused grants. Revocation updates already-connected media permissions, with participant removal if that fails. A signed LiveKit webhook and authenticated scheduled callback reconcile expired connected publishers independently of browser cooperation.
- Temporary loss retains the same broadcast for five minutes; a new session cannot resume it. After expiry, members need a fresh grant. A viewer token never permits publishing or self-editing binding metadata.
- Regular conference rooms use peer tiles and ordinary audio/video/chat, without karaoke state or controls. Public booked conferences now honor existing host approval; unbooked conferences remain open according to their existing tier rules.
- Karaoke waitlist pulses only while eligible, respects reduced motion, and stops when queued/performing. Queue promotion remains inside authoritative functions; reservation and booked-stage entitlement are preserved, with eligible open-queue participants ordered by signup time and serialized handoff.
- Microphone/camera preferences and the one-track karaoke mix are unchanged.

## Unapplied SQL for review
1. `20261117_stream_session_lifecycle.sql`: additive broadcast/session records, restricted server-only lifecycle functions, grant consumption and expiration. Existing unbound `in_use` grants are intentionally expired at upgrade; they cannot be safely migrated to a signed-in session.
2. `20261117_karaoke_fifo.sql`: authoritative signup-order promotion and claim protection; no changes to audio, reservation timing or consent.

These are staged outside migration history so they cannot run automatically. Apply only through the approved migration tool after review. Do not deploy the dependent code first.

## Deployment prerequisites (not performed)
1. Apply both reviewed SQL drafts and regenerate database types. The server uses narrow temporary type adapters until the new schema is available.
2. Add `STREAM_LIFECYCLE_SECRET` in Project Settings → Secrets. Configure a trusted scheduler to POST `/api/public/stream-lifecycle` at least every 15 seconds with its bearer secret, retrying failed requests. Revocation through the app acts immediately; background reconciliation latency is bounded by this schedule and successful media-service requests.
3. Configure LiveKit signed webhooks to POST `/api/public/livekit-stream`; enable participant joined/left and track events. Confirm retries and lifecycle monitoring before enabling broadcast grants.
4. Deploy code and schema together. Recheck live staff/member media publishing, temporary network loss, sign-out, revocation and scheduler enforcement on real devices. Do not treat local mocked media tests as live media verification.

## Verification boundaries
- Actual staged lifecycle SQL executed only against temporary isolated PostgreSQL, including competing claims, exact five-minute expiry, staff bypass, consumption, revocation, session close and concurrent two-singer end-turn handoff.
- The existing `auth.sessions` fields `id`, `user_id`, `not_after` were confirmed with a read-only schema query; no managed schema was changed.
- Media API tests use isolated stubs to test fail-closed permission updates and removal; conference admission and device-preference regression tests cover open/booked/approved paths.
- Live staff/member streaming and two physical-device karaoke audio remain unverified: shared migration application, scheduler/webhook configuration and live test accounts were deliberately not used for this review-only request.
- Existing outstanding work elsewhere in roadmap.md (super-admin settings save, licensed backing tracks and physical-device/load tests) remains outside this revision.