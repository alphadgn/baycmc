-- Discord-style lobby chat: open to every signed-in user (Tier 1).
--
-- Schema goals:
--  • One thread visible to anyone with an active session
--  • Image attachments via the new `chat-attachments` bucket
--  • Inline GIFs via Tenor (we just store the URL; no provider lock-in)
--  • Replies (reply_to_id self-reference)
--  • Emoji reactions (separate table, one row per (msg, user, emoji))
--
-- RLS keeps it simple: `authenticated` for read AND write. Lobby content
-- is intentionally less guarded than the verified `messages` thread —
-- only the verification-gated `/messages`, `/feed`, `/rooms`, etc. require
-- the token-proof check.

CREATE TABLE IF NOT EXISTS public.lobby_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 2000),
  image_url text,
  gif_url text,
  reply_to_id uuid REFERENCES public.lobby_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lobby_messages_has_content CHECK (
    body IS NOT NULL OR image_url IS NOT NULL OR gif_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS lobby_messages_created_at_idx
  ON public.lobby_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS lobby_messages_reply_idx
  ON public.lobby_messages (reply_to_id);

ALTER TABLE public.lobby_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read lobby" ON public.lobby_messages;
CREATE POLICY "Anyone signed in can read lobby"
  ON public.lobby_messages FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anyone signed in can post to lobby" ON public.lobby_messages;
CREATE POLICY "Anyone signed in can post to lobby"
  ON public.lobby_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authors can edit own lobby message" ON public.lobby_messages;
CREATE POLICY "Authors can edit own lobby message"
  ON public.lobby_messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authors can delete own lobby message" ON public.lobby_messages;
CREATE POLICY "Authors can delete own lobby message"
  ON public.lobby_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS lobby_messages_set_updated_at ON public.lobby_messages;
CREATE TRIGGER lobby_messages_set_updated_at
  BEFORE UPDATE ON public.lobby_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reactions
CREATE TABLE IF NOT EXISTS public.lobby_message_reactions (
  message_id uuid NOT NULL REFERENCES public.lobby_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

ALTER TABLE public.lobby_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read reactions" ON public.lobby_message_reactions;
CREATE POLICY "Anyone signed in can read reactions"
  ON public.lobby_message_reactions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can react" ON public.lobby_message_reactions;
CREATE POLICY "Users can react"
  ON public.lobby_message_reactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their own reaction" ON public.lobby_message_reactions;
CREATE POLICY "Users can remove their own reaction"
  ON public.lobby_message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Storage bucket for chat image attachments. Path layout:
--   chat-attachments/<user-id>/<timestamp>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  TRUE,
  5 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read on chat attachments" ON storage.objects;
CREATE POLICY "Public read on chat attachments"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "Users upload their own chat attachment" ON storage.objects;
CREATE POLICY "Users upload their own chat attachment"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users delete their own chat attachment" ON storage.objects;
CREATE POLICY "Users delete their own chat attachment"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Realtime subscriptions for the new tables.
ALTER PUBLICATION supabase_realtime ADD TABLE public.lobby_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lobby_message_reactions;




