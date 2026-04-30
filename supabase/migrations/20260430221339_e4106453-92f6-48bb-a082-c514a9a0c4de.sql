
-- Lock down auth_nonces: no one accesses it via PostgREST
CREATE POLICY "Nonces are server-only - no access"
  ON public.auth_nonces FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- Recreate set_updated_at with locked search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Revoke broad EXECUTE on SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
