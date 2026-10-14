-- ════════════════════════════════════════════════════════════════════════════
-- Karaoke v2 — authoritative stage, presence, reservations (booking), room
-- rules, moderation (mute/ban), backing-track uploads, private recordings.
--
-- WHY THIS FILE EXISTS
--   The client (KaraokeStage.tsx) calls karaoke_heartbeat / karaoke_claim_stage
--   / karaoke_control / karaoke_end_turn / karaoke_join_queue /
--   karaoke_leave_queue and reads playback_status / revision / generation.
--   Those objects were only ever defined in drizzle/migrations/0000_*.sql,
--   which Lovable Cloud does NOT apply from supabase/migrations. On any
--   database where that drizzle file never ran, every karaoke action fails
--   with "function does not exist". This migration is fully idempotent and
--   (re)creates everything the client needs, so it is safe whether or not the
--   drizzle file was applied.
--
-- SECURITY FIXES vs. the drizzle version
--   * karaoke_heartbeat no longer trusts a client-supplied grace period
--     (calling it with _grace_s = 0 used to evict the singer and wipe the
--     whole queue).
--   * Direct INSERT/UPDATE/DELETE on karaoke_sessions / karaoke_queue are
--     revoked — the SECURITY DEFINER functions are the only write path.
--   * Muted/banned members cannot queue, claim, or hold the stage.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Session / queue columns ────────────────────────────────────────────
ALTER TABLE public.karaoke_sessions
  ADD COLUMN IF NOT EXISTS playback_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS position_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performer_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_source text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reservation_id uuid,
  ADD COLUMN IF NOT EXISTS backing_track_id uuid,
  ADD COLUMN IF NOT EXISTS song_title text,
  ADD COLUMN IF NOT EXISTS song_artist text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'karaoke_sessions_playback_status_chk') THEN
    ALTER TABLE public.karaoke_sessions ADD CONSTRAINT karaoke_sessions_playback_status_chk
      CHECK (playback_status IN ('idle','playing','paused','stopped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'karaoke_sessions_stage_source_chk') THEN
    ALTER TABLE public.karaoke_sessions ADD CONSTRAINT karaoke_sessions_stage_source_chk
      CHECK (stage_source IN ('open','reservation','booking'));
  END IF;
END $$;

ALTER TABLE public.karaoke_queue
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- ─── 2. New tables ─────────────────────────────────────────────────────────
-- Who is in the room right now (every viewer heart-beats, not just singers).
CREATE TABLE IF NOT EXISTS public.karaoke_presence (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- Per-room rules set by admins.
CREATE TABLE IF NOT EXISTS public.karaoke_room_settings (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  rules text NOT NULL DEFAULT '',
  max_song_seconds integer NOT NULL DEFAULT 420 CHECK (max_song_seconds BETWEEN 0 AND 1800),
  max_slot_minutes integer NOT NULL DEFAULT 15 CHECK (max_slot_minutes BETWEEN 5 AND 60),
  max_future_bookings integer NOT NULL DEFAULT 3 CHECK (max_future_bookings BETWEEN 0 AND 20),
  booking_window_days integer NOT NULL DEFAULT 14 CHECK (booking_window_days BETWEEN 1 AND 90),
  require_booking boolean NOT NULL DEFAULT false,
  holders_priority boolean NOT NULL DEFAULT true,
  allow_youtube boolean NOT NULL DEFAULT true,
  allow_uploads boolean NOT NULL DEFAULT true,
  recording_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mutes and bans. A mute blocks the stage/queue and LiveKit publishing; a ban
-- also blocks room entry. expires_at NULL = until lifted.
CREATE TABLE IF NOT EXISTS public.karaoke_room_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mute','ban')),
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid
);
CREATE INDEX IF NOT EXISTS karaoke_room_sanctions_lookup
  ON public.karaoke_room_sanctions (room_id, user_id, kind) WHERE lifted_at IS NULL;

-- Uploaded instrumentals (backing tracks).
CREATE TABLE IF NOT EXISTS public.karaoke_backing_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  artist text CHECK (artist IS NULL OR length(artist) <= 200),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 31457280),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  lyrics text CHECK (lyrics IS NULL OR length(lyrics) <= 20000),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS karaoke_backing_tracks_owner ON public.karaoke_backing_tracks (owner_id, created_at DESC);

-- Reserved stage slots: "time slot + singer (+ song)".
CREATE TABLE IF NOT EXISTS public.karaoke_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  booked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  singer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_title text CHECK (song_title IS NULL OR length(song_title) <= 200),
  song_artist text CHECK (song_artist IS NULL OR length(song_artist) <= 200),
  video_id text CHECK (video_id IS NULL OR video_id ~ '^[A-Za-z0-9_-]{11}$'),
  backing_track_id uuid REFERENCES public.karaoke_backing_tracks(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled','completed','no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS karaoke_reservations_room_time
  ON public.karaoke_reservations (room_id, starts_at) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS karaoke_reservations_singer ON public.karaoke_reservations (singer_user_id, starts_at);

-- Recordings: link takes to the performance that produced them.
ALTER TABLE public.karaoke_recordings
  ADD COLUMN IF NOT EXISTS reservation_id uuid,
  ADD COLUMN IF NOT EXISTS session_generation integer,
  ADD COLUMN IF NOT EXISTS backing_track_id uuid,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'room';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'karaoke_recordings_visibility_chk') THEN
    ALTER TABLE public.karaoke_recordings ADD CONSTRAINT karaoke_recordings_visibility_chk
      CHECK (visibility IN ('room','private'));
  END IF;
END $$;

-- ─── 3. RLS + grants ───────────────────────────────────────────────────────
ALTER TABLE public.karaoke_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.karaoke_room_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.karaoke_room_sanctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.karaoke_backing_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.karaoke_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "karaoke_presence read" ON public.karaoke_presence;
CREATE POLICY "karaoke_presence read" ON public.karaoke_presence FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "karaoke_room_settings read" ON public.karaoke_room_settings;
CREATE POLICY "karaoke_room_settings read" ON public.karaoke_room_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "karaoke_room_sanctions read own or mod" ON public.karaoke_room_sanctions;
CREATE POLICY "karaoke_room_sanctions read own or mod" ON public.karaoke_room_sanctions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.room_bookings b
       WHERE b.room_id = karaoke_room_sanctions.room_id AND b.user_id = auth.uid()
         AND now() >= b.starts_at AND now() < b.ends_at
    )
  );

DROP POLICY IF EXISTS "karaoke_backing_tracks read own or public" ON public.karaoke_backing_tracks;
CREATE POLICY "karaoke_backing_tracks read own or public" ON public.karaoke_backing_tracks
  FOR SELECT TO authenticated USING (owner_id = auth.uid() OR is_public);
DROP POLICY IF EXISTS "karaoke_backing_tracks insert own" ON public.karaoke_backing_tracks;
CREATE POLICY "karaoke_backing_tracks insert own" ON public.karaoke_backing_tracks
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = auth.uid() AND storage_path LIKE auth.uid()::text || '/%'
  );
DROP POLICY IF EXISTS "karaoke_backing_tracks update own" ON public.karaoke_backing_tracks;
CREATE POLICY "karaoke_backing_tracks update own" ON public.karaoke_backing_tracks
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "karaoke_backing_tracks delete own or admin" ON public.karaoke_backing_tracks;
CREATE POLICY "karaoke_backing_tracks delete own or admin" ON public.karaoke_backing_tracks
  FOR DELETE TO authenticated USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "karaoke_reservations read" ON public.karaoke_reservations;
CREATE POLICY "karaoke_reservations read" ON public.karaoke_reservations FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.karaoke_presence, public.karaoke_room_settings, public.karaoke_room_sanctions,
  public.karaoke_reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.karaoke_backing_tracks TO authenticated;
GRANT ALL ON public.karaoke_presence, public.karaoke_room_settings, public.karaoke_room_sanctions,
  public.karaoke_backing_tracks, public.karaoke_reservations TO service_role;

-- Lock down direct writes to stage state: RPCs are the ONLY write path.
DROP POLICY IF EXISTS "karaoke_sessions insert for authenticated" ON public.karaoke_sessions;
DROP POLICY IF EXISTS "karaoke_sessions update for authenticated" ON public.karaoke_sessions;
DROP POLICY IF EXISTS "karaoke_sessions insert by performer or host" ON public.karaoke_sessions;
DROP POLICY IF EXISTS "karaoke_sessions update by performer or host" ON public.karaoke_sessions;
DROP POLICY IF EXISTS "karaoke_queue insert self" ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_queue delete own entry" ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_queue delete for live room cleanup" ON public.karaoke_queue;
REVOKE INSERT, UPDATE, DELETE ON public.karaoke_sessions FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.karaoke_queue FROM authenticated, anon;
GRANT SELECT ON public.karaoke_sessions, public.karaoke_queue TO authenticated;
GRANT ALL ON public.karaoke_sessions, public.karaoke_queue TO service_role;

-- Realtime for the new shared state.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['karaoke_reservations','karaoke_room_settings','karaoke_room_sanctions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ─── 4. Storage buckets ────────────────────────────────────────────────────
-- Recordings become PRIVATE (members-only, served through signed URLs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('karaoke-recordings', 'karaoke-recordings', false, 52428800, ARRAY['audio/*'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 52428800, allowed_mime_types = ARRAY['audio/*'];

DROP POLICY IF EXISTS "Karaoke recordings are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Karaoke recordings readable by members" ON storage.objects;
CREATE POLICY "Karaoke recordings readable by members" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'karaoke-recordings');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('karaoke-backing-tracks', 'karaoke-backing-tracks', false, 31457280, ARRAY['audio/*'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 31457280, allowed_mime_types = ARRAY['audio/*'];

DROP POLICY IF EXISTS "Backing tracks: owner upload" ON storage.objects;
CREATE POLICY "Backing tracks: owner upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'karaoke-backing-tracks' AND (storage.foldername(name))[1] = auth.uid()::text
  );
DROP POLICY IF EXISTS "Backing tracks: owner or shared read" ON storage.objects;
CREATE POLICY "Backing tracks: owner or shared read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'karaoke-backing-tracks' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.karaoke_backing_tracks t WHERE t.storage_path = name AND t.is_public)
    )
  );
DROP POLICY IF EXISTS "Backing tracks: owner or admin delete" ON storage.objects;
CREATE POLICY "Backing tracks: owner or admin delete" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'karaoke-backing-tracks' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    )
  );

-- ─── 5. Helper functions ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.karaoke_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'super_admin'::public.app_role)
$$;

-- Whole-room booking holder (room_bookings) right now, or null.
CREATE OR REPLACE FUNCTION public.karaoke_booking_host(_room uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM public.room_bookings
   WHERE room_id = _room AND now() >= starts_at AND now() < ends_at
   ORDER BY starts_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.karaoke_is_moderator(_room uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- COALESCE matters: with no active booking, `booking_host = _uid` is NULL,
  -- and `NOT NULL` inside an IF silently lets the caller through. The
  -- original drizzle version had exactly that hole (any member could skip
  -- or control someone else's song).
  SELECT COALESCE(_uid IS NOT NULL AND (
    public.karaoke_is_admin(_uid) OR public.karaoke_booking_host(_room) IS NOT DISTINCT FROM _uid
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.karaoke_is_sanctioned(_room uuid, _uid uuid, _kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.karaoke_room_sanctions
     WHERE room_id = _room AND user_id = _uid AND lifted_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (kind = _kind OR (_kind = 'mute' AND kind = 'ban'))
  )
$$;

CREATE OR REPLACE FUNCTION public.karaoke_settings(_room uuid)
RETURNS public.karaoke_room_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.karaoke_room_settings;
BEGIN
  SELECT * INTO st FROM public.karaoke_room_settings WHERE room_id = _room;
  IF NOT FOUND THEN
    st.room_id := _room; st.rules := ''; st.max_song_seconds := 420; st.max_slot_minutes := 15;
    st.max_future_bookings := 3; st.booking_window_days := 14; st.require_booking := false;
    st.holders_priority := true; st.allow_youtube := true; st.allow_uploads := true;
    st.recording_enabled := true;
  END IF;
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_assert_room(_room uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = _room AND kind = 'karaoke' AND active) THEN
    RAISE EXCEPTION 'Karaoke room not found';
  END IF;
END $$;

-- Lock (and lazily create) the room's session row.
CREATE OR REPLACE FUNCTION public.karaoke_lock_session(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions;
BEGIN
  INSERT INTO public.karaoke_sessions (room_id) VALUES (_room) ON CONFLICT (room_id) DO NOTHING;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room FOR UPDATE;
  RETURN s;
END $$;

-- Who is entitled to the stage right now (reservation > whole-room booking).
-- A reserved singer who hasn't shown up 3 minutes into their slot is marked
-- no_show and the stage falls back to the booking host / open mic.
CREATE OR REPLACE FUNCTION public.karaoke_entitled_performer(
  _room uuid, OUT performer uuid, OUT source text, OUT reservation uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.karaoke_reservations; present boolean;
BEGIN
  performer := NULL; source := 'open'; reservation := NULL;
  SELECT * INTO r FROM public.karaoke_reservations
   WHERE room_id = _room AND status = 'booked' AND now() >= starts_at AND now() < ends_at
   ORDER BY starts_at LIMIT 1;
  IF FOUND THEN
    present := EXISTS (SELECT 1 FROM public.karaoke_presence p
                        WHERE p.room_id = _room AND p.user_id = r.singer_user_id
                          AND p.last_seen_at > now() - interval '45 seconds');
    IF public.karaoke_is_sanctioned(_room, r.singer_user_id, 'mute') THEN
      UPDATE public.karaoke_reservations SET status = 'cancelled' WHERE id = r.id;
    ELSIF present OR now() < r.starts_at + interval '3 minutes' THEN
      performer := r.singer_user_id; source := 'reservation'; reservation := r.id;
      RETURN;
    ELSE
      UPDATE public.karaoke_reservations SET status = 'no_show' WHERE id = r.id;
    END IF;
  END IF;
  performer := public.karaoke_booking_host(_room);
  IF performer IS NOT NULL THEN source := 'booking'; END IF;
END $$;

-- Internal: hand the stage to whoever is entitled, else the next fresh queue member.
DROP FUNCTION IF EXISTS public.karaoke_promote_next(uuid, integer);
CREATE OR REPLACE FUNCTION public.karaoke_promote_next(_room uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ent record; nxt uuid; src text := 'open'; res uuid := NULL; st public.karaoke_room_settings;
BEGIN
  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);
  IF ent.performer IS NOT NULL THEN
    nxt := ent.performer; src := ent.source; res := ent.reservation;
  ELSE
    st := public.karaoke_settings(_room);
    SELECT q.user_id INTO nxt FROM public.karaoke_queue q
     WHERE q.room_id = _room AND q.last_seen_at > now() - interval '45 seconds'
       AND NOT public.karaoke_is_sanctioned(_room, q.user_id, 'mute')
     ORDER BY (CASE WHEN st.holders_priority AND public.is_token_proof_verified(q.user_id) THEN 0 ELSE 1 END),
              q.joined_at
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

-- ─── 6. Client RPCs ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.karaoke_join_queue(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); st public.karaoke_room_settings;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') THEN
    RAISE EXCEPTION 'You are muted in this room';
  END IF;
  st := public.karaoke_settings(_room);
  IF st.require_booking AND NOT public.karaoke_is_admin(uid) THEN
    RAISE EXCEPTION 'This room is booking-only. Reserve a slot to sing.';
  END IF;
  INSERT INTO public.karaoke_queue (room_id, user_id) VALUES (_room, uid) ON CONFLICT DO NOTHING;
  UPDATE public.karaoke_queue SET last_seen_at = now() WHERE room_id = _room AND user_id = uid;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_leave_queue(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = uid;
  DELETE FROM public.karaoke_presence WHERE room_id = _room AND user_id = uid;
  IF s.performer_user_id = uid AND s.stage_source = 'open' THEN
    PERFORM public.karaoke_promote_next(_room);
  END IF;
END $$;

-- Heartbeat: every viewer calls this every 15s. Grace is fixed server-side.
DROP FUNCTION IF EXISTS public.karaoke_heartbeat(uuid, integer);
CREATE OR REPLACE FUNCTION public.karaoke_heartbeat(_room uuid)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.karaoke_sessions; uid uuid := auth.uid(); ent record; st public.karaoke_room_settings;
  pos integer; grace interval := interval '45 seconds';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);

  INSERT INTO public.karaoke_presence (room_id, user_id, last_seen_at) VALUES (_room, uid, now())
  ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen_at = now();
  UPDATE public.karaoke_queue SET last_seen_at = now() WHERE room_id = _room AND user_id = uid;

  s := public.karaoke_lock_session(_room);
  IF s.performer_user_id = uid THEN
    UPDATE public.karaoke_sessions SET performer_heartbeat_at = now() WHERE room_id = _room;
    s.performer_heartbeat_at := now();
  END IF;

  SELECT * INTO ent FROM public.karaoke_entitled_performer(_room);

  IF ent.performer IS NOT NULL THEN
    -- Reserved slot / booking in effect: make sure the entitled singer holds the stage.
    IF s.performer_user_id IS DISTINCT FROM ent.performer
       OR s.reservation_id IS DISTINCT FROM ent.reservation THEN
      IF s.reservation_id IS NOT NULL AND s.reservation_id IS DISTINCT FROM ent.reservation THEN
        UPDATE public.karaoke_reservations SET status = 'completed'
         WHERE id = s.reservation_id AND status = 'booked';
      END IF;
      PERFORM public.karaoke_promote_next(_room);
    END IF;
  ELSIF s.stage_source <> 'open' THEN
    -- The slot/booking just ended: close it and reopen the open-mic line.
    IF s.reservation_id IS NOT NULL THEN
      UPDATE public.karaoke_reservations SET status = 'completed'
       WHERE id = s.reservation_id AND status = 'booked';
    END IF;
    PERFORM public.karaoke_promote_next(_room);
  ELSIF s.performer_user_id IS NULL
     OR s.performer_heartbeat_at IS NULL
     OR s.performer_heartbeat_at < now() - grace
     OR public.karaoke_is_sanctioned(_room, s.performer_user_id, 'mute') THEN
    IF s.performer_user_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.karaoke_queue WHERE room_id = _room AND last_seen_at > now() - grace) THEN
      PERFORM public.karaoke_promote_next(_room);
    END IF;
  END IF;

  -- Song-length cap from the room rules (bars cap songs; so do we).
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room FOR UPDATE;
  st := public.karaoke_settings(_room);
  IF st.max_song_seconds > 0 AND s.playback_status = 'playing' THEN
    pos := s.position_ms + (extract(epoch FROM now() - s.position_at) * 1000)::int;
    IF pos > st.max_song_seconds * 1000 + 5000 THEN
      IF s.stage_source = 'open' THEN
        PERFORM public.karaoke_promote_next(_room);
      ELSE
        UPDATE public.karaoke_sessions SET video_id = NULL, search_query = NULL, backing_track_id = NULL,
          song_title = NULL, song_artist = NULL, playback_status = 'idle', position_ms = 0,
          position_at = now(), revision = revision + 1, updated_at = now()
        WHERE room_id = _room;
      END IF;
    END IF;
  END IF;

  DELETE FROM public.karaoke_queue WHERE room_id = _room AND last_seen_at < now() - grace * 2;
  DELETE FROM public.karaoke_presence WHERE room_id = _room AND last_seen_at < now() - interval '10 minutes';
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- Claim a vacant stage (open mic only).
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

-- Song / playback control by the current performer (or moderator).
DROP FUNCTION IF EXISTS public.karaoke_control(uuid, bigint, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.karaoke_control(
  _room uuid, _expected_revision bigint, _action text,
  _video_id text DEFAULT NULL, _search_query text DEFAULT NULL, _position_ms integer DEFAULT NULL,
  _backing_track_id uuid DEFAULT NULL, _song_title text DEFAULT NULL, _song_artist text DEFAULT NULL)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; pos integer; uid uuid := auth.uid(); st public.karaoke_room_settings;
  trk public.karaoke_backing_tracks;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF s.performer_user_id IS DISTINCT FROM uid AND NOT public.karaoke_is_moderator(_room, uid) THEN
    RAISE EXCEPTION 'Only the singer on stage can control the song';
  END IF;
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') AND NOT public.karaoke_is_moderator(_room, uid) THEN
    RAISE EXCEPTION 'You are muted in this room';
  END IF;
  IF _expected_revision IS NOT NULL AND _expected_revision <> s.revision THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;
  st := public.karaoke_settings(_room);
  pos := CASE WHEN s.playback_status = 'playing'
    THEN s.position_ms + (extract(epoch FROM now() - s.position_at) * 1000)::int
    ELSE s.position_ms END;
  IF _action = 'song' THEN
    IF _video_id IS NOT NULL AND _video_id !~ '^[A-Za-z0-9_-]{11}$' THEN RAISE EXCEPTION 'Invalid video id'; END IF;
    IF _video_id IS NOT NULL AND NOT st.allow_youtube THEN RAISE EXCEPTION 'YouTube tracks are disabled in this room'; END IF;
    IF _backing_track_id IS NOT NULL THEN
      IF NOT st.allow_uploads THEN RAISE EXCEPTION 'Uploaded tracks are disabled in this room'; END IF;
      SELECT * INTO trk FROM public.karaoke_backing_tracks WHERE id = _backing_track_id;
      IF NOT FOUND OR NOT (trk.is_public OR trk.owner_id = s.performer_user_id OR trk.owner_id = uid) THEN
        RAISE EXCEPTION 'Backing track not available';
      END IF;
    END IF;
    UPDATE public.karaoke_sessions SET
      video_id = CASE WHEN _backing_track_id IS NULL THEN _video_id ELSE NULL END,
      backing_track_id = _backing_track_id,
      search_query = NULL,
      song_title = left(COALESCE(_song_title, trk.title), 200),
      song_artist = left(COALESCE(_song_artist, trk.artist), 200),
      playback_status = CASE WHEN _video_id IS NULL AND _backing_track_id IS NULL THEN 'idle' ELSE 'playing' END,
      position_ms = 0, position_at = now() WHERE room_id = _room;
  ELSIF _action = 'play' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'playing',
      position_ms = GREATEST(0, COALESCE(_position_ms, pos)), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'pause' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'paused',
      position_ms = GREATEST(0, COALESCE(_position_ms, pos)), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'seek' THEN
    UPDATE public.karaoke_sessions SET position_ms = GREATEST(0, COALESCE(_position_ms, 0)), position_at = now() WHERE room_id = _room;
  ELSIF _action = 'stop' THEN
    UPDATE public.karaoke_sessions SET playback_status = 'stopped', position_ms = 0, position_at = now() WHERE room_id = _room;
  ELSE
    RAISE EXCEPTION 'Unknown action %', _action;
  END IF;
  UPDATE public.karaoke_sessions SET revision = revision + 1, updated_at = now(),
    performer_heartbeat_at = CASE WHEN performer_user_id = uid THEN now() ELSE performer_heartbeat_at END
  WHERE room_id = _room;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- End the current turn: performer ends own song, or moderator force-skips.
CREATE OR REPLACE FUNCTION public.karaoke_end_turn(_room uuid, _expected_generation integer DEFAULT NULL)
RETURNS public.karaoke_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.karaoke_sessions; uid uuid := auth.uid(); is_mod boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.karaoke_lock_session(_room);
  IF _expected_generation IS NOT NULL AND _expected_generation <> s.generation THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;
  is_mod := public.karaoke_is_moderator(_room, uid);
  IF s.performer_user_id IS DISTINCT FROM uid AND NOT is_mod THEN
    RAISE EXCEPTION 'Not allowed to end this turn';
  END IF;
  IF s.stage_source <> 'open' AND s.performer_user_id = uid THEN
    -- Reserved/booked singer keeps the stage for the rest of the slot; just stop the song.
    UPDATE public.karaoke_sessions SET video_id = NULL, search_query = NULL, backing_track_id = NULL,
      song_title = NULL, song_artist = NULL, playback_status = 'idle',
      position_ms = 0, position_at = now(), revision = revision + 1, updated_at = now()
    WHERE room_id = _room;
  ELSE
    IF s.reservation_id IS NOT NULL THEN
      -- Moderator skip of a reserved slot ends that slot.
      UPDATE public.karaoke_reservations SET status = 'completed' WHERE id = s.reservation_id AND status = 'booked';
    END IF;
    IF s.performer_user_id IS NOT NULL THEN
      DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = s.performer_user_id;
    END IF;
    PERFORM public.karaoke_promote_next(_room);
  END IF;
  SELECT * INTO s FROM public.karaoke_sessions WHERE room_id = _room;
  RETURN s;
END $$;

-- ─── 7. Booking (reservations) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.karaoke_book_slot(
  _room uuid, _starts_at timestamptz, _minutes integer, _singer uuid DEFAULT NULL,
  _song_title text DEFAULT NULL, _song_artist text DEFAULT NULL,
  _video_id text DEFAULT NULL, _backing_track_id uuid DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS public.karaoke_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); singer uuid; st public.karaoke_room_settings; r public.karaoke_reservations;
  ends timestamptz; is_admin boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  is_admin := public.karaoke_is_admin(uid);
  singer := COALESCE(_singer, uid);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = singer) THEN RAISE EXCEPTION 'Singer not found'; END IF;
  IF public.karaoke_is_sanctioned(_room, uid, 'mute') OR public.karaoke_is_sanctioned(_room, singer, 'mute') THEN
    RAISE EXCEPTION 'Muted or banned members cannot book this room';
  END IF;
  st := public.karaoke_settings(_room);
  IF _minutes IS NULL OR _minutes < 5 OR _minutes > st.max_slot_minutes OR _minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'Slots are 5-minute blocks up to % minutes', st.max_slot_minutes;
  END IF;
  -- Align to 5-minute boundaries so slots tile cleanly.
  _starts_at := date_trunc('minute', _starts_at);
  IF extract(minute FROM _starts_at)::int % 5 <> 0 THEN RAISE EXCEPTION 'Start time must be on a 5-minute mark'; END IF;
  IF _starts_at < now() - interval '1 minute' THEN RAISE EXCEPTION 'That time has already passed'; END IF;
  IF _starts_at > now() + make_interval(days => st.booking_window_days) THEN
    RAISE EXCEPTION 'You can book up to % days ahead', st.booking_window_days;
  END IF;
  ends := _starts_at + make_interval(mins => _minutes);
  IF NOT is_admin AND (SELECT count(*) FROM public.karaoke_reservations
       WHERE booked_by = uid AND status = 'booked' AND ends_at > now()) >= st.max_future_bookings THEN
    RAISE EXCEPTION 'You already have % upcoming bookings', st.max_future_bookings;
  END IF;
  IF _video_id IS NOT NULL AND _video_id !~ '^[A-Za-z0-9_-]{11}$' THEN RAISE EXCEPTION 'Invalid video id'; END IF;
  IF _backing_track_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.karaoke_backing_tracks t
        WHERE t.id = _backing_track_id AND (t.is_public OR t.owner_id IN (uid, singer))) THEN
    RAISE EXCEPTION 'Backing track not available';
  END IF;

  -- Serialise bookings per room, then check overlap (no exclusion constraint
  -- needed; this function is the only write path).
  PERFORM pg_advisory_xact_lock(hashtextextended('karaoke_book:' || _room::text, 0));
  IF EXISTS (SELECT 1 FROM public.karaoke_reservations
              WHERE room_id = _room AND status = 'booked'
                AND tstzrange(starts_at, ends_at) && tstzrange(_starts_at, ends)) THEN
    RAISE EXCEPTION 'That slot is already taken';
  END IF;
  IF EXISTS (SELECT 1 FROM public.karaoke_reservations
              WHERE singer_user_id = singer AND status = 'booked'
                AND tstzrange(starts_at, ends_at) && tstzrange(_starts_at, ends)) THEN
    RAISE EXCEPTION 'That singer already has a slot at that time';
  END IF;

  INSERT INTO public.karaoke_reservations
    (room_id, booked_by, singer_user_id, song_title, song_artist, video_id, backing_track_id, notes, starts_at, ends_at)
  VALUES (_room, uid, singer, left(_song_title, 200), left(_song_artist, 200), _video_id, _backing_track_id,
          left(_notes, 500), _starts_at, ends)
  RETURNING * INTO r;

  IF singer <> uid THEN
    INSERT INTO public.notifications (user_id, kind, title, body, url)
    VALUES (singer, 'karaoke.reservation', 'You''re booked to sing',
            to_char(_starts_at AT TIME ZONE 'UTC', 'Mon DD HH24:MI') || ' UTC · ' || COALESCE(_song_title, 'Song TBD'),
            '/karaoke/' || _room::text);
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_cancel_reservation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.karaoke_reservations;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO r FROM public.karaoke_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF uid NOT IN (r.booked_by, r.singer_user_id) AND NOT public.karaoke_is_moderator(r.room_id, uid) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF r.status <> 'booked' THEN RETURN; END IF;
  UPDATE public.karaoke_reservations SET status = 'cancelled' WHERE id = _id;
  -- If that slot is live, hand the stage back to open mic.
  IF EXISTS (SELECT 1 FROM public.karaoke_sessions WHERE room_id = r.room_id AND reservation_id = _id) THEN
    PERFORM public.karaoke_lock_session(r.room_id);
    PERFORM public.karaoke_promote_next(r.room_id);
  END IF;
END $$;

-- ─── 8. Moderation / admin RPCs ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.karaoke_set_sanction(
  _room uuid, _user uuid, _kind text, _active boolean, _minutes integer DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _kind NOT IN ('mute','ban') THEN RAISE EXCEPTION 'Unknown sanction'; END IF;
  IF NOT public.karaoke_is_moderator(_room, uid) THEN RAISE EXCEPTION 'Moderator only'; END IF;
  IF _kind = 'ban' AND NOT public.karaoke_is_admin(uid) THEN RAISE EXCEPTION 'Only admins can ban'; END IF;
  IF _user = uid THEN RAISE EXCEPTION 'You cannot sanction yourself'; END IF;
  IF public.karaoke_is_admin(_user) AND NOT public.has_role(uid, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can sanction an admin';
  END IF;
  IF _active THEN
    UPDATE public.karaoke_room_sanctions SET lifted_at = now(), lifted_by = uid
     WHERE room_id = _room AND user_id = _user AND kind = _kind AND lifted_at IS NULL;
    INSERT INTO public.karaoke_room_sanctions (room_id, user_id, kind, reason, created_by, expires_at)
    VALUES (_room, _user, _kind, left(_reason, 300), uid,
            CASE WHEN _minutes IS NULL OR _minutes <= 0 THEN NULL ELSE now() + make_interval(mins => _minutes) END);
    DELETE FROM public.karaoke_queue WHERE room_id = _room AND user_id = _user;
    IF EXISTS (SELECT 1 FROM public.karaoke_sessions WHERE room_id = _room AND performer_user_id = _user) THEN
      PERFORM public.karaoke_lock_session(_room);
      UPDATE public.karaoke_reservations SET status = 'cancelled'
       WHERE room_id = _room AND singer_user_id = _user AND status = 'booked' AND now() BETWEEN starts_at AND ends_at;
      PERFORM public.karaoke_promote_next(_room);
    END IF;
  ELSE
    UPDATE public.karaoke_room_sanctions SET lifted_at = now(), lifted_by = uid
     WHERE room_id = _room AND user_id = _user AND (kind = _kind OR _kind = 'ban') AND lifted_at IS NULL;
  END IF;
  INSERT INTO public.audit_logs (event_type, actor_id, target_id, metadata)
  VALUES ('karaoke.' || _kind || CASE WHEN _active THEN '' ELSE '.lift' END, uid, _room,
          jsonb_build_object('user_id', _user, 'minutes', _minutes, 'reason', _reason));
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_update_settings(_room uuid, _patch jsonb)
RETURNS public.karaoke_room_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cur public.karaoke_room_settings;
BEGIN
  IF uid IS NULL OR NOT public.karaoke_is_admin(uid) THEN RAISE EXCEPTION 'Admin only'; END IF;
  PERFORM public.karaoke_assert_room(_room);
  cur := public.karaoke_settings(_room);
  INSERT INTO public.karaoke_room_settings AS k (room_id, rules, max_song_seconds, max_slot_minutes,
    max_future_bookings, booking_window_days, require_booking, holders_priority, allow_youtube,
    allow_uploads, recording_enabled, updated_by, updated_at)
  VALUES (
    _room,
    left(COALESCE(_patch->>'rules', cur.rules), 4000),
    COALESCE((_patch->>'max_song_seconds')::int, cur.max_song_seconds),
    COALESCE((_patch->>'max_slot_minutes')::int, cur.max_slot_minutes),
    COALESCE((_patch->>'max_future_bookings')::int, cur.max_future_bookings),
    COALESCE((_patch->>'booking_window_days')::int, cur.booking_window_days),
    COALESCE((_patch->>'require_booking')::boolean, cur.require_booking),
    COALESCE((_patch->>'holders_priority')::boolean, cur.holders_priority),
    COALESCE((_patch->>'allow_youtube')::boolean, cur.allow_youtube),
    COALESCE((_patch->>'allow_uploads')::boolean, cur.allow_uploads),
    COALESCE((_patch->>'recording_enabled')::boolean, cur.recording_enabled),
    uid, now())
  ON CONFLICT (room_id) DO UPDATE SET
    rules = EXCLUDED.rules, max_song_seconds = EXCLUDED.max_song_seconds,
    max_slot_minutes = EXCLUDED.max_slot_minutes, max_future_bookings = EXCLUDED.max_future_bookings,
    booking_window_days = EXCLUDED.booking_window_days, require_booking = EXCLUDED.require_booking,
    holders_priority = EXCLUDED.holders_priority, allow_youtube = EXCLUDED.allow_youtube,
    allow_uploads = EXCLUDED.allow_uploads, recording_enabled = EXCLUDED.recording_enabled,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO cur;
  INSERT INTO public.audit_logs (event_type, actor_id, target_id, metadata)
  VALUES ('karaoke.settings', uid, _room, _patch);
  RETURN cur;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_admin_clear_queue(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.karaoke_is_moderator(_room, auth.uid()) THEN RAISE EXCEPTION 'Moderator only'; END IF;
  DELETE FROM public.karaoke_queue WHERE room_id = _room;
END $$;

CREATE OR REPLACE FUNCTION public.karaoke_admin_create_room(_name text, _description text DEFAULT NULL, _capacity integer DEFAULT 20)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); rid uuid;
BEGIN
  IF uid IS NULL OR NOT public.karaoke_is_admin(uid) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _name IS NULL OR length(trim(_name)) < 2 THEN RAISE EXCEPTION 'Name is required'; END IF;
  INSERT INTO public.rooms (name, description, capacity, tier, livekit_room, theme, display_order, is_locked, kind, active)
  VALUES (left(trim(_name), 80), left(_description, 500), GREATEST(2, LEAST(COALESCE(_capacity, 20), 200)),
          'public', 'karaoke-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'karaoke',
          COALESCE((SELECT max(display_order) + 1 FROM public.rooms), 20), false, 'karaoke', true)
  RETURNING id INTO rid;
  INSERT INTO public.audit_logs (event_type, actor_id, target_id, metadata)
  VALUES ('karaoke.room.create', uid, rid, jsonb_build_object('name', _name));
  RETURN rid;
END $$;

-- Hard delete (cascades sessions, queue, presence, bookings, reservations,
-- settings, sanctions). Returns the LiveKit room name so the server fn can
-- close it. Recording files are removed by the server fn before this runs.
CREATE OR REPLACE FUNCTION public.karaoke_admin_delete_room(_room uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); lk text; nm text;
BEGIN
  IF uid IS NULL OR NOT public.karaoke_is_admin(uid) THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT livekit_room, name INTO lk, nm FROM public.rooms WHERE id = _room AND kind = 'karaoke';
  IF NOT FOUND THEN RAISE EXCEPTION 'Karaoke room not found'; END IF;
  DELETE FROM public.karaoke_recordings WHERE room_id = _room;
  DELETE FROM public.rooms WHERE id = _room;
  INSERT INTO public.audit_logs (event_type, actor_id, target_id, metadata)
  VALUES ('karaoke.room.delete', uid, _room, jsonb_build_object('name', nm, 'livekit_room', lk));
  RETURN lk;
END $$;

-- ─── 9. Function privileges ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.karaoke_lock_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_promote_next(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_entitled_performer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_settings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.karaoke_assert_room(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.karaoke_is_admin(uuid)',
    'public.karaoke_booking_host(uuid)',
    'public.karaoke_is_moderator(uuid, uuid)',
    'public.karaoke_is_sanctioned(uuid, uuid, text)',
    'public.karaoke_join_queue(uuid)',
    'public.karaoke_leave_queue(uuid)',
    'public.karaoke_heartbeat(uuid)',
    'public.karaoke_claim_stage(uuid)',
    'public.karaoke_control(uuid, bigint, text, text, text, integer, uuid, text, text)',
    'public.karaoke_end_turn(uuid, integer)',
    'public.karaoke_book_slot(uuid, timestamptz, integer, uuid, text, text, text, uuid, text)',
    'public.karaoke_cancel_reservation(uuid)',
    'public.karaoke_set_sanction(uuid, uuid, text, boolean, integer, text)',
    'public.karaoke_update_settings(uuid, jsonb)',
    'public.karaoke_admin_clear_queue(uuid)',
    'public.karaoke_admin_create_room(text, text, integer)',
    'public.karaoke_admin_delete_room(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Server clock for playback sync (clients compute their skew once so every
-- viewer's lyrics video lands on the same second as the singer).
CREATE OR REPLACE FUNCTION public.karaoke_server_time()
RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$;
REVOKE ALL ON FUNCTION public.karaoke_server_time() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.karaoke_server_time() TO authenticated;
