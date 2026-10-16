-- Event Stream: one streaming-only room for up to 250 verified holders
-- (BAYC, MAYC, CryptoPunks, Ugly Duck Labs, Orca Business, Temp Agency).
-- Only accounts the super admin assigns may broadcast.
create table if not exists public.event_stream_hosts (
  user_id uuid primary key,
  assigned_by uuid,
  created_at timestamptz not null default now()
);
alter table public.event_stream_hosts enable row level security;
revoke all on public.event_stream_hosts from anon, authenticated;
grant select on public.event_stream_hosts to authenticated;
grant all on public.event_stream_hosts to service_role;
drop policy if exists "Members read stream hosts" on public.event_stream_hosts;
create policy "Members read stream hosts" on public.event_stream_hosts
  for select to authenticated using ((select auth.uid()) is not null);

alter table public.rooms drop constraint if exists rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check
  check (kind = any (array['conference','game','karaoke','stream']));

insert into public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, kind)
select 'Event Stream', 'Live event broadcast for verified holders — up to 250 viewers.', 250,
       'token_proof', 'event-stream', 'event-stream', 3, 'stream'
 where not exists (select 1 from public.rooms where livekit_room = 'event-stream');
