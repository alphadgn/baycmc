-- Health report N-16: a direct REST insert into karaoke_recordings only checked performer_id,
-- skipping the performance waiver and the storage-path check done by saveKaraokeRecording,
-- and the update policy let a performer repoint storage_path at someone else's file
-- (which the server would then sign). The waiver check is the same rule used for
-- joining the line and taking the stage (karaoke_waiver_ok; account-sign-in scoped
-- by migration 20261120000001). Visibility is chosen by the singer (Private or Public).

drop policy if exists "Performers can insert their own recordings" on public.karaoke_recordings;
create policy "Performers can insert their own recordings" on public.karaoke_recordings
  for insert to authenticated
  with check (
    performer_id = (select auth.uid())
    and storage_path like (select auth.uid())::text || '/' || room_id::text || '/%'
    and storage_path not like '%..%'
    -- One waiver rule everywhere: valid for the current account sign-in and version.
    and public.karaoke_waiver_ok((select auth.uid()))
  );

-- Members may only change presentation fields; paths and ownership are server-written.
revoke update on public.karaoke_recordings from anon, authenticated;
grant update (visibility, song_title, song_artist, updated_at) on public.karaoke_recordings to authenticated;
grant all on public.karaoke_recordings to service_role;
