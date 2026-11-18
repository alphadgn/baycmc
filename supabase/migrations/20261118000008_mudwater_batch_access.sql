-- Health report N-35: listRooms called mudwater_can_play once per room. One call for all rooms.
create or replace function public.mudwater_can_play_rooms(_uid uuid, _rooms uuid[])
returns table (room_id uuid, can_play boolean)
language sql stable security definer set search_path = public as $$
  select r, public.mudwater_can_play(r, _uid) from unnest(_rooms) as r;
$$;
revoke all on function public.mudwater_can_play_rooms(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mudwater_can_play_rooms(uuid, uuid[]) to service_role;
