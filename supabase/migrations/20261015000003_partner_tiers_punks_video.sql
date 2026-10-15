-- Partner collections (Temp Agency, Orca Business, Ugly Duck Labs): regular
-- member access + Ape Rides only. Holder clubhouse access (bayc_verified)
-- now comes only from BAYC / MAYC / CryptoPunks.

-- Collection checks no longer require holder-clubhouse access.
create or replace function public.holds_collection(_uid uuid, _label text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (select 1 from public.user_verifications v
             where v.user_id = _uid and _label = any (v.verified_collections))
    or public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role), false);
$$;

create or replace function public.can_use_ape_rides(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_token_proof_verified(_uid)
    or exists (select 1 from public.user_verifications v
                where v.user_id = _uid
                  and v.verified_collections && array['TEMP_AGENCY','ORCA_BUSINESS','UGLY_DUCK_LABS']),
    false);
$$;
revoke all on function public.can_use_ape_rides(uuid) from public, anon;
grant execute on function public.can_use_ape_rides(uuid) to authenticated;

drop policy if exists "Verified users can view ape rides" on public.ape_rides;
create policy "Verified users can view ape rides" on public.ape_rides
  for select to authenticated using (public.can_use_ape_rides(auth.uid()));
drop policy if exists "Verified users can create their own rides" on public.ape_rides;
create policy "Verified users can create their own rides" on public.ape_rides
  for insert to authenticated with check (auth.uid() = host_id and public.can_use_ape_rides(auth.uid()));
drop policy if exists "Verified viewers create requests" on public.ape_ride_requests;
create policy "Verified viewers create requests" on public.ape_ride_requests
  for insert to authenticated with check (auth.uid() = viewer_id and public.can_use_ape_rides(auth.uid()));

-- Existing partner-only holders were granted holder access by the previous
-- rule; take it back (they keep their verified collections + Ape Rides).
update public.user_verifications
   set bayc_verified = false, verified_at = null
 where bayc_verified
   and bayc_collection in ('TEMP_AGENCY','ORCA_BUSINESS','UGLY_DUCK_LABS')
   and not (verified_collections && array['BAYC','MAYC','PUNKS']);

-- Collection-specific rooms + the Punks Brunch video room.
alter table public.rooms add column if not exists required_collection text;
insert into public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, kind, required_collection)
select 'Punks Brunch', 'Video room for verified CryptoPunks holders.', 50, 'token_proof', 'punks-brunch',
       'punks-brunch', 2, 'conference', 'PUNKS'
 where not exists (select 1 from public.rooms where livekit_room = 'punks-brunch');
