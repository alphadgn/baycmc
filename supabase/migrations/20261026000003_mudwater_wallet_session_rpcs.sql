-- Mudwater follow-up.
--
-- 1. Mudwater is only for members signed in with a blockchain wallet in
--    this session. Email-only sessions see nothing Mudwater. (Glyph
--    sign-ins attached to a wallet are wallet sessions.)
-- 2. Every Mudwater write goes through one server-only database function,
--    each a single atomic transaction (open a table, join, pick cards, leave,
--    presence). The server calls these with the service role.

create or replace function public.mudwater_has_wallet_session(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and exists (select 1 from public.session_wallets w where w.user_id = _uid);
$$;

-- For the menu: may the signed-in member see Mudwater at all?
create or replace function public.my_mudwater_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mudwater_has_wallet_session((select auth.uid()));
$$;
revoke all on function public.mudwater_has_wallet_session(uuid) from public, anon;
revoke all on function public.my_mudwater_access() from public, anon;
grant execute on function public.mudwater_has_wallet_session(uuid) to authenticated, service_role;
grant execute on function public.my_mudwater_access() to authenticated, service_role;

create or replace function public.mudwater_can_play(_room uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mudwater_has_wallet_session(_uid) and coalesce((
    select case
      when r.kind <> 'mudwater' or not r.active then false
      when r.required_collection is null then true
      else exists (
        select 1 from public.user_verifications v
         where v.user_id = _uid and r.required_collection = any (v.verified_collections)
      )
    end
    from public.rooms r where r.id = _room
  ), false);
$$;

-- Watching (and later betting): a wallet signed in this session.
create or replace function public.mudwater_can_watch(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mudwater_has_wallet_session(_uid);
$$;

-- ── Writes ─────────────────────────────────────────────────────────────────
-- Errors raised as 'MW: <message>' are shown to the member as-is.

create or replace function public.mudwater_open_table(
  _room uuid, _uid uuid, _mode text, _advanced boolean,
  _display_name text, _avatar_url text,
  _catalog_version text, _rules_version text, _agent_policy text,
  _agent_name text, _agent_deck integer[],
  _rematch_of uuid default null, _seat smallint default 0, _deck integer[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.rooms%rowtype;
  m uuid;
  busy text;
begin
  select * into r from public.rooms where id = _room and kind = 'mudwater' and active;
  if not found then raise exception 'MW: That Mudwater room doesn''t exist.'; end if;
  if _mode not in ('agent', 'pvp') then raise exception 'MW: Unknown game mode.'; end if;
  if _seat not in (0, 1) then raise exception 'MW: Unknown seat.'; end if;

  select m2.room_name into busy
    from public.mudwater_seats s join public.mudwater_matches m2 on m2.id = s.match_id
   where s.user_id = _uid and s.active and m2.status = 'playing' limit 1;
  if busy is not null then
    raise exception 'MW: You''re still playing in %. Finish or resign that game first.', busy;
  end if;
  -- Free any seat this member still holds at a table that hasn't started.
  perform public.mudwater_leave_waiting(s.match_id, _uid)
     from public.mudwater_seats s join public.mudwater_matches m2 on m2.id = s.match_id
    where s.user_id = _uid and s.active and m2.status = 'waiting';

  begin
    insert into public.mudwater_matches
      (room_id, room_name, room_slug, required_collection, mode, advanced,
       catalog_version, rules_version, agent_policy, rematch_of, created_by)
    values
      (r.id, r.name, coalesce(r.slug, lower(r.name)), r.required_collection, _mode, _advanced,
       _catalog_version, _rules_version, case when _mode = 'agent' then _agent_policy end, _rematch_of, _uid)
    returning id into m;
  exception when unique_violation then
    raise exception 'MW: Someone just opened this table. Join their game or try another room.';
  end;

  insert into public.mudwater_seats (match_id, seat, user_id, display_name, avatar_url)
  values (m, _seat, _uid, coalesce(nullif(trim(_display_name), ''), 'Member'), _avatar_url);
  insert into public.mudwater_seat_private (match_id, seat, user_id, deck)
  values (m, _seat, _uid, coalesce(_deck, '{}'));

  if _mode = 'agent' then
    insert into public.mudwater_seats (match_id, seat, is_agent, display_name, ready)
    values (m, 1 - _seat, true, _agent_name, true);
    insert into public.mudwater_seat_private (match_id, seat, deck)
    values (m, 1 - _seat, _agent_deck);
  end if;
  return m;
end $$;

create or replace function public.mudwater_join_seat(
  _match uuid, _uid uuid, _display_name text, _avatar_url text, _seat smallint default null
) returns smallint language plpgsql security definer set search_path = public as $$
declare
  mm public.mudwater_matches%rowtype;
  free smallint;
  busy text;
begin
  select * into mm from public.mudwater_matches where id = _match for update;
  if not found then raise exception 'MW: That game no longer exists.'; end if;
  if exists (select 1 from public.mudwater_seats where match_id = _match and user_id = _uid and active) then
    return (select seat from public.mudwater_seats where match_id = _match and user_id = _uid and active);
  end if;
  if mm.status <> 'waiting' or mm.mode <> 'pvp' then
    raise exception 'MW: This table is busy. Watch the match, or try another room.';
  end if;
  select m2.room_name into busy
    from public.mudwater_seats s join public.mudwater_matches m2 on m2.id = s.match_id
   where s.user_id = _uid and s.active and m2.status = 'playing' limit 1;
  if busy is not null then
    raise exception 'MW: You''re still playing in %. Finish or resign that game first.', busy;
  end if;
  perform public.mudwater_leave_waiting(s.match_id, _uid)
     from public.mudwater_seats s join public.mudwater_matches m2 on m2.id = s.match_id
    where s.user_id = _uid and s.active and m2.status = 'waiting' and s.match_id <> _match;

  free := coalesce(_seat, (select x from unnest(array[0, 1]::smallint[]) x
                             where not exists (select 1 from public.mudwater_seats s
                                                where s.match_id = _match and s.seat = x and s.active)
                             limit 1));
  if free is null or exists (select 1 from public.mudwater_seats where match_id = _match and seat = free and active) then
    raise exception 'MW: That seat was just taken.';
  end if;
  delete from public.mudwater_seats where match_id = _match and seat = free;
  delete from public.mudwater_seat_private where match_id = _match and seat = free;
  insert into public.mudwater_seats (match_id, seat, user_id, display_name, avatar_url)
  values (_match, free, _uid, coalesce(nullif(trim(_display_name), ''), 'Member'), _avatar_url);
  insert into public.mudwater_seat_private (match_id, seat, user_id) values (_match, free, _uid);
  update public.mudwater_seats set ready = false where match_id = _match and not is_agent and seat <> free;
  update public.mudwater_matches set updated_at = now(), version = version + 1 where id = _match;
  return free;
end $$;

create or replace function public.mudwater_set_deck(
  _match uuid, _uid uuid, _deck integer[], _ready boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  st text;
  s smallint;
begin
  select status into st from public.mudwater_matches where id = _match for update;
  if st is null then raise exception 'MW: That game no longer exists.'; end if;
  if st <> 'waiting' then raise exception 'MW: The game has already started.'; end if;
  select seat into s from public.mudwater_seats where match_id = _match and user_id = _uid and active;
  if s is null then raise exception 'MW: You''re not seated in this game.'; end if;
  update public.mudwater_seat_private set deck = coalesce(_deck, '{}'), updated_at = now()
   where match_id = _match and seat = s;
  update public.mudwater_seats set ready = _ready, last_seen_at = now()
   where match_id = _match and seat = s;
  update public.mudwater_matches set updated_at = now(), version = version + 1 where id = _match;
end $$;

create or replace function public.mudwater_leave_waiting(_match uuid, _uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s smallint;
begin
  select seat into s from public.mudwater_seats
   where match_id = _match and user_id = _uid and active;
  if s is null then return; end if;
  if (select status from public.mudwater_matches where id = _match) <> 'waiting' then return; end if;
  delete from public.mudwater_seat_private where match_id = _match and seat = s;
  delete from public.mudwater_seats where match_id = _match and seat = s;
  if not exists (select 1 from public.mudwater_seats where match_id = _match and not is_agent and active) then
    update public.mudwater_matches
       set status = 'aborted', end_reason = 'left', finished_at = now(), updated_at = now(), version = version + 1
     where id = _match;
    update public.mudwater_seats set active = false where match_id = _match;
  else
    update public.mudwater_seats set ready = false where match_id = _match and not is_agent;
    update public.mudwater_matches set updated_at = now(), version = version + 1 where id = _match;
  end if;
end $$;

create or replace function public.mudwater_touch(_match uuid, _uid uuid)
returns void language sql security definer set search_path = public as $$
  update public.mudwater_seats set last_seen_at = now()
   where match_id = _match and user_id = _uid and active;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.mudwater_open_table(uuid, uuid, text, boolean, text, text, text, text, text, text, integer[], uuid, smallint, integer[])',
    'public.mudwater_join_seat(uuid, uuid, text, text, smallint)',
    'public.mudwater_set_deck(uuid, uuid, integer[], boolean)',
    'public.mudwater_leave_waiting(uuid, uuid)',
    'public.mudwater_touch(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
