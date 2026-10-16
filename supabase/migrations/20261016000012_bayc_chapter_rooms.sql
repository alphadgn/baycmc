-- Club BAYC chapter rooms: 20 conference rooms open only to verified
-- BAYC or MAYC holders. `required_collection` now accepts a comma-separated
-- list of collection labels ("BAYC,MAYC" = holders of either).

create or replace function public.holds_any_collection(_uid uuid, _labels text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_verifications v
     where v.user_id = _uid
       and coalesce(v.verified_collections, '{}'::text[])
           && string_to_array(replace(_labels, ' ', ''), ',')
  );
$$;
revoke all on function public.holds_any_collection(uuid, text) from public, anon;
grant execute on function public.holds_any_collection(uuid, text) to authenticated;

-- Rooms list: collection rooms show only to that collection's holders.
alter policy "Authenticated users can read rooms (locked preview)" on public.rooms
  using (
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
  );

insert into public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, kind, required_collection)
select 'BAYC Chapter ' || n,
       'Club BAYC chapter room — verified BAYC & MAYC holders only.',
       24, 'token_proof', 'bayc-chapter-' || n,
       (array['conservatory','garden','cigar','helipad','cellar','library','marina','pool-deck','studio-a','studio-b'])[((n - 1) % 10) + 1],
       100 + n, 'conference', 'BAYC,MAYC'
  from generate_series(1, 20) as n
 where not exists (select 1 from public.rooms r where r.livekit_room = 'bayc-chapter-' || n);
