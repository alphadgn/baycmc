-- Health report P0-2: members could set room_bookings.override_by themselves and skip the
-- overlap check. Now only admins (server-checked, service role) can set it, and the overlap
-- check runs with full visibility under a per-room lock so concurrent bookings can't both win.

-- 1) Column-level privileges: members may only write the ordinary booking fields.
revoke insert, update on public.room_bookings from anon, authenticated;
grant insert (room_id, user_id, title, starts_at, ends_at, notes) on public.room_bookings to authenticated;
grant update (title, starts_at, ends_at, notes) on public.room_bookings to authenticated;
grant all on public.room_bookings to service_role;

-- 2) Defense in depth: a signed-in non-admin can never set or change override_by,
--    even if the column grant is widened later. The service role (auth.uid() is null) is
--    trusted; the server only sets override_by after its own admin check.
create or replace function public.room_bookings_guard_override()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.override_by is not null
     and (tg_op = 'INSERT' or new.override_by is distinct from old.override_by) then
    if auth.uid() is not null
       and not (public.has_role(auth.uid(), 'admin'::app_role)
                or public.has_role(auth.uid(), 'super_admin'::app_role)) then
      raise exception 'Only admins can override booking conflicts';
    end if;
    if auth.uid() is not null then
      new.override_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
revoke all on function public.room_bookings_guard_override() from public, anon, authenticated;

-- Fires before trg_prevent_booking_overlap (triggers run in name order).
drop trigger if exists trg_a_room_bookings_guard_override on public.room_bookings;
create trigger trg_a_room_bookings_guard_override
before insert or update on public.room_bookings
for each row execute function public.room_bookings_guard_override();

-- 3) Overlap check: SECURITY DEFINER so it sees every booking (not just RLS-visible ones),
--    serialized per room with a transaction-scoped advisory lock.
create or replace function public.prevent_booking_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.override_by is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room_booking:' || new.room_id::text, 0));
  if exists (
    select 1 from public.room_bookings b
    where b.room_id = new.room_id
      and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Booking conflicts with an existing reservation for this room';
  end if;
  return new;
end $$;
revoke all on function public.prevent_booking_overlap() from public, anon, authenticated;
