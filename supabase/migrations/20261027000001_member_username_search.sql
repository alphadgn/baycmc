-- Member lookup by username, for @mentions in chats and the member search
-- bars. Returns only public profile fields (never wallet addresses beyond
-- the already-public wallet_display). Signed-in members only.
--
-- Ordering: exact match, then names starting with the text, then names
-- containing it. An empty search lists members alphabetically.

create index if not exists profiles_username_trgm
  on public.profiles using gin (lower(username) gin_trgm_ops)
  where username is not null;

create or replace function public.search_members(_q text default '', _limit integer default 8)
returns table (id uuid, username text, avatar_url text, wallet_display text)
language sql
stable
security definer
set search_path = public
as $$
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

notify pgrst, 'reload schema';
