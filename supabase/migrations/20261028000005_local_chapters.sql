-- Local Chapters (owner decisions 2026-10-28).
--
--  * The super admin keeps the list of chapters (Southeast Apes, UK Apes, …).
--  * BAYC / MAYC / CryptoPunks holders (and admins) see Local Chapters, browse
--    upcoming meetings, and request a meeting: chapter, one of the 20 Club
--    Rooms, date, time, duration and expected capacity.
--  * Admins / the super admin approve or decline; approval refuses overlaps.
--  * The approved leader adds attendees by username: BAYC/MAYC leaders add
--    verified BAYC/MAYC members, CryptoPunks leaders add verified CryptoPunks
--    members (members known to the app with that verified collection).
--  * Club Rooms stay hidden; during an approved meeting (from 10 minutes
--    before the start to the end) only the leader, the listed attendees,
--    admins and the super admin can see or enter the room.
--  * Each meeting has its own chat. When it ends, the leader (host) is asked
--    to export or dismiss AI-written minutes; after either, the meeting, its
--    chat and every reference to it are deleted. Unclaimed meetings are
--    deleted 7 days after they end.

-- Durable record of each member's last verified collections (session
-- verification is wiped at sign-out; attendee lists need members who are
-- not signed in right now). Written by the server only.
create table if not exists public.member_holdings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  labels text[] not null default '{}',
  verified_at timestamptz not null default now()
);
alter table public.member_holdings enable row level security;
revoke all on public.member_holdings from anon, authenticated;
grant all on public.member_holdings to service_role;
insert into public.member_holdings (user_id, labels, verified_at)
select user_id, verified_collections, coalesce(verified_at, now())
  from public.user_verifications
 where coalesce(array_length(verified_collections, 1), 0) > 0
on conflict (user_id) do nothing;

create table if not exists public.local_chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 60),
  display_order integer not null default 100,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
insert into public.local_chapters (name, display_order)
values ('Southeast Apes', 1), ('Northeast Apes', 2), ('Southwest Apes', 3), ('Northwest Apes', 4),
       ('UK Apes', 5), ('French Apes', 6), ('Asia Apes', 7)
on conflict (name) do nothing;
alter table public.local_chapters enable row level security;
revoke all on public.local_chapters from anon, authenticated;
grant select on public.local_chapters to authenticated;
grant all on public.local_chapters to service_role;
drop policy if exists "Local chapters: members read" on public.local_chapters;
create policy "Local chapters: members read" on public.local_chapters for select to authenticated using (true);

create table if not exists public.chapter_meetings (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.local_chapters(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expected_capacity integer not null check (expected_capacity between 2 and 500),
  notes text check (length(notes) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled', 'ended')),
  leader_labels text[] not null default '{}',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists chapter_meetings_room_time on public.chapter_meetings (room_id, starts_at);
create index if not exists chapter_meetings_status on public.chapter_meetings (status, ends_at);

create table if not exists public.chapter_meeting_attendees (
  meeting_id uuid not null references public.chapter_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create table if not exists public.chapter_meeting_attendance (
  meeting_id uuid not null references public.chapter_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

alter table public.chapter_meetings enable row level security;
alter table public.chapter_meeting_attendees enable row level security;
alter table public.chapter_meeting_attendance enable row level security;
revoke all on public.chapter_meetings, public.chapter_meeting_attendees, public.chapter_meeting_attendance
  from anon, authenticated;
grant select on public.chapter_meetings, public.chapter_meeting_attendees, public.chapter_meeting_attendance
  to authenticated;
grant all on public.chapter_meetings, public.chapter_meeting_attendees, public.chapter_meeting_attendance
  to service_role;

create or replace function public.is_staff(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_uid, 'admin'::app_role) or public.has_role(_uid, 'super_admin'::app_role);
$$;

-- Who sees Local Chapters: BAYC / MAYC / CryptoPunks holders (this session;
-- the verified role counts as BAYC/MAYC) and staff.
create or replace function public.chapter_viewer(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and (public.is_staff(_uid) or public.holds_any_collection(_uid, 'BAYC,MAYC,PUNKS'));
$$;

-- Labels a member is known to hold (durable + this session + verified role).
create or replace function public.member_known_labels(_uid uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array(
    select distinct l from (
      select unnest(coalesce((select labels from public.member_holdings where user_id = _uid), '{}')) as l
      union all
      select unnest(coalesce((select verified_collections from public.user_verifications where user_id = _uid), '{}'))
      union all
      select unnest(case when public.has_role(_uid, 'verified_user'::app_role) then array['BAYC', 'MAYC'] else '{}'::text[] end)
    ) x where l is not null
  );
$$;

create or replace function public.chapter_meeting_member(_meeting uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chapter_meetings m where m.id = _meeting and m.requester_id = _uid)
      or exists (select 1 from public.chapter_meeting_attendees a where a.meeting_id = _meeting and a.user_id = _uid);
$$;

-- The room is open for this member right now?
create or replace function public.chapter_room_access(_uid uuid, _room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and (
    public.is_staff(_uid)
    or exists (
      select 1 from public.chapter_meetings m
       where m.room_id = _room and m.status = 'approved'
         and now() between m.starts_at - interval '10 minutes' and m.ends_at
         and public.chapter_meeting_member(m.id, _uid)
    )
  );
$$;

drop policy if exists "Chapter meetings: browse and own" on public.chapter_meetings;
create policy "Chapter meetings: browse and own" on public.chapter_meetings for select to authenticated
  using (
    public.is_staff((select auth.uid()))
    or requester_id = (select auth.uid())
    or public.chapter_meeting_member(id, (select auth.uid()))
    or (status = 'approved' and ends_at > now() and public.chapter_viewer((select auth.uid())))
  );
drop policy if exists "Chapter attendees: leader, self, staff" on public.chapter_meeting_attendees;
create policy "Chapter attendees: leader, self, staff" on public.chapter_meeting_attendees for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_staff((select auth.uid()))
    or exists (select 1 from public.chapter_meetings m where m.id = meeting_id and m.requester_id = (select auth.uid()))
  );
drop policy if exists "Chapter attendance: leader and staff" on public.chapter_meeting_attendance;
create policy "Chapter attendance: leader and staff" on public.chapter_meeting_attendance for select to authenticated
  using (
    public.is_staff((select auth.uid()))
    or exists (select 1 from public.chapter_meetings m where m.id = meeting_id and m.requester_id = (select auth.uid()))
  );

-- ── Actions ────────────────────────────────────────────────────────────────

create or replace function public.chapter_request_meeting(
  _chapter uuid, _room uuid, _starts timestamptz, _minutes integer, _capacity integer, _notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.rooms%rowtype;
  lbl text[];
  mid uuid;
begin
  if not public.chapter_viewer(me) then
    raise exception 'Local chapter meetings are for verified BAYC, MAYC and CryptoPunks holders.';
  end if;
  if not exists (select 1 from public.local_chapters where id = _chapter and active) then
    raise exception 'Pick a chapter from the list.';
  end if;
  select * into r from public.rooms where id = _room and kind = 'chapter' and active;
  if not found then raise exception 'Pick one of the 20 chapter rooms.'; end if;
  if _minutes is null or _minutes < 15 or _minutes > 480 then
    raise exception 'Meetings run 15 minutes to 8 hours.';
  end if;
  if _starts < now() + interval '10 minutes' then
    raise exception 'Choose a start time at least 10 minutes from now.';
  end if;
  if _capacity is null or _capacity < 2 or _capacity > r.capacity then
    raise exception 'Expected capacity must be between 2 and % for that room.', r.capacity;
  end if;
  if exists (select 1 from public.chapter_meetings m
              where m.room_id = _room and m.status = 'approved'
                and tstzrange(m.starts_at, m.ends_at) && tstzrange(_starts, _starts + make_interval(mins => _minutes))) then
    raise exception 'That room is already booked at that time. Pick another time or room.';
  end if;
  lbl := array(select unnest(public.member_known_labels(me)) intersect select unnest(array['BAYC', 'MAYC', 'PUNKS']));
  insert into public.chapter_meetings
    (chapter_id, requester_id, room_id, starts_at, ends_at, expected_capacity, notes, leader_labels)
  values (_chapter, me, _room, _starts, _starts + make_interval(mins => _minutes), _capacity, left(_notes, 1000), lbl)
  returning id into mid;
  insert into public.notifications (user_id, kind, title, body, url)
  select ur.user_id, 'chapter.request', 'New chapter meeting request',
         (select name from public.local_chapters where id = _chapter) || ' · ' || r.name,
         '/admin/chapters'
    from public.user_roles ur where ur.role in ('admin', 'super_admin');
  return mid;
end $$;

create or replace function public.chapter_review_meeting(_meeting uuid, _approve boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.chapter_meetings%rowtype;
begin
  if not public.is_staff(me) then raise exception 'Only admins can review chapter meetings.'; end if;
  select * into m from public.chapter_meetings where id = _meeting for update;
  if not found then raise exception 'Request not found.'; end if;
  if m.status <> 'pending' then raise exception 'This request was already handled.'; end if;
  if _approve then
    perform pg_advisory_xact_lock(hashtextextended('chapter_room:' || m.room_id::text, 0));
    if exists (select 1 from public.chapter_meetings o
                where o.room_id = m.room_id and o.status = 'approved' and o.id <> m.id
                  and tstzrange(o.starts_at, o.ends_at) && tstzrange(m.starts_at, m.ends_at)) then
      raise exception 'That room already has an approved meeting overlapping this time.';
    end if;
  end if;
  update public.chapter_meetings
     set status = case when _approve then 'approved' else 'declined' end,
         reviewed_by = me, reviewed_at = now(), review_note = left(_note, 500)
   where id = _meeting;
  insert into public.notifications (user_id, kind, title, body, url)
  values (m.requester_id, 'chapter.review',
          case when _approve then 'Your chapter meeting is approved' else 'Your chapter meeting request was declined' end,
          coalesce(left(_note, 300), to_char(m.starts_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC'),
          '/chapters/book');
  insert into public.audit_logs (event_type, actor_id, target_id)
  values (case when _approve then 'chapter.approve' else 'chapter.decline' end, me, _meeting);
end $$;

create or replace function public.chapter_cancel_meeting(_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.chapter_meetings%rowtype;
begin
  select * into m from public.chapter_meetings where id = _meeting;
  if not found then raise exception 'Meeting not found.'; end if;
  if m.requester_id <> me and not public.is_staff(me) then raise exception 'Not your meeting.'; end if;
  if m.status not in ('pending', 'approved') or m.starts_at <= now() then
    raise exception 'Only meetings that haven''t started can be cancelled.';
  end if;
  update public.chapter_meetings set status = 'cancelled' where id = _meeting;
end $$;

-- Leader (or staff): add or remove an attendee.
create or replace function public.chapter_set_attendee(_meeting uuid, _user uuid, _add boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m public.chapter_meetings%rowtype;
  allowed text[];
  n integer;
begin
  select * into m from public.chapter_meetings where id = _meeting;
  if not found then raise exception 'Meeting not found.'; end if;
  if m.requester_id <> me and not public.is_staff(me) then raise exception 'Only the chapter leader can manage attendees.'; end if;
  if m.status <> 'approved' or m.ends_at <= now() then
    raise exception 'Attendees can be changed only for approved, upcoming meetings.';
  end if;
  if not _add then
    delete from public.chapter_meeting_attendees where meeting_id = _meeting and user_id = _user;
    return;
  end if;
  if _user = m.requester_id then return; end if;
  -- BAYC/MAYC leaders invite verified BAYC/MAYC members; CryptoPunks leaders
  -- invite verified CryptoPunks members.
  allowed := array[]::text[];
  if m.leader_labels && array['BAYC', 'MAYC'] then allowed := allowed || array['BAYC', 'MAYC']; end if;
  if m.leader_labels && array['PUNKS'] then allowed := allowed || array['PUNKS']; end if;
  if public.is_staff(me) and m.requester_id <> me and cardinality(allowed) = 0 then
    allowed := array['BAYC', 'MAYC', 'PUNKS'];
  end if;
  if not (public.member_known_labels(_user) && allowed) then
    raise exception 'That member isn''t a verified % holder in BAYCmc.',
      array_to_string(array(select case x when 'PUNKS' then 'CryptoPunks' else x end from unnest(allowed) x), ' / ');
  end if;
  select count(*) into n from public.chapter_meeting_attendees where meeting_id = _meeting;
  if n + 1 >= m.expected_capacity then
    raise exception 'The attendee list is full for the expected capacity (%).', m.expected_capacity;
  end if;
  insert into public.chapter_meeting_attendees (meeting_id, user_id, added_by)
  values (_meeting, _user, me) on conflict do nothing;
  insert into public.notifications (user_id, kind, title, body, url)
  values (_user, 'chapter.invite', 'You''re on a chapter meeting list',
          (select name from public.local_chapters where id = m.chapter_id) || ' · '
            || to_char(m.starts_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC',
          '/chapters/' || m.chapter_id::text);
end $$;

-- Server only: record that a member joined / is still in the meeting room.
create or replace function public.chapter_touch_attendance(_room uuid, _uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.chapter_meeting_attendance (meeting_id, user_id)
  select m.id, _uid from public.chapter_meetings m
   where m.room_id = _room and m.status = 'approved'
     and now() between m.starts_at - interval '10 minutes' and m.ends_at
  on conflict (meeting_id, user_id) do update set last_seen_at = now();
$$;

-- Host (or staff): delete a meeting and every reference to it.
create or replace function public.chapter_delete_meeting(_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.chapter_meetings%rowtype;
begin
  select * into m from public.chapter_meetings where id = _meeting;
  if not found then return; end if;
  if me is not null and m.requester_id <> me and not public.is_staff(me) then
    raise exception 'Not your meeting.';
  end if;
  delete from public.lobby_messages where channel = 'meeting:' || _meeting::text;
  delete from public.notifications where url like '%' || _meeting::text || '%';
  delete from public.chapter_meetings where id = _meeting;
end $$;

-- Housekeeping (SQL only): end meetings, ask the host about minutes, and
-- delete meetings 7 days after they end if the host never chose.
create or replace function public.chapter_meetings_sweep()
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select * from public.chapter_meetings where status = 'approved' and ends_at < now() loop
    update public.chapter_meetings set status = 'ended' where id = m.id;
    insert into public.notifications (user_id, kind, title, body, url)
    values (m.requester_id, 'chapter.minutes', 'Your chapter meeting has ended',
            'Would you like to archive and export the meeting minutes?',
            '/chapters/minutes/' || m.id::text);
  end loop;
  for m in select id from public.chapter_meetings
            where (status = 'ended' and ends_at < now() - interval '7 days')
               or (status in ('declined', 'cancelled') and created_at < now() - interval '30 days')
               or (status = 'pending' and ends_at < now()) loop
    perform public.chapter_delete_meeting(m.id);
  end loop;
end $$;

-- Super admin: manage the chapter list.
create or replace function public.chapter_save(_id uuid, _name text, _order integer, _active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only the super admin can edit the chapter list.';
  end if;
  if _id is null then
    insert into public.local_chapters (name, display_order, active, created_by)
    values (trim(_name), coalesce(_order, 100), coalesce(_active, true), auth.uid()) returning id into cid;
  else
    update public.local_chapters set name = trim(_name), display_order = coalesce(_order, display_order),
           active = coalesce(_active, active) where id = _id returning id into cid;
  end if;
  return cid;
end $$;
create or replace function public.chapter_remove(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only the super admin can edit the chapter list.';
  end if;
  perform public.chapter_delete_meeting(id) from public.chapter_meetings where chapter_id = _id;
  delete from public.local_chapters where id = _id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.chapter_request_meeting(uuid, uuid, timestamptz, integer, integer, text)',
    'public.chapter_review_meeting(uuid, boolean, text)',
    'public.chapter_cancel_meeting(uuid)',
    'public.chapter_set_attendee(uuid, uuid, boolean)',
    'public.chapter_delete_meeting(uuid)',
    'public.chapter_save(uuid, text, integer, boolean)',
    'public.chapter_remove(uuid)',
    'public.chapter_viewer(uuid)',
    'public.chapter_room_access(uuid, uuid)',
    'public.chapter_meeting_member(uuid, uuid)',
    'public.member_known_labels(uuid)',
    'public.is_staff(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.chapter_touch_attendance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chapter_touch_attendance(uuid, uuid) to service_role;
revoke all on function public.chapter_meetings_sweep() from public, anon, authenticated;
grant execute on function public.chapter_meetings_sweep() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'chapter-meetings-sweep') then
    perform cron.unschedule('chapter-meetings-sweep');
  end if;
  perform cron.schedule('chapter-meetings-sweep', '* * * * *', 'select public.chapter_meetings_sweep()');
end $$;

-- ── Chat channels: one per chapter meeting ('meeting:<id>'), and one per
--    conference room ('room:<id>', stage 6) ─────────────────────────────────
alter table public.lobby_messages drop constraint if exists lobby_messages_channel_check;
alter table public.lobby_messages add constraint lobby_messages_channel_check
  check (channel = any (array['lobby', 'punks-brunch', 'holders'])
         or channel ~ '^(meeting|room):[0-9a-f-]{36}$');

create or replace function public.can_access_chat_channel(_channel text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); target uuid;
begin
  if _channel = 'lobby' then return uid is not null; end if;
  if _channel = 'punks-brunch' then return public.can_access_area(uid, 'punks_brunch'); end if;
  if _channel = 'holders' then return public.can_access_area(uid, 'holders_chat'); end if;
  if _channel ~ '^meeting:[0-9a-f-]{36}$' then
    target := substring(_channel from 9)::uuid;
    return public.is_staff(uid) or public.chapter_meeting_member(target, uid);
  end if;
  if _channel ~ '^room:[0-9a-f-]{36}$' then
    target := substring(_channel from 6)::uuid;
    -- Same people who can see the room.
    return public.room_visible(uid, target);
  end if;
  return false;
end $function$;

-- ── Rooms: one visibility rule, used by the rooms policy and room chats ────
create or replace function public.room_visible(_uid uuid, _room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when r.kind = 'mudwater' then public.mudwater_can_play(r.id, _uid)
      when r.kind = 'chapter' then public.chapter_room_access(_uid, r.id)
      else (
        _uid is not null and (
          r.kind = 'karaoke'
          or r.kind = 'game'
          or r.tier = 'public'
          or public.is_staff(_uid)
          or (r.kind = 'stream' and public.can_access_area(_uid, 'event_stream'))
          or (r.required_collection = 'PUNKS' and public.can_access_area(_uid, 'punks_brunch'))
          or (r.required_collection is not null and r.required_collection <> 'PUNKS'
              and public.can_access_area(_uid, 'conference_rooms')
              and public.holds_any_collection(_uid, r.required_collection))
          or (r.tier = 'lifer' and public.is_lifer(_uid))
          or (r.kind not in ('stream', 'game') and r.required_collection is null and r.tier <> 'lifer'
              and public.can_access_area(_uid, 'conference_rooms'))
        )
      )
    end
    from public.rooms r where r.id = _room
  ), false);
$$;
revoke all on function public.room_visible(uuid, uuid) from public, anon;
grant execute on function public.room_visible(uuid, uuid) to authenticated, service_role;

alter policy "Authenticated users can read rooms (locked preview)" on public.rooms
  using (public.room_visible((select auth.uid()), id));

-- The 20 Club Rooms as a booking catalogue (names, pictures, capacity) for
-- chapter members; the rooms themselves stay hidden until a meeting opens.
create or replace function public.chapter_room_catalog()
returns table (id uuid, name text, theme text, capacity integer)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.theme, r.capacity from public.rooms r
   where r.kind = 'chapter' and r.active and public.chapter_viewer(auth.uid())
   order by r.display_order, r.name;
$$;
revoke all on function public.chapter_room_catalog() from public, anon;
grant execute on function public.chapter_room_catalog() to authenticated;

notify pgrst, 'reload schema';
