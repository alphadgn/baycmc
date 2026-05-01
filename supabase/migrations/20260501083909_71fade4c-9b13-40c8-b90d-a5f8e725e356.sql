-- App-wide settings (admin-configurable)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Settings readable by authenticated"
ON public.app_settings FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Super admins can insert settings"
ON public.app_settings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can update settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER app_settings_set_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Otherpage gating row (empty contract; admin fills in later)
INSERT INTO public.app_settings (key, value)
VALUES ('otherpage_gate', '{"contract": null, "min_balance": 1, "chain_id": 1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Track which Otherpage token ids a user owns (optional, for richer gating)
ALTER TABLE public.user_verifications
  ADD COLUMN IF NOT EXISTS otherpage_token_ids INTEGER[] NOT NULL DEFAULT '{}'::integer[];
