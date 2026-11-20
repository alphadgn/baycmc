-- Karaoke: performance waiver accepted once per ACCOUNT sign-in, singer-chosen
-- visibility for saved takes, and "how did my turn end" for the Save prompt.
-- (Owner decisions 2026-11-20. Supersedes the 12-hour / 7-day waiver windows.)
--
-- Waiver rule (karaoke_waiver_ok), enforced for joining the line, taking the
-- stage, being promoted from the line, and saving a take (insert policy from
-- migration 20261118000007 + saveKaraokeRecording):
--   valid  ⇔  an acceptance of the CURRENT waiver version exists that was made
--             • after the account's most recent recorded sign-out, and
--             • no earlier than the oldest of the account's live sessions,
--             and the account has at least one live session.
-- Accepting on one device therefore covers the account's other signed-in
-- devices. Any sign-out revokes every session (supabase.auth.signOut is
-- global) and also stamps account_signouts, so the next sign-in must accept
-- again. Publishing a new waiver version (a karaoke_waiver_versions row)
-- forces re-acceptance mid-session.
-- CREATE OR REPLACE / IF NOT EXISTS only; safe to re-run.

-- ─── 1. Waiver versions ──────────────────────────────────────────────────────
create table if not exists public.karaoke_waiver_versions (
  version text primary key check (length(version) between 1 and 40),
  effective_at timestamptz not null default now(),
  note text
);
alter table public.karaoke_waiver_versions enable row level security;
revoke all on public.karaoke_waiver_versions from anon, authenticated;
grant select on public.karaoke_waiver_versions to authenticated;
grant all on public.karaoke_waiver_versions to service_role;
drop policy if exists "Karaoke waiver versions readable" on public.karaoke_waiver_versions;
create policy "Karaoke waiver versions readable" on public.karaoke_waiver_versions
  for select to authenticated using (true);

-- Must match KARAOKE_WAIVER_VERSION in src/lib/karaoke/waiverStatus.ts.
insert into public.karaoke_waiver_versions (version, effective_at, note)
values ('2026-11-20-1', '2026-11-20 00:00:00+00',
        'Saved takes: singer chooses Private or Public; promotion only for Public takes')
on conflict (version) do nothing;

create or replace function public.karaoke_waiver_current_version()
returns text language sql stable security definer set search_path = public as $$
  select version from public.karaoke_waiver_versions
   where effective_at <= now()
   order by effective_at desc, version desc
   limit 1
$$;
revoke all on function public.karaoke_waiver_current_version() from public, anon;
grant execute on function public.karaoke_waiver_current_version() to authenticated, service_role;

-- ─── 2. Account sign-outs ────────────────────────────────────────────────────
create table if not exists public.account_signouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signed_out_at timestamptz not null default now()
);
alter table public.account_signouts enable row level security;
revoke all on public.account_signouts from anon, authenticated;
grant all on public.account_signouts to service_role;

-- Called by the server (endVerificationSession) on every sign-out, manual or
-- inactivity, before the session is revoked.
create or replace function public.record_account_sign_out(_uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.account_signouts (user_id, signed_out_at) values (_uid, now())
  on conflict (user_id) do update set signed_out_at = excluded.signed_out_at
$$;
revoke all on function public.record_account_sign_out(uuid) from public, anon, authenticated;
grant execute on function public.record_account_sign_out(uuid) to service_role;

-- ─── 3. The rule ─────────────────────────────────────────────────────────────
create or replace function public.karaoke_waiver_ok(_uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  cur text := public.karaoke_waiver_current_version();
  out_at timestamptz;
  oldest timestamptz;
  live_sessions integer := 0;
  sessions_readable boolean := true;
begin
  if _uid is null or cur is null then return false; end if;
  select a.signed_out_at into out_at from public.account_signouts a where a.user_id = _uid;
  begin
    select min(s.created_at), count(*) into oldest, live_sessions
      from auth.sessions s
     where s.user_id = _uid and (s.not_after is null or s.not_after > now());
  exception when undefined_table or undefined_column or insufficient_privilege then
    -- Session table unreadable: fall back to the sign-out marker alone.
    sessions_readable := false;
  end;
  if sessions_readable and live_sessions = 0 then return false; end if;
  return exists (
    select 1 from public.karaoke_waivers w
     where w.user_id = _uid
       and w.version = cur
       and (out_at is null or w.accepted_at > out_at)
       -- 5 s allows for clock skew between the auth server and the database.
       and (not sessions_readable or w.accepted_at >= oldest - interval '5 seconds')
  );
end $$;
revoke all on function public.karaoke_waiver_ok(uuid) from public, anon;
grant execute on function public.karaoke_waiver_ok(uuid) to authenticated, service_role;

-- What the app asks when a member enters karaoke (own account only).
create or replace function public.karaoke_waiver_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'accepted', coalesce(public.karaoke_waiver_ok(auth.uid()), false),
    'version', public.karaoke_waiver_current_version())
$$;
revoke all on function public.karaoke_waiver_status() from public, anon;
grant execute on function public.karaoke_waiver_status() to authenticated;

-- Only the current wording can be accepted (a stale page must reload first).
create or replace function public.accept_karaoke_waiver(_version text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text := public.karaoke_waiver_current_version();
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if cur is not null and _version is distinct from cur then
    raise exception 'WAIVER_VERSION_OUTDATED: the waiver has been updated; reload to read it';
  end if;
  insert into public.karaoke_waivers (user_id, version) values (auth.uid(), left(coalesce(_version, cur), 40));
end $$;
revoke all on function public.accept_karaoke_waiver(text) from public, anon;
grant execute on function public.accept_karaoke_waiver(text) to authenticated;

-- ─── 4. How a turn ended (read by the singer's device for the Save prompt) ──
alter table public.karaoke_sessions add column if not exists last_end jsonb;

-- From 20261118000005 (FIFO), plus: record how the previous turn ended, and
-- skip queued members whose waiver is no longer valid (e.g. signed out).
CREATE OR REPLACE FUNCTION public.karaoke_promote_next(_room uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ent record; nxt uuid; src text := 'open'; res uuid := NULL; st public.karaoke_room_settings;
  s public.karaoke_sessions; caller uuid := auth.uid(); why text; pos integer;
BEGIN
  -- Reentrant row lock: end-turn/heartbeat already own it; direct calls are serialized too.
  s := public.karaoke_lock_session(_room);
  st := public.karaoke_settings(_room);
  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);
  IF ent.performer IS NOT NULL THEN
    nxt := ent.performer; src := ent.source; res := ent.reservation;
  ELSE
    SELECT q.user_id INTO nxt FROM public.karaoke_queue q
     WHERE q.room_id = _room AND q.last_seen_at > now() - interval '45 seconds'
       AND NOT public.karaoke_is_sanctioned(_room, q.user_id, 'mute')
       AND (NOT st.require_booking OR public.karaoke_is_admin(q.user_id))
       AND public.karaoke_waiver_ok(q.user_id)
     ORDER BY q.joined_at, q.id
     LIMIT 1;
  END IF;

  IF s.performer_user_id IS NOT NULL THEN
    why := nullif(current_setting('karaoke.end_reason', true), '');
    IF why IS NULL THEN
      pos := CASE WHEN s.playback_status = 'playing'
        THEN s.position_ms + (extract(epoch FROM now() - s.position_at) * 1000)::int
        ELSE s.position_ms END;
      IF s.stage_source <> 'open' AND (ent.performer IS DISTINCT FROM s.performer_user_id
                                       OR ent.reservation IS DISTINCT FROM s.reservation_id) THEN
        why := 'timeout';                       -- reserved slot / booking ended
      ELSIF s.performer_heartbeat_at IS NULL OR s.performer_heartbeat_at < now() - interval '45 seconds' THEN
        why := 'connection';                    -- singer's device stopped checking in
      ELSIF st.max_song_seconds > 0 AND s.playback_status = 'playing'
            AND pos > st.max_song_seconds * 1000 + 5000 THEN
        why := 'timeout';                       -- room's song-length cap
      ELSIF caller IS NOT NULL AND caller = s.performer_user_id THEN
        why := 'self';
      ELSIF caller IS NOT NULL AND public.karaoke_is_admin(caller) THEN
        why := 'admin';                         -- admin / super admin (skip, sanction)
      ELSIF caller IS NOT NULL AND public.karaoke_is_moderator(_room, caller) THEN
        why := 'host';                          -- the room's booking host
      ELSE
        why := 'ended';
      END IF;
    END IF;
  END IF;

  UPDATE public.karaoke_sessions SET
    performer_user_id = nxt, video_id = NULL, search_query = NULL, backing_track_id = NULL,
    song_title = NULL, song_artist = NULL,
    playback_status = 'idle', position_ms = 0, position_at = now(),
    stage_source = src, reservation_id = res,
    generation = generation + 1, revision = revision + 1,
    performer_heartbeat_at = CASE WHEN nxt IS NULL THEN NULL ELSE now() END,
    last_end = CASE WHEN s.performer_user_id IS NULL THEN last_end ELSE jsonb_build_object(
      'performer', s.performer_user_id, 'generation', s.generation,
      'reason', why, 'at', now()) END,
    updated_at = now()
  WHERE room_id = _room;
  -- The promoted singer leaves the waiting line.
  IF nxt IS NOT NULL THEN
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = nxt;
  END IF;
  RETURN nxt;
END $$;
REVOKE ALL ON FUNCTION public.karaoke_promote_next(uuid) FROM PUBLIC, anon, authenticated;

-- From 20261013000001, plus an explicit end reason (self / admin / host).
CREATE OR REPLACE FUNCTION public.karaoke_end_turn(_room uuid, _expected_generation integer DEFAULT NULL)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; uid uuid := auth.uid(); is_mod boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF _expected_generation IS NOT NULL AND _expected_generation <> s.generation THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;
  is_mod := public.karaoke_is_moderator(_room, uid);
  IF s.performer_user_id IS DISTINCT FROM uid AND NOT is_mod THEN
    RAISE EXCEPTION 'Not allowed to end this turn';
  END IF;
  IF s.stage_source <> 'open' AND s.performer_user_id = uid THEN
    -- Reserved/booked singer keeps the stage for the rest of the slot; just stop the song.
    UPDATE public.karaoke_sessions SET video_id = NULL, search_query = NULL, backing_track_id = NULL,
      song_title = NULL, song_artist = NULL, playback_status = 'idle',
      position_ms = 0, position_at = now(), revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
  ELSE
    IF s.reservation_id IS NOT NULL THEN
      -- Moderator skip of a reserved slot ends that slot.
      UPDATE public.karaoke_reservations SET status = 'completed' WHERE id = s.reservation_id AND status = 'booked';
    END IF;
    IF s.performer_user_id IS NOT NULL THEN
      DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = s.performer_user_id;
    END IF;
    PERFORM set_config('karaoke.end_reason',
      CASE WHEN s.performer_user_id = uid THEN 'self'
           WHEN public.karaoke_is_admin(uid) THEN 'admin'
           ELSE 'host' END, true);
    PERFORM public.karaoke_promote_next(_room);
    PERFORM set_config('karaoke.end_reason', '', true);
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- From 20261118000005 (FIFO), restoring the waiver check that version dropped.
CREATE OR REPLACE FUNCTION public.karaoke_claim_stage(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; uid uuid := auth.uid(); ent record; st public.karaoke_room_settings;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') THEN RAISE EXCEPTION 'You are muted in this room'; END IF;
  IF NOT public.karaoke_waiver_ok(uid) THEN
    RAISE EXCEPTION 'Accept the performance waiver in the Karaoke Machine to take the stage.';
  END IF;
  s := public.karaoke_lock_session(_room);
  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);
  IF ent.performer IS NOT NULL AND ent.performer <> uid THEN RAISE EXCEPTION 'The stage is reserved right now'; END IF;
  st := public.karaoke_settings(_room);
  IF ent.performer IS NULL AND st.require_booking AND NOT public.karaoke_is_admin(uid) THEN
    RAISE EXCEPTION 'This room is booking-only. Reserve a slot to sing.';
  END IF;
  IF s.performer_user_id IS NOT NULL AND s.performer_user_id <> uid THEN
    RAISE EXCEPTION 'Someone else is on stage';
  END IF;
  IF s.performer_user_id IS NULL AND ent.performer IS NULL AND EXISTS (
    SELECT 1 FROM public.karaoke_queue q WHERE q.room_id=_room
      AND q.last_seen_at > now()-interval '45 seconds'
      AND NOT public.karaoke_is_sanctioned(_room,q.user_id,'mute')
      AND public.karaoke_waiver_ok(q.user_id)) THEN
    PERFORM public.karaoke_promote_next(_room);
    SELECT * INTO s FROM public.karaoke_sessions WHERE room_id=_room;
    IF s.performer_user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Wait for your turn in the signup line'; END IF;
  END IF;
  IF s.performer_user_id IS NULL THEN
    UPDATE public.karaoke_sessions SET performer_user_id = uid, performer_heartbeat_at = now(),
      playback_status = 'idle', position_ms = 0, position_at = now(), stage_source = 'open', reservation_id = NULL,
      generation = generation + 1, revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = uid;
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- ─── 5. Saved takes: the singer chooses; private unless they pick Public ────
alter table public.karaoke_recordings alter column visibility set default 'private';
