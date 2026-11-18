-- Health report P0-3 and P1-8: hosts could insert/update their own ape_rides rows with no
-- column limits (admin_override, status, granted_by, price ...), bypassing the super-admin
-- grant flow and the venue geofence. All ride writes now go through server functions
-- (service role) that re-check the grant, the venue and the caller.

revoke insert, update on public.ape_rides from anon, authenticated;
grant all on public.ape_rides to service_role;
drop policy if exists "Verified users can create their own rides" on public.ape_rides;
drop policy if exists "Hosts or admins can update rides" on public.ape_rides;

-- Defense in depth: if a grant is ever widened again, a signed-in member who is not the
-- super admin still can't create rides or touch the protected columns.
create or replace function public.ape_rides_guard_protected()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.has_role(auth.uid(), 'super_admin'::app_role) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Ape Rides are created by the server';
  end if;
  if new.admin_override is distinct from old.admin_override
     or new.status is distinct from old.status
     or new.granted_by is distinct from old.granted_by
     or new.price_ape is distinct from old.price_ape
     or new.capacity is distinct from old.capacity
     or new.host_id is distinct from old.host_id
     or new.venue_slug is distinct from old.venue_slug
     or new.scheduled_start is distinct from old.scheduled_start
     or new.scheduled_end is distinct from old.scheduled_end
     or new.cancelled_by is distinct from old.cancelled_by then
    raise exception 'Only the super admin can change that ride field';
  end if;
  return new;
end $$;
revoke all on function public.ape_rides_guard_protected() from public, anon, authenticated;
drop trigger if exists trg_a_ape_rides_guard_protected on public.ape_rides;
create trigger trg_a_ape_rides_guard_protected
before insert or update on public.ape_rides
for each row execute function public.ape_rides_guard_protected();

-- Atomic reservation: lock the ride row, check capacity, insert, all in one transaction,
-- so concurrent reservations can't overbook (health report P1-8).
create or replace function public.ape_ride_reserve(_ride uuid, _viewer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.ape_rides;
  n integer;
  res public.ape_ride_reservations;
begin
  select * into r from public.ape_rides where id = _ride for update;
  if not found or r.status::text not in ('scheduled', 'live') then
    raise exception 'AR: This ride isn''t open for reservations.';
  end if;
  if r.host_id = _viewer then
    raise exception 'AR: You''re hosting this ride.';
  end if;
  select count(*) into n from public.ape_ride_reservations
   where ride_id = _ride and status <> 'cancelled';
  if n >= coalesce(r.capacity, 1) then
    raise exception 'AR: This ride is fully booked.';
  end if;
  begin
    insert into public.ape_ride_reservations (ride_id, viewer_id, price_ape)
    values (_ride, _viewer, coalesce(r.price_ape, 0))
    returning * into res;
  exception when unique_violation then
    raise exception 'AR: You already have a reservation for this ride.';
  end;
  return jsonb_build_object('id', res.id, 'status', res.status, 'price_ape', res.price_ape);
end $$;
revoke all on function public.ape_ride_reserve(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ape_ride_reserve(uuid, uuid) to service_role;
