-- Least-privilege reads: replace the remaining "any signed-in member"
-- rules with real conditions (Lovable scan: "access rules let everyone
-- through").

-- Admin-only config tables.
alter policy "Members read menu matrix" on public.collection_menu_items
  using (public.has_role((select auth.uid()), 'super_admin'::app_role));
alter policy "Members read stream hosts" on public.event_stream_hosts
  using (public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));

-- Karaoke room state: members who are not banned from that room.
alter policy "karaoke_presence read" on public.karaoke_presence
  using ((select auth.uid()) is not null
         and not public.karaoke_is_sanctioned(room_id, (select auth.uid()), 'ban'));
alter policy "karaoke_queue read for authenticated" on public.karaoke_queue
  using ((select auth.uid()) is not null
         and not public.karaoke_is_sanctioned(room_id, (select auth.uid()), 'ban'));
alter policy "karaoke_reservations read" on public.karaoke_reservations
  using ((select auth.uid()) is not null
         and not public.karaoke_is_sanctioned(room_id, (select auth.uid()), 'ban'));
alter policy "karaoke_room_settings read" on public.karaoke_room_settings
  using ((select auth.uid()) is not null
         and not public.karaoke_is_sanctioned(room_id, (select auth.uid()), 'ban'));
alter policy "karaoke_sessions read for authenticated" on public.karaoke_sessions
  using ((select auth.uid()) is not null
         and not public.karaoke_is_sanctioned(room_id, (select auth.uid()), 'ban'));

-- Rooms: only the rooms this member can actually enter (karaoke/public for
-- everyone; conference / stream / punks / lifer by access; staff all).
alter policy "Authenticated users can read rooms (locked preview)" on public.rooms
  using (
    kind = 'karaoke'
    or tier = 'public'
    or public.has_role((select auth.uid()), 'admin'::app_role)
    or public.has_role((select auth.uid()), 'super_admin'::app_role)
    or (kind = 'stream' and public.can_access_area((select auth.uid()), 'event_stream'))
    or (required_collection is not null and public.can_access_area((select auth.uid()), 'punks_brunch'))
    or (tier = 'lifer' and public.is_lifer((select auth.uid())))
    or (kind <> 'stream' and required_collection is null
        and public.can_access_area((select auth.uid()), 'conference_rooms'))
  );
