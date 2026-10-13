ALTER TABLE public.karaoke_sessions
  ADD COLUMN IF NOT EXISTS playback_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS position_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performer_heartbeat_at timestamptz;

ALTER TABLE public.karaoke_sessions
  ADD CONSTRAINT karaoke_sessions_playback_status_chk
  CHECK (playback_status IN ('idle','playing','paused','stopped'));

ALTER TABLE public.karaoke_queue
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- Active booking holder for a room right now (or null).
CREATE OR REPLACE FUNCTION public.karaoke_booking_host(_room uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM public.room_bookings
   WHERE room_id = _room AND now() >= starts_at AND now() < ends_at
   ORDER BY starts_at LIMIT 1
$$;

-- Lock (and lazily create) the room's session row.
CREATE OR REPLACE FUNCTION public.karaoke_lock_session(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions;
BEGIN
  INSERT INTO public.karaoke_sessions (room_id) VALUES (_room) ON CONFLICT (room_id) DO NOTHING;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room FOR UPDATE;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_is_moderator(_room uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.karaoke_booking_host(_room) = _uid
      OR public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'super_admin'::public.app_role)
$$;

-- Internal: hand the stage to the next fresh queue member (or booking host).
CREATE OR REPLACE FUNCTION public.karaoke_promote_next(_room uuid, _grace_s integer DEFAULT 45)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nxt uuid; booking uuid;
BEGIN
  booking := public.karaoke_booking_host(_room);
  IF booking IS NOT NULL THEN
    nxt := booking;
  ELSE
    SELECT user_id INTO nxt FROM public.karaoke_queue
     WHERE room_id = _room AND last_seen_at > now() - make_interval(secs => _grace_s)
     ORDER BY joined_at LIMIT 1;
  END IF;
  UPDATE public.karaoke_sessions SET
    performer_user_id = nxt, video_id = NULL, search_query = NULL,
    playback_status = 'idle', position_ms = 0, position_at = now(),
    generation = generation + 1, revision = revision + 1,
    performer_heartbeat_at = CASE WHEN nxt IS NULL THEN NULL ELSE now() END,
    updated_at = now()
  WHERE room_id = _room;
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_join_queue(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO public.karaoke_queue (room_id, user_id) VALUES (_room, auth.uid())
  ON CONFLICT DO NOTHING;
  UPDATE public.karaoke_queue SET last_seen_at = now() WHERE room_id = _room AND user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_leave_queue(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = auth.uid();
  IF s.performer_user_id = auth.uid() AND public.karaoke_booking_host(_room) IS DISTINCT FROM auth.uid() THEN
    PERFORM public.karaoke_promote_next(_room);
  END IF;
END $$;

-- Heartbeat: keeps queue row and performer lease fresh; also recovers an expired performer.
CREATE OR REPLACE FUNCTION public.karaoke_heartbeat(_room uuid, _grace_s integer DEFAULT 45)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; booking uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.karaoke_queue SET last_seen_at = now() WHERE room_id = _room AND user_id = auth.uid();
  s := public.karaoke_lock_session(_room);
  booking := public.karaoke_booking_host(_room);
  IF s.performer_user_id = auth.uid() THEN
    UPDATE public.karaoke_sessions SET performer_heartbeat_at = now() WHERE room_id = _room;
  ELSIF booking IS NOT NULL AND s.performer_user_id IS DISTINCT FROM booking THEN
    PERFORM public.karaoke_promote_next(_room, _grace_s);
  ELSIF booking IS NULL AND (
        s.performer_user_id IS NULL
     OR s.performer_heartbeat_at IS NULL
     OR s.performer_heartbeat_at < now() - make_interval(secs => _grace_s)
     OR s.performer_user_id = (SELECT user_id FROM public.room_bookings WHERE room_id = _room AND ends_at <= now() AND ends_at > now() - interval '1 minute' LIMIT 1)
  ) THEN
    IF s.performer_user_id IS NOT NULL THEN
      DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = s.performer_user_id;
    END IF;
    IF s.performer_user_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.karaoke_queue WHERE room_id = _room AND last_seen_at > now() - make_interval(secs => _grace_s)) THEN
      PERFORM public.karaoke_promote_next(_room, _grace_s);
    END IF;
  END IF;
  -- Drop queue rows whose owners stopped heart-beating.
  DELETE FROM public.karaoke_queue WHERE room_id = _room AND last_seen_at < now() - make_interval(secs => _grace_s * 2);
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- Claim a vacant stage (open mic only).
CREATE OR REPLACE FUNCTION public.karaoke_claim_stage(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF public.karaoke_booking_host(_room) IS NOT NULL THEN RAISE EXCEPTION 'Room is booked'; END IF;
  IF s.performer_user_id IS NOT NULL AND s.performer_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Someone else is on stage';
  END IF;
  IF s.performer_user_id IS NULL THEN
    UPDATE public.karaoke_sessions SET performer_user_id = auth.uid(), performer_heartbeat_at = now(),
      playback_status = 'idle', position_ms = 0, position_at = now(),
      generation = generation + 1, revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- Song / playback control by the current performer (or moderator). Rejects stale revisions.
CREATE OR REPLACE FUNCTION public.karaoke_control(
  _room uuid, _expected_revision bigint, _action text,
  _video_id text DEFAULT NULL, _search_query text DEFAULT NULL, _position_ms integer DEFAULT NULL)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; pos integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF s.performer_user_id IS DISTINCT FROM auth.uid() AND NOT public.karaoke_is_moderator(_room, auth.uid()) THEN
    RAISE EXCEPTION 'Only the singer on stage can control the song';
  END IF;
  IF _expected_revision IS NOT NULL AND _expected_revision <> s.revision THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;
  pos := CASE WHEN s.playback_status = 'playing'
    THEN s.position_ms + (extract(epoch FROM now() - s.position_at) * 1000)::int
    ELSE s.position_ms END;
  IF _action = 'song' THEN
    UPDATE public.karaoke_sessions SET video_id = _video_id, search_query = _search_query,
      playback_status = CASE WHEN _video_id IS NULL THEN 'idle' ELSE 'playing' END,
      position_ms = 0, position_at = now() WHERE room_id = _room;
  ELSIF _action = 'play' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'playing',
      position_ms = COALESCE(_position_ms, pos), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'pause' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'paused',
      position_ms = COALESCE(_position_ms, pos), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'seek' THEN
    UPDATE public.karaoke_sessions SET position_ms = GREATEST(0, COALESCE(_position_ms, 0)), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'stop' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'stopped', position_ms = 0, position_at = now() WHERE room_id = _room;
  ELSE
    RAISE EXCEPTION 'Unknown action %', _action;
  END IF;
  UPDATE public.karaoke_sessions SET revision = revision + 1, updated_at = now(),
    performer_heartbeat_at = CASE WHEN performer_user_id = auth.uid() THEN now() ELSE performer_heartbeat_at END
  WHERE room_id = _room;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- End the current turn: performer ends own song, or moderator force-skips.
CREATE OR REPLACE FUNCTION public.karaoke_end_turn(_room uuid, _expected_generation integer DEFAULT NULL)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; booking uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF _expected_generation IS NOT NULL AND _expected_generation <> s.generation THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;
  IF s.performer_user_id IS DISTINCT FROM auth.uid() AND NOT public.karaoke_is_moderator(_room, auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to end this turn';
  END IF;
  booking := public.karaoke_booking_host(_room);
  IF booking IS NOT NULL AND s.performer_user_id = booking THEN
    -- Booked performer keeps the stage; just stop the song.
    UPDATE public.karaoke_sessions SET video_id = NULL, search_query = NULL, playback_status = 'idle',
      position_ms = 0, position_at = now(), revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
  ELSE
    IF s.performer_user_id IS NOT NULL THEN
      DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = s.performer_user_id;
    END IF;
    PERFORM public.karaoke_promote_next(_room);
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

REVOKE ALL ON FUNCTION public.karaoke_lock_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_promote_next(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_booking_host(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_is_moderator(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_join_queue(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_leave_queue(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_heartbeat(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_claim_stage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_control(uuid, bigint, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.karaoke_end_turn(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.karaoke_booking_host(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_is_moderator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_join_queue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_leave_queue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_heartbeat(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_claim_stage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_control(uuid, bigint, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.karaoke_end_turn(uuid, integer) TO authenticated;