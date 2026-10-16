-- Lovable security scan (Oct 16): findings validated and sealed.
--
-- 1) EXPOSED PERSONAL DATA — VALID. Every signed-in member could read every
--    member's full wallet address (profiles.wallet_address and the legacy
--    profiles.linked_wallets array). Combined with usernames that links a
--    person to their whole on-chain holdings: a doxxing / targeting risk.
--    Members now see only a shortened display form; full addresses are
--    readable only by their owner (get_my_wallet) and by staff via
--    service-role server functions.
alter table public.profiles
  add column if not exists wallet_display text
  generated always as (
    case
      when wallet_address is null then null
      when length(wallet_address) <= 12 then wallet_address
      else left(wallet_address, 6) || '…' || right(wallet_address, 4)
    end
  ) stored;

revoke select on public.profiles from anon, authenticated;
grant select (id, username, bio, avatar_url, created_at, updated_at, wallet_display)
  on public.profiles to authenticated;

create or replace function public.get_my_wallet()
returns text language sql stable security definer set search_path = public as $$
  select wallet_address from public.profiles where id = auth.uid();
$$;
revoke all on function public.get_my_wallet() from public, anon;
grant execute on function public.get_my_wallet() to authenticated;

-- public_profiles is a read-only projection; nobody writes through it.
revoke all on public.public_profiles from anon;
revoke insert, update, delete, truncate, references, trigger on public.public_profiles from authenticated;

-- 2) "ACCESS RULES LET EVERYONE THROUGH" (12 tables, all SELECT-only):
--    reviewed one by one. They are intentionally shared with signed-in
--    members (room state, song catalogue, room list, non-secret settings);
--    none allow writes and none contain secrets. They now state that intent
--    explicitly — readable by an authenticated member only — instead of
--    USING (true). karaoke_recordings is tightened (below).
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'
       and tablename in ('app_settings','karaoke_presence','karaoke_queue','karaoke_reservations',
                         'karaoke_room_settings','karaoke_search_cache','karaoke_sessions',
                         'karaoke_songs','otherpage_settings','profiles','rooms')
  loop
    execute format('alter policy %I on public.%I using ((select auth.uid()) is not null)',
                   r.policyname, r.tablename);
  end loop;
end $$;

-- Recordings: owner, staff, or recordings shared with the room/public only.
drop policy if exists "Authenticated users can view recordings" on public.karaoke_recordings;
create policy "Members view shared recordings" on public.karaoke_recordings
  for select to authenticated using (
    performer_id = (select auth.uid())
    or visibility in ('room', 'public')
    or public.has_role((select auth.uid()), 'admin'::app_role)
    or public.has_role((select auth.uid()), 'super_admin'::app_role)
  );

-- 3) STORAGE RULES NOT TIED TO OWNER — VALID (4 policies).
--  a/b) avatars + chat-attachments are public buckets: their files are served
--       by public URL without any SELECT policy. The broad SELECT policies
--       only added the ability to LIST every member's files. Removed.
drop policy if exists "Public read on avatars" on storage.objects;
drop policy if exists "Public read on chat attachments" on storage.objects;

--  c) karaoke-recordings: any member could download ANY recording file,
--     including ones not shared. Now tied to the owner folder, staff, or a
--     recording row that is shared.
drop policy if exists "Karaoke recordings readable by members" on storage.objects;
create policy "Karaoke recordings: owner, staff or shared" on storage.objects
  for select to authenticated using (
    bucket_id = 'karaoke-recordings' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
      or exists (
        select 1 from public.karaoke_recordings r
         where r.storage_path = storage.objects.name
           and r.visibility in ('room', 'public')
      )
    )
  );

--  d) karaoke-recordings UPDATE had no WITH CHECK: an owner could move
--     (rename) their file into someone else's folder. Pin the new path too.
drop policy if exists "Users can update their own karaoke recordings" on storage.objects;
create policy "Users can update their own karaoke recordings" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'karaoke-recordings' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
    )
  )
  with check (
    bucket_id = 'karaoke-recordings' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
    )
  );

-- Avatar re-upload uses upsert, which needs SELECT on the object: allow it
-- for the owner's own folder only (public URLs keep serving everyone).
drop policy if exists "Users read their own avatar objects" on storage.objects;
create policy "Users read their own avatar objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
