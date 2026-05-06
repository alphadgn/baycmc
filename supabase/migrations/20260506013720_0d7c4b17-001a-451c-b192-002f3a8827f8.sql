
DROP POLICY IF EXISTS "Authenticated users can insert audit events" ON public.audit_logs;

CREATE TABLE IF NOT EXISTS public.ape_ride_locations (
  ride_id uuid PRIMARY KEY REFERENCES public.ape_rides(id) ON DELETE CASCADE,
  host_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ape_ride_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Host can read own ride location"
  ON public.ape_ride_locations FOR SELECT TO authenticated
  USING (host_id = auth.uid());

CREATE POLICY "Accepted viewers can read ride location"
  ON public.ape_ride_locations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ape_ride_requests r
      WHERE r.ride_id = ape_ride_locations.ride_id
        AND r.viewer_id = auth.uid()
        AND r.status = 'accepted'
    )
  );

ALTER TABLE public.ape_rides DROP COLUMN IF EXISTS host_lat;
ALTER TABLE public.ape_rides DROP COLUMN IF EXISTS host_lng;
