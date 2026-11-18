-- Durable, cross-instance rate limiting for server endpoints (health report P0-1, P2-5).
-- Fixed windows keyed by (bucket, subject). Only the service role (server code) may use it.

create table if not exists public.api_rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, subject, window_start)
);
create index if not exists api_rate_limits_window_idx on public.api_rate_limits (window_start);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;
grant all on public.api_rate_limits to service_role;

create or replace function public.consume_rate_limit(
  _bucket text,
  _subject text,
  _limit integer,
  _window_seconds integer
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  ws timestamptz;
  n integer;
begin
  if _limit < 1 or _window_seconds < 1 then
    raise exception 'consume_rate_limit: limit and window must be positive';
  end if;
  ws := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  insert into public.api_rate_limits as l (bucket, subject, window_start, hits)
  values (left(_bucket, 64), left(_subject, 200), ws, 1)
  on conflict (bucket, subject, window_start) do update set hits = l.hits + 1
  returning l.hits into n;
  -- Opportunistic cleanup of stale windows (about 1% of calls).
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '2 days';
  end if;
  return query select n <= _limit, greatest(_limit - n, 0), ws + make_interval(secs => _window_seconds);
end $$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
