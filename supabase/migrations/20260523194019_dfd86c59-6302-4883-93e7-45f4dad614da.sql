
ALTER TABLE public.profiles ALTER COLUMN wallet_address DROP NOT NULL;

ALTER TABLE public.lifer_messages
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS gif_url text;

ALTER TABLE public.lifer_messages DROP CONSTRAINT IF EXISTS lifer_messages_body_check;
ALTER TABLE public.lifer_messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE public.lifer_messages
  ADD CONSTRAINT lifer_messages_has_content_check
  CHECK (
    (body IS NOT NULL AND length(body) BETWEEN 1 AND 2000)
    OR image_url IS NOT NULL
    OR gif_url IS NOT NULL
  );
