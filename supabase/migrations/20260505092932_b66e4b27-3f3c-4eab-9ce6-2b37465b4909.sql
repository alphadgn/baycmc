
-- 1. user_verifications: prevent self-grant + restrict reads to own row
DROP POLICY IF EXISTS "Users can manage their own verifications" ON public.user_verifications;
DROP POLICY IF EXISTS "Verifications viewable by authenticated" ON public.user_verifications;

CREATE POLICY "Users can view their own verification"
  ON public.user_verifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for end-users. Writes happen via service-role server fns.

-- 2. profiles: hide wallet_address from other users
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Public view exposing only non-sensitive columns
CREATE OR REPLACE VIEW public.public_profiles
  WITH (security_invoker = true) AS
  SELECT id, username, avatar_url, bio, created_at, updated_at
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- 3. notifications: restrict INSERT to own user_id
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;

CREATE POLICY "Users can insert notifications for themselves"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 4. Revoke EXECUTE on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_token_proof_verified(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_lifer(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, uuid, jsonb) FROM anon, authenticated, public;
