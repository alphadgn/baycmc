
-- Karaoke session: one row per room, holds the current performer + track
CREATE TABLE IF NOT EXISTS public.karaoke_sessions (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  performer_user_id uuid,
  video_id text,
  search_query text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.karaoke_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "karaoke_sessions read for authenticated"
  ON public.karaoke_sessions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "karaoke_sessions insert for authenticated"
  ON public.karaoke_sessions FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "karaoke_sessions update for authenticated"
  ON public.karaoke_sessions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Karaoke queue: one row per (room, user) pair waiting in line
CREATE TABLE IF NOT EXISTS public.karaoke_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_karaoke_queue_room_joined
  ON public.karaoke_queue (room_id, joined_at);

ALTER TABLE public.karaoke_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "karaoke_queue read for authenticated"
  ON public.karaoke_queue FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "karaoke_queue insert self"
  ON public.karaoke_queue FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "karaoke_queue delete self or current performer"
  ON public.karaoke_queue FOR DELETE
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.karaoke_sessions s
      WHERE s.room_id = karaoke_queue.room_id
        AND s.performer_user_id = auth.uid()
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.karaoke_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.karaoke_queue;
ALTER TABLE public.karaoke_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.karaoke_queue REPLICA IDENTITY FULL;
