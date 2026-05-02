-- Ape Rides: live host sessions from inside the Wynwood clubhouse
CREATE TYPE public.ape_ride_status AS ENUM ('live', 'ended');
CREATE TYPE public.ape_ride_request_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

CREATE TABLE public.ape_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Ape Ride',
  livekit_room TEXT NOT NULL,
  host_lat DOUBLE PRECISION NOT NULL,
  host_lng DOUBLE PRECISION NOT NULL,
  status public.ape_ride_status NOT NULL DEFAULT 'live',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ape_rides_status ON public.ape_rides(status);
CREATE INDEX idx_ape_rides_host ON public.ape_rides(host_id);

CREATE TRIGGER trg_ape_rides_updated
  BEFORE UPDATE ON public.ape_rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ape_rides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verified users can view ape rides"
  ON public.ape_rides FOR SELECT TO authenticated
  USING (public.is_token_proof_verified(auth.uid()));

CREATE POLICY "Verified users can create their own rides"
  ON public.ape_rides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = host_id AND public.is_token_proof_verified(auth.uid()));

CREATE POLICY "Hosts or admins can update rides"
  ON public.ape_rides FOR UPDATE TO authenticated
  USING (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Hosts or admins can delete rides"
  ON public.ape_rides FOR DELETE TO authenticated
  USING (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- Pairing requests from remote viewers
CREATE TABLE public.ape_ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.ape_rides(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL,
  status public.ape_ride_request_status NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, viewer_id)
);

CREATE INDEX idx_ape_ride_requests_ride ON public.ape_ride_requests(ride_id);
CREATE INDEX idx_ape_ride_requests_viewer ON public.ape_ride_requests(viewer_id);

CREATE TRIGGER trg_ape_ride_requests_updated
  BEFORE UPDATE ON public.ape_ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ape_ride_requests ENABLE ROW LEVEL SECURITY;

-- Viewer sees their own requests; host sees all requests on their rides
CREATE POLICY "Viewer or host can read requests"
  ON public.ape_ride_requests FOR SELECT TO authenticated
  USING (
    auth.uid() = viewer_id
    OR EXISTS (SELECT 1 FROM public.ape_rides r WHERE r.id = ride_id AND r.host_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Verified viewers create requests"
  ON public.ape_ride_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = viewer_id AND public.is_token_proof_verified(auth.uid()));

-- Viewer can cancel; host can accept/decline
CREATE POLICY "Viewer or host can update requests"
  ON public.ape_ride_requests FOR UPDATE TO authenticated
  USING (
    auth.uid() = viewer_id
    OR EXISTS (SELECT 1 FROM public.ape_rides r WHERE r.id = ride_id AND r.host_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = viewer_id
    OR EXISTS (SELECT 1 FROM public.ape_rides r WHERE r.id = ride_id AND r.host_id = auth.uid())
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ape_rides;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ape_ride_requests;