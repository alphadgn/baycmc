-- Retire the standalone "Commons" thread. The lobby now hosts the single
-- all-members chat, so we migrate any existing rows from the old `messages`
-- table into `lobby_messages` and drop the source table.
--
-- `lobby_messages` has richer columns (image_url, gif_url, reply_to_id);
-- those stay null for migrated rows. created_at is preserved so the timeline
-- reads chronologically.

INSERT INTO public.lobby_messages (user_id, body, created_at)
SELECT user_id, body, created_at
FROM public.messages;

DROP TABLE IF EXISTS public.messages CASCADE;
