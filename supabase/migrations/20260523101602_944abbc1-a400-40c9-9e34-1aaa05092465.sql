create extension if not exists pg_trgm;

create table public.karaoke_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  normalized_title text not null,
  source text not null default 'karafun-top-1000',
  playable_url text,
  youtube_id text,
  rank integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_title, artist)
);

create index karaoke_songs_norm_trgm on public.karaoke_songs using gin (normalized_title gin_trgm_ops);
create index karaoke_songs_artist_trgm on public.karaoke_songs using gin (artist gin_trgm_ops);

alter table public.karaoke_songs enable row level security;

create policy "karaoke_songs readable by authenticated"
  on public.karaoke_songs for select to authenticated using (true);

create policy "karaoke_songs admin insert"
  on public.karaoke_songs for insert to authenticated
  with check (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'super_admin'::app_role));

create policy "karaoke_songs admin update"
  on public.karaoke_songs for update to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'super_admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'super_admin'::app_role));

create policy "karaoke_songs admin delete"
  on public.karaoke_songs for delete to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'super_admin'::app_role));

create trigger karaoke_songs_updated_at
  before update on public.karaoke_songs
  for each row execute function public.set_updated_at();

create table public.karaoke_search_cache (
  id uuid primary key default gen_random_uuid(),
  query text not null unique,
  results jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.karaoke_search_cache enable row level security;

create policy "karaoke_search_cache read auth"
  on public.karaoke_search_cache for select to authenticated using (true);
create policy "karaoke_search_cache insert auth"
  on public.karaoke_search_cache for insert to authenticated with check (true);
create policy "karaoke_search_cache update auth"
  on public.karaoke_search_cache for update to authenticated using (true) with check (true);