-- Ape Rides: scheduled rides granted by the super admin, viewer
-- reservations, and APE (ApeChain) payments verified on-chain by the server.
alter type public.ape_ride_status add value if not exists 'scheduled';
alter type public.ape_ride_status add value if not exists 'cancelled';

alter table public.ape_rides
  add column if not exists price_ape numeric(20,6) not null default 0 check (price_ape >= 0),
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists admin_override boolean not null default false,
  add column if not exists granted_by uuid,
  add column if not exists cancelled_by uuid,
  add column if not exists cancel_reason text,
  add column if not exists capacity integer not null default 1 check (capacity between 1 and 50);

create table if not exists public.ape_ride_reservations (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ape_rides(id) on delete cascade,
  viewer_id uuid not null,
  status text not null default 'reserved' check (status in ('reserved','paid','cancelled')),
  price_ape numeric(20,6) not null default 0,
  cancelled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ape_ride_reservations_active_unique
  on public.ape_ride_reservations (ride_id, viewer_id) where status <> 'cancelled';
create index if not exists ape_ride_reservations_viewer_idx on public.ape_ride_reservations (viewer_id);

create table if not exists public.ape_ride_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.ape_ride_reservations(id) on delete cascade,
  ride_id uuid not null references public.ape_rides(id) on delete cascade,
  payer_id uuid not null,
  host_id uuid not null,
  chain_id integer not null,
  tx_hash text not null unique,
  from_address text not null,
  to_address text not null,
  amount_wei numeric(78,0) not null,
  created_at timestamptz not null default now()
);

alter table public.ape_ride_reservations enable row level security;
alter table public.ape_ride_payments enable row level security;
revoke all on public.ape_ride_reservations, public.ape_ride_payments from anon, authenticated;
grant select on public.ape_ride_reservations, public.ape_ride_payments to authenticated;
grant all on public.ape_ride_reservations, public.ape_ride_payments to service_role;

-- Read: the viewer, the ride's host, or staff. All writes are server-only.
drop policy if exists "Reservation parties read" on public.ape_ride_reservations;
create policy "Reservation parties read" on public.ape_ride_reservations
  for select to authenticated using (
    viewer_id = (select auth.uid())
    or exists (select 1 from public.ape_rides r where r.id = ride_id and r.host_id = (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
    or public.has_role((select auth.uid()), 'super_admin'::app_role)
  );
drop policy if exists "Payment parties read" on public.ape_ride_payments;
create policy "Payment parties read" on public.ape_ride_payments
  for select to authenticated using (
    payer_id = (select auth.uid())
    or host_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::app_role)
    or public.has_role((select auth.uid()), 'super_admin'::app_role)
  );

do $$ begin
  alter publication supabase_realtime add table public.ape_ride_reservations;
exception when others then null; end $$;
