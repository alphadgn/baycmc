-- Support system. The original support migration (20260521000001) never
-- reached the live database, so /support failed with "Could not find the
-- table 'public.support_messages'". This creates it (idempotently) and
-- notifies staff: every member message drops a notification for every
-- admin and super admin; every staff reply notifies the member.

create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = _user_id
       and role in ('admin', 'super_admin')
  );
$$;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_messages enable row level security;

drop policy if exists "Support: read own or admin" on public.support_messages;
create policy "Support: read own or admin"
  on public.support_messages for select to authenticated
  using ((select auth.uid()) = thread_user_id or public.is_admin((select auth.uid())));

drop policy if exists "Support: insert own thread or admin reply" on public.support_messages;
create policy "Support: insert own thread or admin reply"
  on public.support_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (thread_user_id = (select auth.uid()) and is_admin = false)
      or (public.is_admin((select auth.uid())) and is_admin = true)
    )
  );

-- Members edit their own messages but can't flip is_admin (no faked Admin
-- badge) or move a message to another thread; staff can edit any.
drop policy if exists "Support: update own or admin" on public.support_messages;
create policy "Support: update own or admin"
  on public.support_messages for update to authenticated
  using (sender_id = (select auth.uid()) or public.is_admin((select auth.uid())))
  with check (
    public.is_admin((select auth.uid()))
    or (sender_id = (select auth.uid()) and thread_user_id = (select auth.uid()) and is_admin = false)
  );

drop policy if exists "Support: delete own or admin" on public.support_messages;
create policy "Support: delete own or admin"
  on public.support_messages for delete to authenticated
  using (sender_id = (select auth.uid()) or public.is_admin((select auth.uid())));

create index if not exists support_messages_thread_created_idx
  on public.support_messages (thread_user_id, created_at desc);

drop trigger if exists support_messages_set_updated_at on public.support_messages;
create trigger support_messages_set_updated_at
  before update on public.support_messages
  for each row execute function public.set_updated_at();

-- Notify staff / the member.
create or replace function public.support_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if not new.is_admin then
    select coalesce(nullif(username, ''), 'A member') into who
      from public.profiles where id = new.thread_user_id;
    insert into public.notifications (user_id, kind, title, body, url)
    select distinct r.user_id, 'support',
           'New support request from ' || coalesce(who, 'a member'),
           left(new.body, 200),
           '/admin/support?thread=' || new.thread_user_id
      from public.user_roles r
     where r.role in ('admin', 'super_admin')
       and r.user_id <> new.sender_id;
  else
    insert into public.notifications (user_id, kind, title, body, url)
    values (new.thread_user_id, 'support_reply', 'Support replied', left(new.body, 200), '/support');
  end if;
  return new;
end $$;
revoke all on function public.support_message_notify() from public, anon, authenticated;

drop trigger if exists support_messages_notify on public.support_messages;
create trigger support_messages_notify
  after insert on public.support_messages
  for each row execute function public.support_message_notify();

alter table public.support_messages replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;

-- Club BAYC chapter rooms → "Club Room N".
update public.rooms
   set name = 'Club Room ' || substring(livekit_room from 'bayc-chapter-(\d+)$')
 where livekit_room ~ '^bayc-chapter-\d+$';

notify pgrst, 'reload schema';
