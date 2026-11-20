-- Isolated-database checks for migration 20261120000001 (karaoke waiver once per
-- account sign-in, end-of-turn reasons, waiver gates). Run ONLY against a throwaway
-- database after replaying supabase/migrations (locally: PGlite + Supabase role/auth
-- stubs, see tests/db/README in the PR). Never run on a shared database.
-- The whole file runs in one transaction, so now() is constant: times are explicit.
create or replace function pg_temp.expect_error(_sql text, _like text) returns void language plpgsql as $$
begin
  begin
    execute _sql;
  exception when others then
    if sqlerrm not ilike _like then raise exception 'unexpected error for [%]: %', _sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', _sql;
end $$;
create or replace function pg_temp.check(_ok boolean, _what text) returns void language plpgsql as $$
begin
  if _ok is distinct from true then raise exception 'FAILED: %', _what; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;
grant execute on function pg_temp.check(boolean, text) to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000b1','singer@x.test'),
 ('00000000-0000-0000-0000-0000000000b2','admin2@x.test'),
 ('00000000-0000-0000-0000-0000000000b3','host@x.test'),
 ('00000000-0000-0000-0000-0000000000b4','queued@x.test');
insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000b2','admin');
insert into public.rooms(id, name, livekit_room, tier, kind) values
 ('00000000-0000-0000-0000-0000000000f2', 'Waiver test', 'waiver-room', 'token_proof', 'karaoke');

-- Current version is the one the app ships.
select pg_temp.check(public.karaoke_waiver_current_version() = '2026-11-20-1', 'current version seeded');

-- ── Rule: no live session → never valid ──
insert into public.karaoke_waivers(user_id, version, accepted_at)
  values ('00000000-0000-0000-0000-0000000000b1', '2026-11-20-1', now() - interval '1 minute');
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'no session → invalid');

-- ── Sign in (S1), accept after it → valid ──
insert into auth.sessions(id, user_id, created_at) values
 ('00000000-0000-0000-0000-00000000bb01','00000000-0000-0000-0000-0000000000b1', now() - interval '10 minutes');
select pg_temp.check(public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'accepted during S1 → valid');

-- Leaving / re-entering a room changes nothing server-side; a second device (S2,
-- signed in after the acceptance) is covered too: once per ACCOUNT.
insert into auth.sessions(id, user_id, created_at) values
 ('00000000-0000-0000-0000-00000000bb02','00000000-0000-0000-0000-0000000000b1', now());
select pg_temp.check(public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'second device covered');

-- An expired session doesn't count as live.
update auth.sessions set not_after = now() - interval '1 second'
 where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'expired sessions → invalid');
update auth.sessions set not_after = null where user_id = '00000000-0000-0000-0000-0000000000b1';

-- ── Sign out (global: every session revoked + marker) → invalid, also after signing in again ──
delete from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1';
select public.record_account_sign_out('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'signed out → invalid');
update public.account_signouts set signed_out_at = now() - interval '30 seconds'
 where user_id = '00000000-0000-0000-0000-0000000000b1';
insert into auth.sessions(id, user_id, created_at) values
 ('00000000-0000-0000-0000-00000000bb03','00000000-0000-0000-0000-0000000000b1', now() - interval '20 seconds');
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'new sign-in needs a new acceptance');

-- Even without the marker, an acceptance older than every live session is stale.
delete from public.account_signouts where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'acceptance predates all live sessions → invalid');
insert into public.account_signouts(user_id, signed_out_at) values ('00000000-0000-0000-0000-0000000000b1', now() - interval '30 seconds');

-- Accept again (through the RPC, as the member) → valid.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.check(not (public.karaoke_waiver_status()->>'accepted')::boolean, 'status: not accepted');
select pg_temp.expect_error($q$select public.accept_karaoke_waiver('2026-10-28-draft-1')$q$, '%WAIVER_VERSION_OUTDATED%');
select public.accept_karaoke_waiver('2026-11-20-1');
select pg_temp.check((public.karaoke_waiver_status()->>'accepted')::boolean, 'status: accepted after re-accepting');
select pg_temp.check(public.karaoke_waiver_status()->>'version' = '2026-11-20-1', 'status reports version');
-- Members can't stamp sign-outs (or read them).
select pg_temp.expect_error($q$select public.record_account_sign_out(auth.uid())$q$, '%permission denied%');
select pg_temp.expect_error($q$select * from public.account_signouts$q$, '%permission denied%');
reset role;

-- A sign-out that only ended one session (local fallback) still resets the waiver.
update public.account_signouts set signed_out_at = now() + interval '1 second'
 where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'sign-out marker → invalid');
update public.account_signouts set signed_out_at = now() - interval '30 seconds'
 where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check(public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'valid again');

-- ── A new waiver version forces re-acceptance mid-session ──
insert into public.karaoke_waiver_versions(version, effective_at) values ('2099-test', now());
select pg_temp.check(public.karaoke_waiver_current_version() = '2099-test', 'new version current');
select pg_temp.check(not public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'new version → invalid');
set role authenticated;
select pg_temp.expect_error($q$select public.accept_karaoke_waiver('2026-11-20-1')$q$, '%WAIVER_VERSION_OUTDATED%');
select public.accept_karaoke_waiver('2099-test');
reset role;
select pg_temp.check(public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'accepting the new version → valid');
delete from public.karaoke_waiver_versions where version = '2099-test';
-- (back on 2026-11-20-1, which b1 accepted after the marker → still valid)
select pg_temp.check(public.karaoke_waiver_ok('00000000-0000-0000-0000-0000000000b1'), 'version rollback ok');

-- ── Gates: join the line / take the stage / save a take ──
insert into auth.sessions(id, user_id, created_at) values
 ('00000000-0000-0000-0000-00000000bb04','00000000-0000-0000-0000-0000000000b4', now() - interval '5 minutes'),
 ('00000000-0000-0000-0000-00000000bb05','00000000-0000-0000-0000-0000000000b2', now() - interval '5 minutes'),
 ('00000000-0000-0000-0000-00000000bb06','00000000-0000-0000-0000-0000000000b3', now() - interval '5 minutes');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',false);
select pg_temp.expect_error($q$select public.karaoke_join_queue('00000000-0000-0000-0000-0000000000f2')$q$, '%performance waiver%');
select pg_temp.expect_error($q$select public.karaoke_claim_stage('00000000-0000-0000-0000-0000000000f2')$q$, '%performance waiver%');
select pg_temp.expect_error($q$insert into public.karaoke_recordings(room_id,performer_id,song_title,public_url,storage_path)
  values ('00000000-0000-0000-0000-0000000000f2',auth.uid(),'s','u','00000000-0000-0000-0000-0000000000b4/00000000-0000-0000-0000-0000000000f2/a.webm')$q$, '%row-level security%');
select public.accept_karaoke_waiver('2026-11-20-1');
select public.karaoke_join_queue('00000000-0000-0000-0000-0000000000f2');
insert into public.karaoke_recordings(room_id,performer_id,song_title,public_url,storage_path)
  values ('00000000-0000-0000-0000-0000000000f2',auth.uid(),'s','u','00000000-0000-0000-0000-0000000000b4/00000000-0000-0000-0000-0000000000f2/a.webm');
select pg_temp.check((select visibility from public.karaoke_recordings
  where storage_path like '00000000-0000-0000-0000-0000000000b4/%') = 'private', 'saved takes default to private');
-- b1 (valid waiver) takes the stage.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
reset role;
-- b4 is waiting in line; b1 has no queue row: put b1 on stage directly via claim (b4 first in FIFO → b4 promoted).
delete from public.karaoke_queue where room_id = '00000000-0000-0000-0000-0000000000f2';
set role authenticated;
select public.karaoke_claim_stage('00000000-0000-0000-0000-0000000000f2');
reset role;
select pg_temp.check((select performer_user_id from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2')
  = '00000000-0000-0000-0000-0000000000b1', 'b1 on stage');

-- ── End reasons recorded for the singer's Save prompt ──
-- Admin skip → 'admin'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false);
select public.karaoke_end_turn('00000000-0000-0000-0000-0000000000f2', null);
reset role;
select pg_temp.check((select last_end->>'reason' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = 'admin', 'admin skip → admin');
select pg_temp.check((select last_end->>'performer' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = '00000000-0000-0000-0000-0000000000b1', 'last_end names the singer');

-- Self end → 'self'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select public.karaoke_claim_stage('00000000-0000-0000-0000-0000000000f2');
select public.karaoke_end_turn('00000000-0000-0000-0000-0000000000f2', null);
reset role;
select pg_temp.check((select last_end->>'reason' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = 'self', 'own end → self');

-- Booking host skip → 'host'
insert into public.room_bookings(room_id, user_id, title, starts_at, ends_at)
  values ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b3','party', now() - interval '1 minute', now() + interval '1 hour');
-- (the booking makes b3 the entitled singer; put b1 on the open stage directly)
update public.karaoke_sessions set performer_user_id = '00000000-0000-0000-0000-0000000000b1',
  stage_source = 'open', reservation_id = null, performer_heartbeat_at = now(), generation = generation + 1
 where room_id = '00000000-0000-0000-0000-0000000000f2';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',false);
select public.karaoke_end_turn('00000000-0000-0000-0000-0000000000f2', null);
reset role;
select pg_temp.check((select last_end->>'reason' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = 'host', 'host skip → host');
delete from public.room_bookings where room_id = '00000000-0000-0000-0000-0000000000f2';
update public.karaoke_sessions set performer_user_id = null, stage_source = 'open', reservation_id = null
 where room_id = '00000000-0000-0000-0000-0000000000f2';

-- Missed heartbeats → 'connection'; song-length cap → 'timeout'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select public.karaoke_claim_stage('00000000-0000-0000-0000-0000000000f2');
reset role;
update public.karaoke_sessions set performer_heartbeat_at = now() - interval '2 minutes'
 where room_id = '00000000-0000-0000-0000-0000000000f2';
select public.karaoke_promote_next('00000000-0000-0000-0000-0000000000f2');
select pg_temp.check((select last_end->>'reason' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = 'connection', 'stale heartbeat → connection');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select public.karaoke_claim_stage('00000000-0000-0000-0000-0000000000f2');
reset role;
update public.karaoke_sessions set playback_status = 'playing', position_ms = 0,
  position_at = now() - interval '2 hours', performer_heartbeat_at = now()
 where room_id = '00000000-0000-0000-0000-0000000000f2';
select public.karaoke_promote_next('00000000-0000-0000-0000-0000000000f2');
select pg_temp.check((select last_end->>'reason' from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') = 'timeout', 'song cap → timeout');

-- ── Promotion skips a queued member whose waiver is no longer valid ──
insert into public.karaoke_queue(room_id, user_id, joined_at, last_seen_at) values
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b4', now() - interval '2 minutes', now());
update public.account_signouts set signed_out_at = now() + interval '1 second'
 where user_id = '00000000-0000-0000-0000-0000000000b4';
insert into public.account_signouts(user_id, signed_out_at)
  values ('00000000-0000-0000-0000-0000000000b4', now() + interval '1 second') on conflict (user_id) do update set signed_out_at = excluded.signed_out_at;
update public.karaoke_sessions set performer_user_id = null where room_id = '00000000-0000-0000-0000-0000000000f2';
select public.karaoke_promote_next('00000000-0000-0000-0000-0000000000f2');
select pg_temp.check((select performer_user_id from public.karaoke_sessions where room_id='00000000-0000-0000-0000-0000000000f2') is null, 'signed-out member is not promoted');

select 'karaoke waiver/session checks passed' as result;
