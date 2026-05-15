-- Restore EXECUTE on SECURITY DEFINER role/verification helper functions.
--
-- A prior migration (20260505093021) revoked EXECUTE from `authenticated`
-- under the assumption that SECURITY DEFINER lets RLS policies still call
-- the function on the user's behalf. That's not how Postgres works:
-- SECURITY DEFINER only changes WHICH privileges run INSIDE the function
-- body — the *caller* (authenticated, when the row is being read on
-- behalf of an authenticated user) still needs EXECUTE on the function
-- itself, otherwise every policy that references it errors with:
--   `permission denied for function has_role`
--
-- This bricked every authenticated read whose RLS policy calls
-- has_role(), is_token_proof_verified(), is_lifer(), or
-- is_verified_holder() — including the profile page query against
-- user_roles.
--
-- anon stays without EXECUTE — these helpers should never run for
-- unauthenticated traffic.

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_token_proof_verified(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_lifer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_holder(uuid) TO authenticated;
