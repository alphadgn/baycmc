-- Karaoke $APE tips.
--
-- Tips are native APE transfers on ApeChain (chain 33139) sent straight from
-- the tipper's wallet to the performer's wallet — the app never holds funds.
-- A row is written ONLY by the server after it has verified the transaction
-- on-chain (success, correct recipient, value > 0, not already recorded), so
-- clients have no INSERT/UPDATE/DELETE rights on this table.

create table if not exists public.karaoke_tips (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  tipper_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  chain_id integer not null default 33139,
  tx_hash text not null,
  from_address text not null,
  to_address text not null,
  amount_wei numeric(78, 0) not null check (amount_wei > 0),
  session_generation integer,
  created_at timestamptz not null default now(),
  constraint karaoke_tips_tx_unique unique (chain_id, tx_hash),
  constraint karaoke_tips_not_self check (tipper_id <> recipient_id)
);

create index if not exists karaoke_tips_recipient_idx on public.karaoke_tips (recipient_id, created_at desc);
create index if not exists karaoke_tips_room_idx on public.karaoke_tips (room_id, created_at desc);

alter table public.karaoke_tips enable row level security;

-- Tipper and recipient can see their own tips. No client writes.
drop policy if exists "karaoke_tips_select_own" on public.karaoke_tips;
create policy "karaoke_tips_select_own" on public.karaoke_tips
  for select to authenticated
  using (tipper_id = auth.uid() or recipient_id = auth.uid());

revoke insert, update, delete on public.karaoke_tips from anon, authenticated;
grant select on public.karaoke_tips to authenticated;

-- Live "you got tipped" notifications for the performer.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'karaoke_tips'
  ) then
    execute 'alter publication supabase_realtime add table public.karaoke_tips';
  end if;
end $$;
