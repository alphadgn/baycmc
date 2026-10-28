-- Karaoke: performance waiver + public performances (owner decisions 2026-10-28).
--
--  * Every performance is public (anyone on the internet, via a share link)
--    and may be used as promotional material by BAYCmc, LLC.
--  * Before performing, the member accepts a waiver. The app shows it every
--    time the Karaoke Machine is opened; the server refuses to queue or put
--    anyone on stage without an acceptance in the last 12 hours.
--  * Performers can delete their own performances at any time.

create table if not exists public.karaoke_waivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now()
);
create index if not exists karaoke_waivers_user_idx on public.karaoke_waivers (user_id, accepted_at desc);
alter table public.karaoke_waivers enable row level security;
revoke all on public.karaoke_waivers from anon, authenticated;
grant select on public.karaoke_waivers to authenticated;
grant all on public.karaoke_waivers to service_role;
drop policy if exists "Karaoke waivers: own rows or admins" on public.karaoke_waivers;
create policy "Karaoke waivers: own rows or admins" on public.karaoke_waivers for select to authenticated
  using (user_id = (select auth.uid())
         or public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));

create or replace function public.accept_karaoke_waiver(_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.karaoke_waivers (user_id, version) values (auth.uid(), left(_version, 40));
end $$;
revoke all on function public.accept_karaoke_waiver(text) from public, anon;
grant execute on function public.accept_karaoke_waiver(text) to authenticated;

create or replace function public.karaoke_waiver_ok(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.karaoke_waivers w
                  where w.user_id = _uid and w.accepted_at > now() - interval '12 hours');
$$;
revoke all on function public.karaoke_waiver_ok(uuid) from public, anon;
grant execute on function public.karaoke_waiver_ok(uuid) to authenticated, service_role;

create or replace function public.karaoke_join_queue(_room uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
DECLARE uid uuid := auth.uid(); st public.karaoke_room_settings;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') THEN
    RAISE EXCEPTION 'You are muted in this room';
  END IF;
  IF NOT public.karaoke_waiver_ok(uid) THEN
    RAISE EXCEPTION 'Accept the performance waiver in the Karaoke Machine to get in line.';
  END IF;
  st := public.karaoke_settings(_room);
  IF st.require_booking AND NOT public.karaoke_is_admin(uid) THEN
    RAISE EXCEPTION 'This room is booking-only. Reserve a slot to sing.';
  END IF;
  INSERT INTO public.karaoke_queue (room_id, user_id) VALUES (_room, uid) ON CONFLICT DO NOTHING;
  UPDATE public.karaoke_queue SET last_seen_at = now() WHERE room_id = _room AND user_id = uid;
END $function$;

create or replace function public.karaoke_claim_stage(_room uuid)
returns karaoke_sessions language plpgsql security definer set search_path to 'public' as $function$
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
  IF s.performer_user_id IS NULL THEN
    UPDATE public.karaoke_sessions SET performer_user_id = uid, performer_heartbeat_at = now(),
      playback_status = 'idle', position_ms = 0, position_at = now(), stage_source = 'open', reservation_id = NULL,
      generation = generation + 1, revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = uid;
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $function$;

-- Performances are public from now on.
alter table public.karaoke_recordings drop constraint if exists karaoke_recordings_visibility_chk;
alter table public.karaoke_recordings add constraint karaoke_recordings_visibility_chk
  check (visibility = any (array['room', 'private', 'public']));
alter table public.karaoke_recordings alter column visibility set default 'public';

notify pgrst, 'reload schema';

-- Files in the karaoke-recordings bucket with no performance row (e.g. the
-- 11 pre-waiver takes deleted 2026-10-28). The server removes them through
-- the Storage API; service role only.
create or replace function public.karaoke_orphan_recording_paths()
returns setof text language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
   where o.bucket_id = 'karaoke-recordings'
     and not exists (select 1 from public.karaoke_recordings r where r.storage_path = o.name);
$$;
revoke all on function public.karaoke_orphan_recording_paths() from public, anon, authenticated;
grant execute on function public.karaoke_orphan_recording_paths() to service_role;
