
-- =========================================================
-- AUDIT LOGS
-- =========================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_id UUID,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_event_type ON public.audit_logs (event_type);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs (actor_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Authenticated users can insert audit events"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = actor_id OR actor_id IS NULL);

CREATE OR REPLACE FUNCTION public.log_audit_event(
  _event_type TEXT,
  _target_id UUID DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  INSERT INTO public.audit_logs (event_type, actor_id, target_id, metadata)
  VALUES (_event_type, auth.uid(), _target_id, COALESCE(_metadata, '{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- =========================================================
-- ROOMS + BOOKINGS
-- =========================================================
CREATE TYPE public.room_tier AS ENUM ('token_proof', 'lifer');

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  capacity INT NOT NULL DEFAULT 12,
  tier public.room_tier NOT NULL DEFAULT 'token_proof',
  livekit_room TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Token-proof users can read token-proof rooms"
ON public.rooms FOR SELECT TO authenticated
USING (
  (tier = 'token_proof' AND is_token_proof_verified(auth.uid()))
  OR (tier = 'lifer' AND is_lifer(auth.uid()))
);

CREATE POLICY "Super admins can manage rooms"
ON public.rooms FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TABLE public.room_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  override_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_room_bookings_room_time ON public.room_bookings (room_id, starts_at, ends_at);

ALTER TABLE public.room_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verified users can view bookings of accessible rooms"
ON public.room_bookings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = room_bookings.room_id
      AND (
        (r.tier = 'token_proof' AND is_token_proof_verified(auth.uid()))
        OR (r.tier = 'lifer' AND is_lifer(auth.uid()))
      )
  )
);

CREATE POLICY "Verified users can create their own bookings"
ON public.room_bookings FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = room_bookings.room_id
      AND (
        (r.tier = 'token_proof' AND is_token_proof_verified(auth.uid()))
        OR (r.tier = 'lifer' AND is_lifer(auth.uid()))
      )
  )
);

CREATE POLICY "Owners or admins can update bookings"
ON public.room_bookings FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role))
WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role));

CREATE POLICY "Owners or admins can delete bookings"
ON public.room_bookings FOR DELETE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.prevent_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.override_by IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_bookings b
    WHERE b.room_id = NEW.room_id
      AND b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'Booking conflicts with an existing reservation for this room';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_booking_overlap
BEFORE INSERT OR UPDATE ON public.room_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_overlap();

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, read_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications"
ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated can insert notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (true);

-- =========================================================
-- SOCIAL FEED
-- =========================================================
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_created_at ON public.posts (created_at DESC);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Token-proof users read posts"
ON public.posts FOR SELECT TO authenticated
USING (is_token_proof_verified(auth.uid()));

CREATE POLICY "Token-proof users create posts"
ON public.posts FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND is_token_proof_verified(auth.uid()));

CREATE POLICY "Owners update own posts"
ON public.posts FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners or admins delete posts"
ON public.posts FOR DELETE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role));

CREATE TABLE public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Token-proof users read likes" ON public.post_likes
FOR SELECT TO authenticated USING (is_token_proof_verified(auth.uid()));
CREATE POLICY "Token-proof users like" ON public.post_likes
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND is_token_proof_verified(auth.uid()));
CREATE POLICY "Users unlike own" ON public.post_likes
FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_comments_post ON public.post_comments (post_id, created_at);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Token-proof users read comments" ON public.post_comments
FOR SELECT TO authenticated USING (is_token_proof_verified(auth.uid()));
CREATE POLICY "Token-proof users comment" ON public.post_comments
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND is_token_proof_verified(auth.uid()));
CREATE POLICY "Owners or admins delete comments" ON public.post_comments
FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_bookings;

-- =========================================================
-- SEED 20 ROOMS
-- =========================================================
INSERT INTO public.rooms (name, description, capacity, tier, livekit_room) VALUES
  ('Boardroom 1','Main commons boardroom',20,'token_proof','baycmc-room-1'),
  ('Boardroom 2','Quiet meeting space',12,'token_proof','baycmc-room-2'),
  ('Lounge A','Casual hangout',16,'token_proof','baycmc-room-3'),
  ('Lounge B','Casual hangout',16,'token_proof','baycmc-room-4'),
  ('Studio 1','Recording / podcast',8,'token_proof','baycmc-room-5'),
  ('Studio 2','Recording / podcast',8,'token_proof','baycmc-room-6'),
  ('Garden','Outdoor vibe',24,'token_proof','baycmc-room-7'),
  ('Pool Deck','Pool deck stage',24,'token_proof','baycmc-room-8'),
  ('Library','Reading & talks',12,'token_proof','baycmc-room-9'),
  ('Atrium','Open plenary',40,'token_proof','baycmc-room-10'),
  ('Lifers Suite 1','Private suite',12,'lifer','baycmc-lifers-1'),
  ('Lifers Suite 2','Private suite',12,'lifer','baycmc-lifers-2'),
  ('Cigar Room','Members cigar room',10,'lifer','baycmc-lifers-3'),
  ('Cellar','Private cellar tastings',10,'lifer','baycmc-lifers-4'),
  ('Penthouse','Top-floor penthouse',20,'lifer','baycmc-lifers-5'),
  ('Marina','Marina lounge',16,'lifer','baycmc-lifers-6'),
  ('Vault','Highly private',8,'lifer','baycmc-lifers-7'),
  ('Rooftop','Open-air rooftop',30,'lifer','baycmc-lifers-8'),
  ('Helipad','Top-deck helipad lounge',12,'lifer','baycmc-lifers-9'),
  ('Conservatory','Lush plant conservatory',18,'lifer','baycmc-lifers-10');

-- =========================================================
-- OTHERPAGE SETTINGS (single row controlled via app_settings already; add concrete table)
-- =========================================================
CREATE TABLE public.otherpage_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  contract_address TEXT,
  chain_id INT NOT NULL DEFAULT 1,
  api_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
INSERT INTO public.otherpage_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.otherpage_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read otherpage settings" ON public.otherpage_settings
FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins update otherpage settings" ON public.otherpage_settings
FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(),'super_admin'::app_role));
