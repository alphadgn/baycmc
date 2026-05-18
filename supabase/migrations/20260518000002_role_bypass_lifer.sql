-- =========================================================
-- Admins and super_admins bypass the Lifer gate.
-- =========================================================
-- `is_verified_holder()` already bypasses (migration 20260517211938) and
-- `is_token_proof_verified()` wraps it. The Lifer helper was the last gate
-- that still required a real on-chain Otherpage token for everyone.
--
-- Policy decision: admins administer the clubhouse, so they need to see
-- every room, every channel, every feature without holding BAYC/Lifer
-- tokens themselves. The `verified_user` role is NOT granted lifer access
-- (only BAYC access via is_verified_holder).

CREATE OR REPLACE FUNCTION public.is_lifer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_verifications
      WHERE user_id = _user_id
        AND bayc_verified = true
        AND otherpage_verified = true
    )
    OR public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'super_admin'::app_role);
$$;
