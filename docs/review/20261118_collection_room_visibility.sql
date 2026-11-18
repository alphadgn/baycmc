-- REVIEW ONLY. Do not apply to the shared database without approval.
-- Same collection must unlock the menu AND appear in the room's allowed list.
create or replace function public.collection_room_access(_uid uuid, _labels text, _area text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_staff(_uid) or exists (
    select 1 from public.collection_menu_items m
    where m.item_key = _area and m.enabled
      and m.collection_label = any(string_to_array(replace(_labels, ' ', ''), ','))
      and public.holds_any_collection(_uid, m.collection_label)
  ), false);
$$;
revoke all on function public.collection_room_access(uuid,text,text) from public, anon;
grant execute on function public.collection_room_access(uuid,text,text) to authenticated, service_role;

create or replace function public.room_visible(_uid uuid, _room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when _uid is null then false
    when r.kind = 'mudwater' then public.mudwater_can_play(r.id, _uid)
    when r.kind = 'chapter' then public.chapter_room_access(_uid, r.id)
    when r.kind = 'stream' then public.can_access_area(_uid, 'event_stream')
      and (public.stream_viewer_free(_uid) or public.stream_has_ticket(_uid))
    when public.is_staff(_uid) then true
    -- Preserve the existing signed-in public/karaoke/game exceptions.
    when r.kind in ('karaoke', 'game') or r.tier = 'public' then true
    when r.tier = 'lifer' then public.is_lifer(_uid)
    when r.required_collection is not null then public.collection_room_access(_uid,
      r.required_collection, case when r.required_collection = 'PUNKS'
        then 'punks_brunch' else 'conference_rooms' end)
    else public.can_access_area(_uid, 'conference_rooms')
  end from public.rooms r where r.id = _room), false);
$$;
revoke all on function public.room_visible(uuid,uuid) from public, anon;
grant execute on function public.room_visible(uuid,uuid) to authenticated, service_role;
-- Existing rooms SELECT and room-chat RLS already call room_visible.
notify pgrst, 'reload schema';