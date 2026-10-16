-- Per-collection menu: each allowlisted collection unlocks its own set of
-- gated areas. The super admin edits this matrix (check sheet). It is the
-- single source of truth for BOTH the menu and access to those areas.
create table if not exists public.collection_menu_items (
  collection_label text not null,
  item_key text not null check (item_key in
    ('holders_chat','conference_rooms','punks_brunch','ape_rides','event_stream')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (collection_label, item_key)
);
alter table public.collection_menu_items enable row level security;
revoke all on public.collection_menu_items from anon, authenticated;
grant select on public.collection_menu_items to authenticated;
grant all on public.collection_menu_items to service_role;
drop policy if exists "Members read menu matrix" on public.collection_menu_items;
create policy "Members read menu matrix" on public.collection_menu_items
  for select to authenticated using ((select auth.uid()) is not null);
-- Writes go through the super-admin server function (service role) only.

-- Defaults = today's behaviour.
insert into public.collection_menu_items (collection_label, item_key, enabled)
select c, i, case
    when c in ('BAYC','MAYC') then i in ('holders_chat','conference_rooms','ape_rides','event_stream')
    when c = 'PUNKS' then true
    else i in ('ape_rides','event_stream') end
  from unnest(array['BAYC','MAYC','PUNKS','TEMP_AGENCY','UGLY_DUCK_LABS','ORCA_BUSINESS']) c,
       unnest(array['holders_chat','conference_rooms','punks_brunch','ape_rides','event_stream']) i
on conflict do nothing;

-- Staff (and manually verified users) see every area; holders see the areas
-- their verified collections unlock.
create or replace function public.can_access_area(_uid uuid, _item text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or public.has_role(_uid, 'verified_user'::app_role)
    or exists (
      select 1
        from public.user_verifications v
        join public.collection_menu_items m
          on m.collection_label = any (v.verified_collections)
       where v.user_id = _uid and m.item_key = _item and m.enabled),
    false);
$$;
revoke all on function public.can_access_area(uuid, text) from public, anon;
grant execute on function public.can_access_area(uuid, text) to authenticated;

create or replace function public.my_menu_items()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(i), '{}')
    from unnest(array['holders_chat','conference_rooms','punks_brunch','ape_rides','event_stream']) i
   where public.can_access_area(auth.uid(), i);
$$;
revoke all on function public.my_menu_items() from public, anon;
grant execute on function public.my_menu_items() to authenticated;

-- Enforcement follows the matrix.
create or replace function public.can_use_ape_rides(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_area(_uid, 'ape_rides');
$$;

create or replace function public.can_access_chat_channel(_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select case _channel
    when 'lobby' then auth.uid() is not null
    when 'punks-brunch' then public.can_access_area(auth.uid(), 'punks_brunch')
    else false end;
$$;

-- Holders Chat (posts, comments, likes, holder messages).
do $$
declare r record;
begin
  for r in
    select tablename, policyname, cmd, with_check from pg_policies
     where schemaname = 'public'
       and tablename in ('posts','post_comments','post_likes','messages')
       and (qual ilike '%is_verified_holder%' or with_check ilike '%is_verified_holder%')
  loop
    if r.cmd = 'SELECT' then
      execute format('alter policy %I on public.%I using (public.can_access_area(auth.uid(), ''holders_chat''))',
                     r.policyname, r.tablename);
    elsif r.cmd = 'INSERT' and r.with_check is not null then
      execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename,
        replace(r.with_check, 'is_verified_holder(auth.uid())',
                'can_access_area(auth.uid(), ''holders_chat''::text)'));
    end if;
  end loop;
end $$;
