-- Profile avatars storage bucket.
--
-- Files are stored at `<user-id>/<filename>` so per-user RLS is a simple
-- prefix check. Bucket is public-read so we can render <img src> directly
-- without a signed URL roundtrip on every render; writes are restricted to
-- the owning user.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  2 * 1024 * 1024,  -- 2 MB cap (we resize client-side before upload too)
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read — anyone can see avatars (they're shown in feeds, lobby,
-- chat threads, etc.).
DROP POLICY IF EXISTS "Public read on avatars" ON storage.objects;
CREATE POLICY "Public read on avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Owner-only writes: the first folder segment of `name` MUST equal the
-- authenticated user's id.
DROP POLICY IF EXISTS "Users insert their own avatar" ON storage.objects;
CREATE POLICY "Users insert their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users update their own avatar" ON storage.objects;
CREATE POLICY "Users update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users delete their own avatar" ON storage.objects;
CREATE POLICY "Users delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
