-- Stage 1 — rooms, menu access and Lifer (owner decisions 2026-10-27/28).
--
-- Rooms
--  * Collection access per room (rooms.required_collection, any-of):
--      Garden, Library, Marina, Studio A, Studio B → Ugly Duck Labs, MAYC, BAYC, Orca Business, Temp Agency
--      Pool Deck, Conservatory, Helipad, Cigar Room → BAYC
--      Punks Brunch → CryptoPunks only
--    Karaoke stays general admission. The verified role counts as BAYC/MAYC.
--  * Conservatory, Cigar Room, Helipad and Marina are no longer Lifer rooms.
--    The Cellar is the only Lifer room.
--  * Deleted: Atrium, Boardroom 1/2, Lounge A/B, Penthouse, Rooftop, Vault,
--    Lifers Suite 1/2 (no bookings existed).
--  * Game Room: listed for every signed-in member but greyed out ("coming soon").
--  * Club Rooms 1–20 become kind 'chapter': hidden from everyone except admins
--    until chapter-meeting booking (stage 5) opens them per approved meeting.
--  * Menu order: Karaoke, (Mudwater), Garden, Library, Pool Deck, Conservatory,
--    Helipad, Marina, Cigar Room, Studio A, Studio B, Punks Brunch, Game Room.
--
-- Lifer
--  * Lifer access (Cellar + Lifer Chat) is granted only by the super admin
--    and lasts until the super admin removes it. No automatic route.
--
-- Menu access matrix (Super Admin → Menu access) keeps working as before;
-- only its data changes to match the decisions:
--  * Holders Chat and Ape Rides: BAYC and MAYC only.
--  * Conference rooms: also enabled for the partner collections (their rooms
--    are limited by each room's own collection list).

-- ── Room kinds / flags ─────────────────────────────────────────────────────
alter table public.rooms drop constraint if exists rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check
  check (kind = any (array['conference', 'game', 'karaoke', 'stream', 'mudwater', 'chapter']));
alter table public.rooms add column if not exists coming_soon boolean not null default false;

-- ── Deletions ──────────────────────────────────────────────────────────────
delete from public.rooms
 where name in ('Atrium', 'Boardroom 1', 'Boardroom 2', 'Lounge A', 'Lounge B',
                'Penthouse', 'Rooftop', 'Vault', 'Lifers Suite 1', 'Lifers Suite 2')
   and kind = 'conference';

-- ── Access lists, tiers and order ──────────────────────────────────────────
update public.rooms set display_order = 1 where kind = 'karaoke' and name = 'Karaoke Room';
update public.rooms set tier = 'token_proof', display_order = v.ord, required_collection = v.req
  from (values
    ('Garden', 3, 'UGLY_DUCK_LABS,MAYC,BAYC,ORCA_BUSINESS,TEMP_AGENCY'),
    ('Library', 4, 'UGLY_DUCK_LABS,MAYC,BAYC,ORCA_BUSINESS,TEMP_AGENCY'),
    ('Pool Deck', 5, 'BAYC'),
    ('Conservatory', 6, 'BAYC'),
    ('Helipad', 7, 'BAYC'),
    ('Marina', 8, 'UGLY_DUCK_LABS,MAYC,BAYC,ORCA_BUSINESS,TEMP_AGENCY'),
    ('Cigar Room', 9, 'BAYC'),
    ('Studio A', 10, 'UGLY_DUCK_LABS,MAYC,BAYC,ORCA_BUSINESS,TEMP_AGENCY'),
    ('Studio B', 11, 'UGLY_DUCK_LABS,MAYC,BAYC,ORCA_BUSINESS,TEMP_AGENCY'),
    ('Punks Brunch', 12, 'PUNKS')
  ) as v(name, ord, req)
 where public.rooms.name = v.name and public.rooms.kind = 'conference';
update public.rooms set display_order = 13, coming_soon = true, tier = 'public'
 where kind = 'game' and name = 'Game Room';
update public.rooms set display_order = 200 where name = 'Cellar' and tier = 'lifer';
update public.rooms set kind = 'chapter'
 where kind = 'conference' and livekit_room like 'bayc-chapter-%';

-- ── Lifer grants (super admin only) ────────────────────────────────────────
create table if not exists public.lifer_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid,
  created_at timestamptz not null default now()
);
alter table public.lifer_grants enable row level security;
revoke all on public.lifer_grants from anon, authenticated;
grant select on public.lifer_grants to authenticated;
grant all on public.lifer_grants to service_role;
drop policy if exists "Lifer grants: own row or admins" on public.lifer_grants;
create policy "Lifer grants: own row or admins" on public.lifer_grants for select to authenticated
  using (user_id = (select auth.uid())
         or public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));

create or replace function public.is_lifer(_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.lifer_grants g where g.user_id = _user_id)
      or public.has_role(_user_id, 'admin'::app_role)
      or public.has_role(_user_id, 'super_admin'::app_role);
$function$;

-- Super admin grants / removes Lifer access by user id.
create or replace function public.set_lifer_grant(_uid uuid, _granted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role((select auth.uid()), 'super_admin'::app_role) then
    raise exception 'Only the super admin can change Lifer access.';
  end if;
  if _granted then
    insert into public.lifer_grants (user_id, granted_by) values (_uid, (select auth.uid()))
    on conflict (user_id) do nothing;
  else
    delete from public.lifer_grants where user_id = _uid;
  end if;
  insert into public.audit_logs (event_type, actor_id, target_id)
  values (case when _granted then 'lifer.grant' else 'lifer.revoke' end, (select auth.uid()), _uid);
end $$;
revoke all on function public.set_lifer_grant(uuid, boolean) from public, anon;
grant execute on function public.set_lifer_grant(uuid, boolean) to authenticated;

-- ── Rooms read policy ──────────────────────────────────────────────────────
alter policy "Authenticated users can read rooms (locked preview)" on public.rooms
  using (
    case
      when kind = 'mudwater' then public.mudwater_can_play(id, (select auth.uid()))
      when kind = 'chapter' then
        public.has_role((select auth.uid()), 'admin'::app_role)
        or public.has_role((select auth.uid()), 'super_admin'::app_role)
      else (
        kind = 'karaoke'
        or kind = 'game'
        or tier = 'public'
        or public.has_role((select auth.uid()), 'admin'::app_role)
        or public.has_role((select auth.uid()), 'super_admin'::app_role)
        or (kind = 'stream' and public.can_access_area((select auth.uid()), 'event_stream'))
        or (required_collection = 'PUNKS' and public.can_access_area((select auth.uid()), 'punks_brunch'))
        or (required_collection is not null and required_collection <> 'PUNKS'
            and public.can_access_area((select auth.uid()), 'conference_rooms')
            and public.holds_any_collection((select auth.uid()), required_collection))
        or (tier = 'lifer' and public.is_lifer((select auth.uid())))
        or (kind not in ('stream', 'game') and required_collection is null and tier <> 'lifer'
            and public.can_access_area((select auth.uid()), 'conference_rooms'))
      )
    end
  );

-- ── Menu access data ───────────────────────────────────────────────────────
update public.collection_menu_items set enabled = (collection_label in ('BAYC', 'MAYC'))
 where item_key in ('holders_chat', 'ape_rides');
update public.collection_menu_items set enabled = true
 where item_key = 'conference_rooms' and collection_label in ('ORCA_BUSINESS', 'TEMP_AGENCY', 'UGLY_DUCK_LABS');

notify pgrst, 'reload schema';
