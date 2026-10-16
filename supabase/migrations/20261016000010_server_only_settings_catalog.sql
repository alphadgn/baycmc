-- Applied after the app version that reads these with the service role is live.
-- Settings & admin config: staff only (the server reads with the service role).
alter policy "Settings readable by authenticated" on public.app_settings
  using (public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));
alter policy "Authenticated read otherpage settings" on public.otherpage_settings
  using (public.has_role((select auth.uid()), 'admin'::app_role)
         or public.has_role((select auth.uid()), 'super_admin'::app_role));
-- Song catalogue + search cache: served only through the server (which also
-- filters out videos that can't play outside YouTube).
drop policy if exists "karaoke_songs readable by authenticated" on public.karaoke_songs;
drop policy if exists "karaoke_search_cache read auth" on public.karaoke_search_cache;
revoke select on public.karaoke_songs, public.karaoke_search_cache from authenticated, anon;

