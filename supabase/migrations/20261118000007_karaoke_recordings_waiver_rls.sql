-- Health report N-16: a direct REST insert into karaoke_recordings only checked performer_id,
-- skipping the performance waiver and the storage-path check done by saveKaraokeRecording,
-- and the update policy let a performer repoint storage_path at someone else's file
-- (which the server would then sign). Visibility stays 'public' by default: every
-- performance is public by the owner decision of 2026-10-28.

drop policy if exists "Performers can insert their own recordings" on public.karaoke_recordings;
create policy "Performers can insert their own recordings" on public.karaoke_recordings
  for insert to authenticated
  with check (
    performer_id = (select auth.uid())
    and storage_path like (select auth.uid())::text || '/' || room_id::text || '/%'
    and storage_path not like '%..%'
    -- Waiver accepted within the last 7 days (takes may be saved some time after the
    -- performance, which itself requires a waiver from the last 12 hours).
    and exists (select 1 from public.karaoke_waivers w
                 where w.user_id = (select auth.uid())
                   and w.accepted_at > now() - interval '7 days')
  );

-- Members may only change presentation fields; paths and ownership are server-written.
revoke update on public.karaoke_recordings from anon, authenticated;
grant update (visibility, song_title, song_artist, updated_at) on public.karaoke_recordings to authenticated;
grant all on public.karaoke_recordings to service_role;
