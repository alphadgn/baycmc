-- Booked meetings: an approved list per booking. While a booking is in
-- progress, only the booking's host, admins, and approved guests may enter
-- the room; anyone else waits until the host (or an admin) approves them.
-- Writes go through the server (service role) only.

create table if not exists public.room_booking_guests (
  booking_id uuid not null references public.room_bookings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('approved', 'pending', 'denied')),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  primary key (booking_id, user_id)
);
create index if not exists room_booking_guests_user_idx on public.room_booking_guests (user_id);

alter table public.room_booking_guests enable row level security;
revoke all on public.room_booking_guests from anon, authenticated;
grant select on public.room_booking_guests to authenticated;
grant all on public.room_booking_guests to service_role;

drop policy if exists "Guests: own row, booking host, or staff" on public.room_booking_guests;
create policy "Guests: own row, booking host, or staff"
  on public.room_booking_guests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin((select auth.uid()))
    or exists (
      select 1 from public.room_bookings b
       where b.id = booking_id and b.user_id = (select auth.uid())
    )
  );

-- Tell the booking host someone is waiting to be let in.
create or replace function public.room_guest_request_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.room_bookings;
  who text;
begin
  if new.status <> 'pending' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'pending' then return new; end if;
  select * into b from public.room_bookings where id = new.booking_id;
  if not found then return new; end if;
  select coalesce(nullif(username, ''), 'A member') into who from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, kind, title, body, url)
  values (
    b.user_id,
    'room_guest_request',
    coalesce(who, 'A member') || ' wants to join your meeting',
    coalesce(b.title, 'Your booking') || ' — approve or deny them in the room.',
    '/rooms/' || b.room_id
  );
  return new;
end $$;
revoke all on function public.room_guest_request_notify() from public, anon, authenticated;

drop trigger if exists room_booking_guests_notify on public.room_booking_guests;
create trigger room_booking_guests_notify
  after insert or update of status on public.room_booking_guests
  for each row execute function public.room_guest_request_notify();

alter table public.room_booking_guests replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_booking_guests'
  ) then
    alter publication supabase_realtime add table public.room_booking_guests;
  end if;
end $$;

notify pgrst, 'reload schema';
