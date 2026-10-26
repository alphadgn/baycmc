-- Mudwater (Phase 1: free play + spectating).
--
-- PLAY  — MWroom1/2: any signed-in member (email-only included).
--         MWroom3/4/5: only members whose current-session verification
--         holds BAYC / PUNKS / MAYC respectively. No admin or verified-role
--         shortcut for playing seats.
-- WATCH — any member with a wallet proven by signature in the current
--         session, plus admins and verified-role members; all five rooms.
--
-- Game state is server-authoritative: every write goes through the server
-- (service role). Members can read only what their access allows, and the
-- full game state (hands, antes, rock identities) is never readable by
-- browsers.

-- ── Rooms ──────────────────────────────────────────────────────────────────
alter table public.rooms drop constraint if exists rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check
  check (kind = any (array['conference', 'game', 'karaoke', 'stream', 'mudwater']));
alter table public.rooms add column if not exists slug text;
create unique index if not exists rooms_slug_key on public.rooms (slug) where slug is not null;

insert into public.rooms
  (name, slug, description, capacity, tier, livekit_room, theme, display_order, kind, required_collection)
select v.name, v.slug, v.descr, 2, v.tier::public.room_tier, v.lk, 'game-room', v.ord, 'mudwater', v.req
  from (values
    ('MWroom1', 'mwroom1', 'Mudwater — open to every member.', 'public', 'mudwater-1', 301, null::text),
    ('MWroom2', 'mwroom2', 'Mudwater — open to every member.', 'public', 'mudwater-2', 302, null),
    ('MWroom3', 'mwroom3', 'Mudwater — verified BAYC holders play here.', 'token_proof', 'mudwater-3', 303, 'BAYC'),
    ('MWroom4', 'mwroom4', 'Mudwater — verified CryptoPunks holders play here.', 'token_proof', 'mudwater-4', 304, 'PUNKS'),
    ('MWroom5', 'mwroom5', 'Mudwater — verified MAYC holders play here.', 'token_proof', 'mudwater-5', 305, 'MAYC')
  ) as v(name, slug, descr, tier, lk, ord, req)
 where not exists (select 1 from public.rooms r where r.slug = v.slug);

-- ── Session wallets ────────────────────────────────────────────────────────
-- Wallets proven by signature in the member's CURRENT sign-in session.
-- Written by the server at wallet sign-in / in-session wallet linking;
-- wiped at sign-in and sign-out. Server-only.
create table if not exists public.session_wallets (
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  proven_at timestamptz not null default now(),
  primary key (user_id, address)
);
alter table public.session_wallets enable row level security;
revoke all on public.session_wallets from anon, authenticated;
grant all on public.session_wallets to service_role;

-- ── Eligibility ────────────────────────────────────────────────────────────
-- PLAY: exact collection from this session's verification; no role bypass.
create or replace function public.mudwater_can_play(_room uuid, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when r.kind <> 'mudwater' or not r.active or _uid is null then false
      when r.required_collection is null then true
      else exists (
        select 1 from public.user_verifications v
         where v.user_id = _uid and r.required_collection = any (v.verified_collections)
      )
    end
    from public.rooms r where r.id = _room
  ), false);
$$;

-- WATCH (and, later, bet): a wallet proven this session, or an admin /
-- verified-role member.
create or replace function public.mudwater_can_watch(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _uid is not null and (
    exists (select 1 from public.session_wallets w where w.user_id = _uid)
    or public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or public.has_role(_uid, 'verified_user'::app_role)
  );
$$;

revoke all on function public.mudwater_can_play(uuid, uuid) from public, anon;
revoke all on function public.mudwater_can_watch(uuid) from public, anon;
grant execute on function public.mudwater_can_play(uuid, uuid) to authenticated, service_role;
grant execute on function public.mudwater_can_watch(uuid) to authenticated, service_role;

-- ── Rooms read policy ──────────────────────────────────────────────────────
-- Mudwater rooms follow ONLY mudwater_can_play; they're excluded from every
-- other clause (admin, public tier, collection rooms, conference access) so
-- none of those can surface a gated play room.
alter policy "Authenticated users can read rooms (locked preview)" on public.rooms
  using (
    case when kind = 'mudwater'
      then public.mudwater_can_play(id, (select auth.uid()))
    else (
      kind = 'karaoke'
      or tier = 'public'
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
      or (kind = 'stream' and public.can_access_area((select auth.uid()), 'event_stream'))
      or (required_collection = 'PUNKS' and public.can_access_area((select auth.uid()), 'punks_brunch'))
      or (required_collection is not null and required_collection <> 'PUNKS'
          and public.can_access_area((select auth.uid()), 'conference_rooms')
          and public.holds_any_collection((select auth.uid()), required_collection))
      or (tier = 'lifer' and public.is_lifer((select auth.uid())))
      or (kind <> 'stream' and required_collection is null
          and public.can_access_area((select auth.uid()), 'conference_rooms'))
    ) end
  );

-- ── Matches ────────────────────────────────────────────────────────────────
create table if not exists public.mudwater_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
  -- Public snapshot of the room so spectators can label matches without
  -- reading protected room rows.
  room_name text not null,
  room_slug text not null,
  required_collection text,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'finished', 'aborted')),
  mode text not null check (mode in ('agent', 'pvp')),
  advanced boolean not null default false,
  catalog_version text not null,
  rules_version text not null,
  agent_policy text,
  turn_seconds integer not null default 120,
  starting_seat smallint,
  version integer not null default 0,
  public_state jsonb,
  turn_deadline timestamptz,
  winner_seat smallint,
  end_reason text,
  scores integer[],
  rematch_of uuid references public.mudwater_matches(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
-- One unfinished match per room.
create unique index if not exists mudwater_matches_one_open_per_room
  on public.mudwater_matches (room_id) where status in ('waiting', 'playing');
create index if not exists mudwater_matches_status_idx on public.mudwater_matches (status, updated_at desc);

create table if not exists public.mudwater_seats (
  match_id uuid not null references public.mudwater_matches(id) on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  user_id uuid references auth.users(id) on delete set null,
  is_agent boolean not null default false,
  display_name text not null,
  avatar_url text,
  ready boolean not null default false,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (match_id, seat),
  check (is_agent or user_id is not null)
);
-- A member holds at most one active playing seat across all Mudwater rooms.
create unique index if not exists mudwater_seats_one_active_per_user
  on public.mudwater_seats (user_id) where active and user_id is not null;

-- Each seat's own deck and hand. Readable only by that seat's member.
create table if not exists public.mudwater_seat_private (
  match_id uuid not null references public.mudwater_matches(id) on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  user_id uuid references auth.users(id) on delete cascade,
  deck integer[] not null default '{}',
  hand integer[] not null default '{}',
  rocks jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (match_id, seat)
);

-- Full authoritative game state. Server-only — never readable by browsers.
create table if not exists public.mudwater_state (
  match_id uuid primary key references public.mudwater_matches(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Public, append-only move log (no hidden information: rocks and passes
-- carry no card).
create table if not exists public.mudwater_actions (
  match_id uuid not null references public.mudwater_matches(id) on delete cascade,
  move_number integer not null,
  seat smallint not null,
  actor text not null check (actor in ('human', 'agent')),
  kind text not null check (kind in ('place', 'rock', 'upgrade', 'pass')),
  square smallint,
  card integer,
  captured smallint[] not null default '{}',
  ended boolean not null default false,
  action_id text not null,
  created_at timestamptz not null default now(),
  primary key (match_id, move_number),
  unique (match_id, action_id)
);

-- ── Read access ────────────────────────────────────────────────────────────
create or replace function public.mudwater_can_view_match(_match uuid, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _uid is not null and (
    exists (select 1 from public.mudwater_seats s where s.match_id = _match and s.user_id = _uid)
    or public.mudwater_can_watch(_uid)
    or exists (
      select 1 from public.mudwater_matches m
       where m.id = _match and public.mudwater_can_play(m.room_id, _uid)
    )
  );
$$;
revoke all on function public.mudwater_can_view_match(uuid, uuid) from public, anon;
grant execute on function public.mudwater_can_view_match(uuid, uuid) to authenticated, service_role;

alter table public.mudwater_matches enable row level security;
alter table public.mudwater_seats enable row level security;
alter table public.mudwater_seat_private enable row level security;
alter table public.mudwater_state enable row level security;
alter table public.mudwater_actions enable row level security;

revoke all on public.mudwater_matches, public.mudwater_seats, public.mudwater_seat_private,
  public.mudwater_state, public.mudwater_actions from anon, authenticated;
grant select on public.mudwater_matches, public.mudwater_seats, public.mudwater_seat_private,
  public.mudwater_actions to authenticated;
grant all on public.mudwater_matches, public.mudwater_seats, public.mudwater_seat_private,
  public.mudwater_state, public.mudwater_actions to service_role;

drop policy if exists "Mudwater matches: viewers" on public.mudwater_matches;
create policy "Mudwater matches: viewers" on public.mudwater_matches for select to authenticated
  using (public.mudwater_can_view_match(id, (select auth.uid())));
drop policy if exists "Mudwater seats: viewers" on public.mudwater_seats;
create policy "Mudwater seats: viewers" on public.mudwater_seats for select to authenticated
  using (public.mudwater_can_view_match(match_id, (select auth.uid())));
drop policy if exists "Mudwater actions: viewers" on public.mudwater_actions;
create policy "Mudwater actions: viewers" on public.mudwater_actions for select to authenticated
  using (public.mudwater_can_view_match(match_id, (select auth.uid())));
drop policy if exists "Mudwater private: own seat only" on public.mudwater_seat_private;
create policy "Mudwater private: own seat only" on public.mudwater_seat_private for select to authenticated
  using (user_id = (select auth.uid()));
-- mudwater_state: no policies at all → unreadable by browsers.

-- ── Atomic state transitions ───────────────────────────────────────────────
-- The server computes the next state with the engine, then commits it here
-- in one transaction, only if nobody else moved first (compare-and-swap on
-- version). Duplicate action ids are rejected by the unique constraint.
create or replace function public.mudwater_commit(
  _match uuid,
  _expected_version integer,
  _patch jsonb,
  _state jsonb,
  _action jsonb,
  _private jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb;
begin
  update public.mudwater_matches set
    version = version + 1,
    status = coalesce(_patch->>'status', status),
    public_state = case when _patch ? 'public_state' then _patch->'public_state' else public_state end,
    turn_deadline = case when _patch ? 'turn_deadline' then (_patch->>'turn_deadline')::timestamptz else turn_deadline end,
    starting_seat = coalesce((_patch->>'starting_seat')::smallint, starting_seat),
    winner_seat = case when _patch ? 'winner_seat' then (_patch->>'winner_seat')::smallint else winner_seat end,
    end_reason = coalesce(_patch->>'end_reason', end_reason),
    scores = case when _patch ? 'scores'
      then array(select jsonb_array_elements_text(_patch->'scores')::int) else scores end,
    started_at = case when (_patch->>'status') = 'playing' and started_at is null then now() else started_at end,
    finished_at = case when (_patch->>'status') in ('finished', 'aborted') then now() else finished_at end,
    updated_at = now()
  where id = _match and version = _expected_version;
  if not found then
    return false;
  end if;

  if _state is not null then
    insert into public.mudwater_state (match_id, state, updated_at)
    values (_match, _state, now())
    on conflict (match_id) do update set state = excluded.state, updated_at = now();
  end if;

  if _action is not null then
    insert into public.mudwater_actions
      (match_id, move_number, seat, actor, kind, square, card, captured, ended, action_id)
    values (
      _match,
      (_action->>'move_number')::int,
      (_action->>'seat')::smallint,
      _action->>'actor',
      _action->>'kind',
      (_action->>'square')::smallint,
      (_action->>'card')::int,
      coalesce(array(select jsonb_array_elements_text(_action->'captured')::smallint), '{}'),
      coalesce((_action->>'ended')::boolean, false),
      _action->>'action_id'
    );
  end if;

  if _private is not null then
    for p in select * from jsonb_array_elements(_private) loop
      update public.mudwater_seat_private set
        hand = array(select jsonb_array_elements_text(p->'hand')::int),
        rocks = coalesce(p->'rocks', '[]'),
        updated_at = now()
      where match_id = _match and seat = (p->>'seat')::smallint;
    end loop;
  end if;

  if (_patch->>'status') in ('finished', 'aborted') then
    update public.mudwater_seats set active = false where match_id = _match;
  end if;
  return true;
end $$;
revoke all on function public.mudwater_commit(uuid, integer, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.mudwater_commit(uuid, integer, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ── Housekeeping (runs SQL only — no outbound calls) ───────────────────────
-- Releases waiting seats idle for 120 s, closes empty waiting matches, and
-- aborts (no winner) playing matches nobody has been connected to resolve
-- for 90 s past the turn deadline. A connected player's client resolves
-- an ordinary timeout first, as a forfeit.
create or replace function public.mudwater_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mudwater_seats s set active = false
    from public.mudwater_matches m
   where m.id = s.match_id and m.status = 'waiting' and not s.is_agent and s.active
     and s.last_seen_at < now() - interval '120 seconds';
  delete from public.mudwater_seats s
   using public.mudwater_matches m
   where m.id = s.match_id and m.status = 'waiting' and not s.is_agent and not s.active;
  update public.mudwater_matches m set
    status = 'aborted', end_reason = 'expired', finished_at = now(), updated_at = now(),
    version = version + 1
   where m.status = 'waiting'
     and not exists (select 1 from public.mudwater_seats s
                      where s.match_id = m.id and not s.is_agent and s.active);
  update public.mudwater_matches m set
    status = 'aborted', end_reason = 'abandoned', winner_seat = null,
    finished_at = now(), updated_at = now(), version = version + 1,
    public_state = case when m.public_state is null then null else jsonb_set(
      m.public_state, '{result}',
      jsonb_build_object('winner', null, 'scores', m.public_state->'scores', 'reason', 'abandoned')) end
   where m.status = 'playing' and m.turn_deadline < now() - interval '90 seconds';
  update public.mudwater_seats s set active = false
    from public.mudwater_matches m
   where m.id = s.match_id and m.status in ('finished', 'aborted') and s.active;
end $$;
revoke all on function public.mudwater_sweep() from public, anon, authenticated;
grant execute on function public.mudwater_sweep() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mudwater-sweep') then
    perform cron.unschedule('mudwater-sweep');
  end if;
  perform cron.schedule('mudwater-sweep', '* * * * *', 'select public.mudwater_sweep()');
end $$;

-- ── Realtime ───────────────────────────────────────────────────────────────
alter table public.mudwater_matches replica identity full;
alter table public.mudwater_seats replica identity full;
alter table public.mudwater_seat_private replica identity full;
alter table public.mudwater_actions replica identity full;
do $$
declare t text;
begin
  foreach t in array array['mudwater_matches', 'mudwater_seats', 'mudwater_seat_private', 'mudwater_actions'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
