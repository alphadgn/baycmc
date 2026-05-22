
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_kind_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_kind_check
  CHECK (kind IN ('conference', 'game', 'karaoke'));

UPDATE public.rooms SET display_order = 12 WHERE theme = 'game-room';

INSERT INTO public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, is_locked, kind, active)
VALUES (
  'Karaoke Room',
  'Public karaoke lounge — grab the mic, queue your track, and perform.',
  20,
  'token_proof',
  'karaoke-room',
  'karaoke',
  11,
  false,
  'karaoke',
  true
);
