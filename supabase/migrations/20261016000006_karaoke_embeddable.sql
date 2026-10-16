-- Karaoke: remember which YouTube videos can be played outside YouTube.
-- Checked server-side (YouTube oEmbed) and reported by players that hit
-- "embedding disabled" (errors 101/150). Non-embeddable videos are never
-- offered in search or the catalogue again.
create table if not exists public.karaoke_video_status (
  youtube_id text primary key check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  embeddable boolean not null,
  reason text,
  checked_at timestamptz not null default now()
);
alter table public.karaoke_video_status enable row level security;
revoke all on public.karaoke_video_status from anon, authenticated;
grant all on public.karaoke_video_status to service_role;
