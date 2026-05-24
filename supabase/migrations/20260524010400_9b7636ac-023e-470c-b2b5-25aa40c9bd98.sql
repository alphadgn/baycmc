
-- 1. Storage bucket for karaoke recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('karaoke-recordings', 'karaoke-recordings', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Karaoke recordings are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'karaoke-recordings');

-- Authenticated users upload into their own folder (path: <user_id>/<file>)
CREATE POLICY "Users can upload their own karaoke recordings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'karaoke-recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own karaoke recordings"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'karaoke-recordings'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Users or admins can delete their own karaoke recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'karaoke-recordings'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- 2. Recordings metadata table
CREATE TABLE public.karaoke_recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL,
  performer_id UUID NOT NULL,
  song_title TEXT,
  song_artist TEXT,
  youtube_id TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  duration_ms INTEGER,
  mime_type TEXT NOT NULL DEFAULT 'audio/webm',
  has_instrumental BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_karaoke_recordings_performer ON public.karaoke_recordings(performer_id, created_at DESC);
CREATE INDEX idx_karaoke_recordings_room ON public.karaoke_recordings(room_id, created_at DESC);

ALTER TABLE public.karaoke_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recordings"
ON public.karaoke_recordings FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Performers can insert their own recordings"
ON public.karaoke_recordings FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = performer_id);

CREATE POLICY "Performers or admins can update recordings"
ON public.karaoke_recordings FOR UPDATE
TO authenticated
USING (
  auth.uid() = performer_id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  auth.uid() = performer_id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Performers or admins can delete recordings"
ON public.karaoke_recordings FOR DELETE
TO authenticated
USING (
  auth.uid() = performer_id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE TRIGGER update_karaoke_recordings_updated_at
BEFORE UPDATE ON public.karaoke_recordings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Open karaoke rooms to all signed-in users (lobby tier).
--    Replace the existing booking INSERT policy so karaoke-kind rooms
--    are bookable by anyone signed in, while other kinds keep their
--    holder/Lifer gate.
DROP POLICY IF EXISTS "Verified users can create their own bookings" ON public.room_bookings;

CREATE POLICY "Users can create their own bookings"
ON public.room_bookings FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = room_bookings.room_id
      AND (
        r.kind = 'karaoke'
        OR (r.tier = 'token_proof' AND is_token_proof_verified(auth.uid()))
        OR (r.tier = 'lifer' AND is_lifer(auth.uid()))
      )
  )
);

-- And let everyone signed in see karaoke bookings (other kinds still gated).
DROP POLICY IF EXISTS "Verified users can view bookings of accessible rooms" ON public.room_bookings;

CREATE POLICY "Users can view bookings of accessible rooms"
ON public.room_bookings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = room_bookings.room_id
      AND (
        r.kind = 'karaoke'
        OR (r.tier = 'token_proof' AND is_token_proof_verified(auth.uid()))
        OR (r.tier = 'lifer' AND is_lifer(auth.uid()))
      )
  )
);
