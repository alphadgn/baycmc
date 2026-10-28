-- Security hardening (2026-10-28).
--
-- 1. Profiles: members could read every row of public.profiles. The private
--    wallet columns were hidden only by column grants, so one regenerated
--    grant would have exposed every member's wallets. Now a member reads
--    only their own row (admins: all); other members' public fields
--    (username, avatar, bio, short wallet label) come from member_profiles(),
--    which returns those columns only, to signed-in members only.
-- 2. search_members() (username search / @mentions) was missing from the
--    live database; recreated.
-- 3. Chat pictures: the chat-attachments bucket was public, so pictures
--    posted in private chats (Holders Chat, Lifer Chat, chapter meetings)
--    could be opened by anyone with the link, no account needed, and the
--    file names were guessable. The bucket is now private; a picture can be
--    read only by someone who can read the message it was posted in (the
--    message tables' own row-level security decides), its uploader, or staff.
-- 4. Server-only tables get an explicit deny-all policy (they had row-level
--    security with no policy, which already denied access; now it's stated).
-- 5. The anonymous role loses table grants it never needed (row-level
--    security already gave it nothing) and execute on is_room_host().

-- ── 1. Profiles ────────────────────────────────────────────────────────────
create or replace function public.member_profiles()
returns table (
  id uuid,
  username text,
  avatar_url text,
  bio text,
  wallet_display text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.avatar_url, p.bio, p.wallet_display, p.created_at, p.updated_at
    from public.profiles p
   where auth.uid() is not null;
$$;
revoke all on function public.member_profiles() from public, anon;
grant execute on function public.member_profiles() to authenticated, service_role;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Profiles: own row or staff" on public.profiles;
create policy "Profiles: own row or staff" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_staff((select auth.uid())));

-- The public_profiles view keeps working for every member (public fields only).
create or replace view public.public_profiles with (security_invoker = true) as
  select id, username, avatar_url, bio, created_at, updated_at from public.member_profiles();
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

-- ── 2. Member search ───────────────────────────────────────────────────────
create extension if not exists pg_trgm;
create index if not exists profiles_username_trgm
  on public.profiles using gin (lower(username) gin_trgm_ops)
  where username is not null;

create or replace function public.search_members(_q text default '', _limit integer default 8)
returns table (id uuid, username text, avatar_url text, wallet_display text)
language sql stable security definer set search_path = public as $$
  with q as (
    select lower(trim(coalesce(_q, ''))) as t,
           least(greatest(coalesce(_limit, 8), 1), 500) as n
  )
  select p.id, p.username, p.avatar_url, p.wallet_display
    from public.profiles p, q
   where auth.uid() is not null
     and p.username is not null
     and trim(p.username) <> ''
     and (q.t = '' or lower(p.username) like '%' || replace(replace(replace(q.t, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by
     case when lower(p.username) = q.t then 0
          when lower(p.username) like replace(replace(replace(q.t, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 1
          else 2 end,
     lower(p.username)
   limit (select n from q);
$$;
revoke all on function public.search_members(text, integer) from public, anon;
grant execute on function public.search_members(text, integer) to authenticated, service_role;

-- ── 3. Chat pictures ───────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'chat-attachments';

drop policy if exists "Chat attachments: message readers" on storage.objects;
create policy "Chat attachments: message readers" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_staff((select auth.uid()))
      -- These subqueries run with the member's own row-level security, so a
      -- picture is readable exactly when its message is.
      or exists (select 1 from public.lobby_messages m
                  where m.image_url like '%/chat-attachments/' || name)
      or exists (select 1 from public.lifer_messages m
                  where m.image_url like '%/chat-attachments/' || name)
      or exists (select 1 from public.posts m
                  where m.image_url like '%/chat-attachments/' || name)
    )
  );

-- ── 4. Server-only tables: explicit deny ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['session_wallets', 'member_holdings', 'mudwater_state',
                           'karaoke_search_cache', 'karaoke_video_status'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Server only" on public.%I', t);
      execute format('create policy "Server only" on public.%I for all to anon, authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;

-- ── 5. Anonymous role ──────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
       and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = c.relname
                          and (p.roles::text like '%anon%' or p.roles::text like '%public%')
                          and coalesce(p.qual, '') <> 'false')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;
revoke execute on function public.is_room_host(uuid, uuid) from anon, public;

notify pgrst, 'reload schema';
