-- Karaoke rules: while someone is on stage, ONLY that performer controls the
-- music player (song / play / pause / seek / stop). Moderators can still end
-- the turn (karaoke_end_turn) to remove a performer, but can't drive the
-- player mid-performance. With nobody on stage, moderators keep control.
DO $mig$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'karaoke_control';
  IF def IS NULL THEN RAISE EXCEPTION 'karaoke_control not found'; END IF;
  def := replace(def,
    'IF s.performer_user_id IS DISTINCT FROM uid AND NOT public.karaoke_is_moderator(_room, uid) THEN',
    'IF (s.performer_user_id IS NOT NULL AND s.performer_user_id <> uid)
     OR (s.performer_user_id IS NULL AND NOT public.karaoke_is_moderator(_room, uid)) THEN');
  IF position('s.performer_user_id IS NOT NULL AND s.performer_user_id <> uid' IN def) = 0 THEN
    RAISE EXCEPTION 'karaoke_control guard not patched';
  END IF;
  EXECUTE def;
END
$mig$;
