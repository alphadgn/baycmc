-- 1) SECURITY: members could self-assign wallets / verified links.
--
-- `authenticated` had INSERT/UPDATE on every column of public.profiles,
-- including wallet_address + linked_wallets, and on public.linked_wallets
-- including verified_at. The ownership engine trusts those columns, so any
-- member could claim a whale's wallet from the browser and unlock holder
-- rooms without a signature. Wallet columns are now server-written only.

revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, username, bio, avatar_url) on public.profiles to authenticated;
grant update (id, username, bio, avatar_url, updated_at) on public.profiles to authenticated;

revoke insert, update, truncate, references, trigger on public.linked_wallets from anon, authenticated;
-- members keep SELECT (own rows, by RLS) and DELETE (unlink own wallet).
drop policy if exists "Users insert own linked wallets" on public.linked_wallets;
drop policy if exists "Users update own linked wallets" on public.linked_wallets;

-- 2) Every verified collection, not just the first one found.
alter table public.user_verifications
  add column if not exists verified_collections text[] not null default '{}';

update public.user_verifications
   set verified_collections = array[bayc_collection]
 where bayc_verified and bayc_collection is not null
   and cardinality(verified_collections) = 0;

create or replace function public.holds_collection(_uid uuid, _label text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.user_verifications v
       where v.user_id = _uid and v.bayc_verified and _label = any (v.verified_collections)
    )
    or public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role),
    false);
$$;
revoke all on function public.holds_collection(uuid, text) from public, anon;
grant execute on function public.holds_collection(uuid, text) to authenticated;

-- 3) Punks Brunch: a CryptoPunks-holders channel on the lobby chat tables.
alter table public.lobby_messages
  add column if not exists channel text not null default 'lobby';
do $$ begin
  alter table public.lobby_messages
    add constraint lobby_messages_channel_check check (channel in ('lobby', 'punks-brunch'));
exception when duplicate_object then null; end $$;
create index if not exists lobby_messages_channel_created_idx
  on public.lobby_messages (channel, created_at desc);

create or replace function public.can_access_chat_channel(_channel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case _channel
    when 'lobby' then auth.uid() is not null
    when 'punks-brunch' then public.holds_collection(auth.uid(), 'PUNKS')
    else false
  end;
$$;
revoke all on function public.can_access_chat_channel(text) from public, anon;
grant execute on function public.can_access_chat_channel(text) to authenticated;

drop policy if exists "Anyone signed in can read lobby" on public.lobby_messages;
drop policy if exists "Anyone signed in can post to lobby" on public.lobby_messages;
drop policy if exists "Authors can edit own lobby message" on public.lobby_messages;
drop policy if exists "Channel members can read messages" on public.lobby_messages;
drop policy if exists "Channel members can post messages" on public.lobby_messages;
drop policy if exists "Authors can edit own message in channel" on public.lobby_messages;

create policy "Channel members can read messages" on public.lobby_messages
  for select to authenticated
  using (public.can_access_chat_channel(channel));
create policy "Channel members can post messages" on public.lobby_messages
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_chat_channel(channel));
create policy "Authors can edit own message in channel" on public.lobby_messages
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.can_access_chat_channel(channel));

drop policy if exists "Anyone signed in can read reactions" on public.lobby_message_reactions;
drop policy if exists "Users can react" on public.lobby_message_reactions;
drop policy if exists "Channel members can read reactions" on public.lobby_message_reactions;
drop policy if exists "Channel members can react" on public.lobby_message_reactions;

create policy "Channel members can read reactions" on public.lobby_message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.lobby_messages m
     where m.id = message_id and public.can_access_chat_channel(m.channel)));
create policy "Channel members can react" on public.lobby_message_reactions
  for insert to authenticated
  with check (auth.uid() = user_id and exists (
    select 1 from public.lobby_messages m
     where m.id = message_id and public.can_access_chat_channel(m.channel)));
