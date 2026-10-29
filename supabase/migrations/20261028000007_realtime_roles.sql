-- Role and verification changes reach the member's open app immediately
-- (e.g. the karaoke Admin tab appears the moment someone is promoted and
-- disappears when they're demoted). The app already listens for these;
-- the tables just weren't published to realtime. Row-level security still
-- limits each member to their own rows.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'user_roles') then
    alter publication supabase_realtime add table public.user_roles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'user_verifications') then
    alter publication supabase_realtime add table public.user_verifications;
  end if;
end $$;
