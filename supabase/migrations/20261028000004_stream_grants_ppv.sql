-- Event Stream: single-use host grants + pay-per-view (owner decisions 2026-10-28).
--
-- Host grants
--  * Admins and the super admin issue a grant to a member for ONE stream.
--  * It is "in use" once the host starts streaming; it is used up when the
--    stream ends (End broadcast, or the host gone for more than 5 minutes —
--    a dropped connection may rejoin within 5 minutes on the same grant).
--  * Signing out or an inactivity timeout cancels the grant.
--  * Admins and the super admin can always stream without a grant.
--
-- Pay-per-view
--  * Admins schedule events (title, start, end, price in APE) and set the
--    payee wallet. BAYC/MAYC holders (and the verified role, admins) watch
--    free; members of the other whitelisted collections buy a ticket per
--    event, paid in APE on ApeChain and checked by the server.
--  * A ticket covers that event, rejoins included.
--  * Cancelling an event marks its tickets "refund due"; an admin sends the
--    refunds from their own wallet (one tap each, or all in a row) and the
--    server records each verified refund. No key is held by the server.

-- ── Host grants ────────────────────────────────────────────────────────────
create table if not exists public.stream_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid,
  status text not null default 'active'
    check (status in ('active', 'in_use', 'used', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  last_live_at timestamptz,
  ended_at timestamptz,
  end_reason text
);
create unique index if not exists stream_grants_one_open_per_user
  on public.stream_grants (user_id) where status in ('active', 'in_use');
alter table public.stream_grants enable row level security;
revoke all on public.stream_grants from anon, authenticated;
grant select on public.stream_grants to authenticated;
grant all on public.stream_grants to service_role;
drop policy if exists "Stream grants: own or admins" on public.stream_grants;
create policy "Stream grants: own or admins" on public.stream_grants for select to authenticated
  using (user_id = (select auth.uid())
         or public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));

-- May this member broadcast right now?
create or replace function public.stream_can_host(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and (
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or exists (
      select 1 from public.stream_grants g
       where g.user_id = _uid
         and (g.status = 'active'
              or (g.status = 'in_use' and g.last_live_at > now() - interval '5 minutes'))
    )
  );
$$;

-- Admin / super admin: issue a single-use grant (notifies the member).
create or replace function public.stream_grant_issue(_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not (public.has_role(me, 'admin'::app_role) or public.has_role(me, 'super_admin'::app_role)) then
    raise exception 'Only admins can grant streaming.';
  end if;
  if exists (select 1 from public.stream_grants where user_id = _uid and status in ('active', 'in_use')) then
    raise exception 'That member already has an unused streaming grant.';
  end if;
  insert into public.stream_grants (user_id, granted_by) values (_uid, me);
  insert into public.notifications (user_id, kind, title, body, url)
  values (_uid, 'event_stream.grant', 'You can host one Event Stream',
          'Open the Event Stream and tap Start streaming. The grant covers one stream.',
          '/event-stream?golive=1');
  insert into public.audit_logs (event_type, actor_id, target_id) values ('event_stream.grant', me, _uid);
end $$;

-- Admin / super admin: cancel a member's open grant.
create or replace function public.stream_grant_revoke(_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not (public.has_role(me, 'admin'::app_role) or public.has_role(me, 'super_admin'::app_role)) then
    raise exception 'Only admins can revoke streaming.';
  end if;
  update public.stream_grants set status = 'revoked', ended_at = now(), end_reason = 'revoked'
   where user_id = _uid and status in ('active', 'in_use');
  insert into public.audit_logs (event_type, actor_id, target_id) values ('event_stream.revoke', me, _uid);
end $$;

-- Server only: the host started / is still streaming.
create or replace function public.stream_grant_touch(_uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.stream_grants
     set status = 'in_use', started_at = coalesce(started_at, now()), last_live_at = now()
   where user_id = _uid
     and (status = 'active' or (status = 'in_use' and last_live_at > now() - interval '5 minutes'));
  return found;
end $$;

-- Server only: the stream ended (End broadcast), or the session ended.
create or replace function public.stream_grant_finish(_uid uuid, _reason text)
returns void language sql security definer set search_path = public as $$
  update public.stream_grants
     set status = case when _reason = 'ended' then 'used' else 'expired' end,
         ended_at = now(), end_reason = _reason
   where user_id = _uid
     and (case when _reason = 'ended' then status = 'in_use' else status in ('active', 'in_use') end);
$$;

-- Housekeeping (SQL only): hosts gone for more than 5 minutes → used.
create or replace function public.stream_grant_sweep()
returns void language sql security definer set search_path = public as $$
  update public.stream_grants
     set status = 'used', ended_at = now(), end_reason = 'left'
   where status = 'in_use' and last_live_at < now() - interval '5 minutes';
$$;

revoke all on function public.stream_can_host(uuid) from public, anon;
grant execute on function public.stream_can_host(uuid) to authenticated, service_role;
revoke all on function public.stream_grant_issue(uuid) from public, anon;
grant execute on function public.stream_grant_issue(uuid) to authenticated;
revoke all on function public.stream_grant_revoke(uuid) from public, anon;
grant execute on function public.stream_grant_revoke(uuid) to authenticated;
revoke all on function public.stream_grant_touch(uuid) from public, anon, authenticated;
grant execute on function public.stream_grant_touch(uuid) to service_role;
revoke all on function public.stream_grant_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.stream_grant_finish(uuid, text) to service_role;
revoke all on function public.stream_grant_sweep() from public, anon, authenticated;
grant execute on function public.stream_grant_sweep() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stream-grant-sweep') then
    perform cron.unschedule('stream-grant-sweep');
  end if;
  perform cron.schedule('stream-grant-sweep', '* * * * *', 'select public.stream_grant_sweep()');
end $$;

-- Existing (permanent) hosts become one single-use grant each.
insert into public.stream_grants (user_id, granted_by, created_at)
select h.user_id, h.assigned_by, coalesce(h.created_at, now())
  from public.event_stream_hosts h
 where not exists (select 1 from public.stream_grants g
                    where g.user_id = h.user_id and g.status in ('active', 'in_use'));

-- Menu/area access: open grants count instead of the old host list.
create or replace function public.can_access_area(_uid uuid, _item text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or (_item = 'event_stream' and public.stream_can_host(_uid))
    or exists (
      select 1 from public.user_verifications v
        join public.collection_menu_items m on m.collection_label = any (v.verified_collections)
       where v.user_id = _uid and m.item_key = _item and m.enabled)
    or (public.has_role(_uid, 'verified_user'::app_role) and exists (
      select 1 from public.collection_menu_items m
       where m.collection_label in ('BAYC', 'MAYC') and m.item_key = _item and m.enabled)),
    false);
$function$;

-- Every whitelisted collection sees the Event Stream (non-BAYC/MAYC pay per view).
update public.collection_menu_items set enabled = true where item_key = 'event_stream';

-- ── Pay-per-view ───────────────────────────────────────────────────────────
create table if not exists public.stream_settings (
  id smallint primary key default 1 check (id = 1),
  payee_wallet text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.stream_settings (id) values (1) on conflict do nothing;
alter table public.stream_settings enable row level security;
revoke all on public.stream_settings from anon, authenticated;
grant select on public.stream_settings to authenticated;
grant all on public.stream_settings to service_role;
drop policy if exists "Stream settings: members read" on public.stream_settings;
create policy "Stream settings: members read" on public.stream_settings for select to authenticated using (true);

create table if not exists public.stream_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_ape numeric(18, 6) not null default 0 check (price_ape >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at)
);
create index if not exists stream_events_time_idx on public.stream_events (starts_at);
alter table public.stream_events enable row level security;
revoke all on public.stream_events from anon, authenticated;
grant select on public.stream_events to authenticated;
grant all on public.stream_events to service_role;
drop policy if exists "Stream events: members read" on public.stream_events;
create policy "Stream events: members read" on public.stream_events for select to authenticated using (true);

create table if not exists public.stream_tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.stream_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chain_id integer not null,
  tx_hash text not null unique,
  from_address text not null,
  to_address text not null,
  amount_wei numeric(78, 0) not null,
  created_at timestamptz not null default now(),
  refund_status text not null default 'none' check (refund_status in ('none', 'due', 'refunded')),
  refund_tx_hash text unique,
  refunded_at timestamptz,
  refunded_by uuid,
  unique (event_id, user_id)
);
alter table public.stream_tickets enable row level security;
revoke all on public.stream_tickets from anon, authenticated;
grant select on public.stream_tickets to authenticated;
grant all on public.stream_tickets to service_role;
drop policy if exists "Stream tickets: own or admins" on public.stream_tickets;
create policy "Stream tickets: own or admins" on public.stream_tickets for select to authenticated
  using (user_id = (select auth.uid())
         or public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));

-- Free viewers: BAYC/MAYC holders (verified role counts), admins, hosts.
create or replace function public.stream_viewer_free(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and (
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or public.holds_any_collection(_uid, 'BAYC,MAYC')
    or public.stream_can_host(_uid)
  );
$$;
-- The event on now (doors open 30 minutes early, close 30 minutes late).
create or replace function public.stream_current_event()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.stream_events
   where status = 'scheduled'
     and starts_at - interval '30 minutes' <= now()
     and ends_at + interval '30 minutes' > now()
   order by starts_at limit 1;
$$;
create or replace function public.stream_has_ticket(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stream_tickets t
     where t.user_id = _uid and t.refund_status = 'none'
       and t.event_id = public.stream_current_event()
  );
$$;
revoke all on function public.stream_viewer_free(uuid) from public, anon;
grant execute on function public.stream_viewer_free(uuid) to authenticated, service_role;
revoke all on function public.stream_current_event() from public, anon;
grant execute on function public.stream_current_event() to authenticated, service_role;
revoke all on function public.stream_has_ticket(uuid) from public, anon;
grant execute on function public.stream_has_ticket(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
