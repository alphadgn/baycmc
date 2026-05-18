-- =========================================================
-- Conference room themes, host-only controls, and Game Room
-- =========================================================
-- Adds:
--   * theme         : background-image key (maps to /public/*.png)
--   * display_order : grid ordering
--   * is_locked     : host-toggled lock that blocks new joins
--   * kind          : 'conference' | 'game' (drives per-room UI)
--
-- Also renames Studio 1/2 → Studio A/B, sets themes for the 11 themed
-- rooms, and seeds the new Game Room.

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS theme TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS display_order INT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'conference'
    CHECK (kind IN ('conference','game'));

-- Themed rooms (existing rows seeded by 20260501100131_*)
UPDATE public.rooms SET theme='conservatory', display_order=1  WHERE name='Conservatory';
UPDATE public.rooms SET theme='garden',       display_order=2  WHERE name='Garden';
UPDATE public.rooms SET theme='cigar',        display_order=3  WHERE name='Cigar Room';
UPDATE public.rooms SET theme='helipad',      display_order=4  WHERE name='Helipad';
UPDATE public.rooms SET theme='cellar',       display_order=5  WHERE name='Cellar';
UPDATE public.rooms SET theme='library',      display_order=6  WHERE name='Library';
UPDATE public.rooms SET theme='marina',       display_order=7  WHERE name='Marina';
UPDATE public.rooms SET theme='pool-deck',    display_order=8  WHERE name='Pool Deck';

-- Rename Studio 1 / Studio 2 → Studio A / Studio B and theme them.
UPDATE public.rooms
   SET name='Studio A', theme='studio-a', display_order=9
 WHERE name='Studio 1';
UPDATE public.rooms
   SET name='Studio B', theme='studio-b', display_order=10
 WHERE name='Studio 2';

-- Game Room. Real-time PvP via LiveKit data channel; background art TBD.
INSERT INTO public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, kind)
VALUES ('Game Room', 'Real-time PvP gaming with another verified member.', 8, 'token_proof', 'baycmc-room-game', 'game-room', 11, 'game')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    capacity    = EXCLUDED.capacity,
    tier        = EXCLUDED.tier,
    livekit_room= EXCLUDED.livekit_room,
    theme       = EXCLUDED.theme,
    display_order = EXCLUDED.display_order,
    kind        = EXCLUDED.kind;

-- =========================================================
-- Host check: booking owner during their slot, or an admin.
-- Used by server fns to gate kick / mute / lock actions.
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_room_host(_room_id uuid, _user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.room_bookings b
     WHERE b.room_id = _room_id
       AND b.user_id = _user_id
       AND now() BETWEEN b.starts_at AND b.ends_at
  )
  OR public.has_role(_user_id, 'admin'::public.app_role)
  OR public.has_role(_user_id, 'super_admin'::public.app_role);
$$;

GRANT EXECUTE ON FUNCTION public.is_room_host(uuid, uuid) TO authenticated;
