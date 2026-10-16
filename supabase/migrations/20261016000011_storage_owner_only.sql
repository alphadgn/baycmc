-- Storage files are tied to their owner (Lovable scan: "file storage rules
-- don't tie files to their owner"). Shared recordings / shared backing
-- tracks are now delivered as short-lived links signed by the server after
-- it checks the caller may see that row.
drop policy if exists "Karaoke recordings: owner, staff or shared" on storage.objects;
create policy "Karaoke recordings: owner or staff" on storage.objects
  for select to authenticated using (
    bucket_id = 'karaoke-recordings' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
    )
  );
drop policy if exists "Backing tracks: owner or shared read" on storage.objects;
create policy "Backing tracks: owner or staff read" on storage.objects
  for select to authenticated using (
    bucket_id = 'karaoke-backing-tracks' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'admin'::app_role)
      or public.has_role((select auth.uid()), 'super_admin'::app_role)
    )
  );
