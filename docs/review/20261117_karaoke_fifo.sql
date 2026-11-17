-- REVIEW ONLY: apply after approval, not registered or applied to shared database.
-- Keep existing reservation/booking, consent, lease and end-turn functions.
BEGIN;
CREATE OR REPLACE FUNCTION public.karaoke_promote_next(_room uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ent record; nxt uuid; src text := 'open'; res uuid := NULL; st public.karaoke_room_settings;
BEGIN
  -- Reentrant row lock: end-turn/heartbeat already own it; direct calls are serialized too.
  PERFORM public.karaoke_lock_session(_room);
  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);
  IF ent.performer IS NOT NULL THEN
    nxt := ent.performer; src := ent.source; res := ent.reservation;
  ELSE
    st := public.karaoke_settings(_room);
    SELECT q.user_id INTO nxt FROM public.karaoke_queue q
     WHERE q.room_id = _room AND q.last_seen_at > now() - interval '45 seconds'
       AND NOT public.karaoke_is_sanctioned(_room, q.user_id, 'mute')
       AND (NOT st.require_booking OR public.karaoke_is_admin(q.user_id))
     ORDER BY q.joined_at, q.id
     LIMIT 1;
  END IF;
  UPDATE public.karaoke_sessions SET
    performer_user_id = nxt, video_id = NULL, search_query = NULL, backing_track_id = NULL,
    song_title = NULL, song_artist = NULL,
    playback_status = 'idle', position_ms = 0, position_at = now(),
    stage_source = src, reservation_id = res,
    generation = generation + 1, revision = revision + 1,
    performer_heartbeat_at = CASE WHEN nxt IS NULL THEN NULL ELSE now() END,
    updated_at = now()
  WHERE room_id = _room;
  -- The promoted singer leaves the waiting line.
  IF nxt IS NOT NULL THEN
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = nxt;
  END IF;
  RETURN nxt;
END $$;


CREATE OR REPLACE FUNCTION public.karaoke_claim_stage(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; uid uuid := auth.uid(); ent record; st public.karaoke_room_settings;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') THEN RAISE EXCEPTION 'You are muted in this room'; END IF;
  s := public.karaoke_lock_session(_room);
  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);
  IF ent.performer IS NOT NULL AND ent.performer <> uid THEN RAISE EXCEPTION 'The stage is reserved right now'; END IF;
  st := public.karaoke_settings(_room);
  IF ent.performer IS NULL AND st.require_booking AND NOT public.karaoke_is_admin(uid) THEN
    RAISE EXCEPTION 'This room is booking-only. Reserve a slot to sing.';
  END IF;
  IF s.performer_user_id IS NOT NULL AND s.performer_user_id <> uid THEN
    RAISE EXCEPTION 'Someone else is on stage';
  END IF;
  IF s.performer_user_id IS NULL AND ent.performer IS NULL AND EXISTS (
    SELECT 1 FROM public.karaoke_queue q WHERE q.room_id=_room
      AND q.last_seen_at > now()-interval '45 seconds'
      AND NOT public.karaoke_is_sanctioned(_room,q.user_id,'mute')) THEN
    PERFORM public.karaoke_promote_next(_room);
    SELECT * INTO s FROM public.karaoke_sessions WHERE room_id=_room;
    IF s.performer_user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Wait for your turn in the signup line'; END IF;
  END IF;
  IF s.performer_user_id IS NULL THEN
    UPDATE public.karaoke_sessions SET performer_user_id = uid, performer_heartbeat_at = now(),
      playback_status = 'idle', position_ms = 0, position_at = now(), stage_source = 'open', reservation_id = NULL,
      generation = generation + 1, revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = uid;
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;


COMMIT;
