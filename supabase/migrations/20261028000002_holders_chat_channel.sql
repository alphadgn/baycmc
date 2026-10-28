-- Holders Chat becomes a live chat room like the Public Lobby (channel
-- 'holders' in lobby_messages). Access follows the Holders Chat menu area
-- (Super Admin → Menu access; BAYC and MAYC, plus admins and the verified
-- role). The old feed posts are copied over once, oldest first.

alter table public.lobby_messages drop constraint if exists lobby_messages_channel_check;
alter table public.lobby_messages add constraint lobby_messages_channel_check
  check (channel = any (array['lobby', 'punks-brunch', 'holders']));

create or replace function public.can_access_chat_channel(_channel text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select case _channel
    when 'lobby' then auth.uid() is not null
    when 'punks-brunch' then public.can_access_area(auth.uid(), 'punks_brunch')
    when 'holders' then public.can_access_area(auth.uid(), 'holders_chat')
    else false end;
$function$;

insert into public.lobby_messages (id, user_id, body, image_url, created_at, updated_at, channel)
select p.id, p.user_id, p.body, p.image_url, p.created_at, coalesce(p.updated_at, p.created_at), 'holders'
  from public.posts p
 where not exists (select 1 from public.lobby_messages m where m.id = p.id);
