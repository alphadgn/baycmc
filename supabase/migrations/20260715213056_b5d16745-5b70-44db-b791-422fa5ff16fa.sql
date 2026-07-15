
CREATE TABLE IF NOT EXISTS public.security_scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  category text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_scan_findings TO authenticated;
GRANT ALL ON public.security_scan_findings TO service_role;

ALTER TABLE public.security_scan_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view findings"
  ON public.security_scan_findings
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE INDEX IF NOT EXISTS security_scan_findings_created_at_idx
  ON public.security_scan_findings (created_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
