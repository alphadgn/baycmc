-- Event Stream hosts: an assigned host can always open the Event Stream
-- (menu item, route guard, room list and LiveKit gate all go through
-- can_access_area), and is notified to start streaming when assigned.

create or replace function public.can_access_area(_uid uuid, _item text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or public.has_role(_uid, 'verified_user'::app_role)
    or (_item = 'event_stream'
        and exists (select 1 from public.event_stream_hosts h where h.user_id = _uid))
    or exists (
      select 1
        from public.user_verifications v
        join public.collection_menu_items m
          on m.collection_label = any (v.verified_collections)
       where v.user_id = _uid and m.item_key = _item and m.enabled),
    false);
$function$;

create or replace function public.event_stream_host_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, url)
  values (
    new.user_id,
    'stream_host',
    'You''re hosting the Event Stream',
    'You''ve been assigned as a host. Open the Event Stream and tap Start streaming to go live.',
    '/event-stream?golive=1'
  );
  return new;
end $$;
revoke all on function public.event_stream_host_notify() from public, anon, authenticated;

drop trigger if exists event_stream_hosts_notify on public.event_stream_hosts;
create trigger event_stream_hosts_notify
  after insert on public.event_stream_hosts
  for each row execute function public.event_stream_host_notify();
