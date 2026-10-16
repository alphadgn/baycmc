-- Ape Rides host locations (geofences). Hosting is allowed only when the
-- host's GPS is within radius_m of the chosen venue; the server re-checks.
create table if not exists public.ape_ride_venues (
  slug text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null check (radius_m between 50 and 20000),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ape_ride_venues enable row level security;
revoke all on public.ape_ride_venues from anon, authenticated;
grant select on public.ape_ride_venues to authenticated;
grant all on public.ape_ride_venues to service_role;
drop policy if exists "Members read active venues" on public.ape_ride_venues;
create policy "Members read active venues" on public.ape_ride_venues
  for select to authenticated using (active);

insert into public.ape_ride_venues (slug, name, lat, lng, radius_m, display_order) values
  ('wynwood', 'Wynwood, FL', 25.801, -80.199, 1000, 1),
  ('charleston', 'Charleston, SC', 32.7816, -79.9341, 1000, 2)
on conflict (slug) do nothing;

alter table public.ape_rides add column if not exists venue_slug text references public.ape_ride_venues(slug);
