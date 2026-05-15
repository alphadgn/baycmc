-- Match existing pattern for SECURITY DEFINER helpers (is_lifer,
-- has_role, is_token_proof_verified): execute permission only via the
-- definer. The function still works inside RLS policies because Postgres
-- evaluates policies with the function's definer privileges.
REVOKE EXECUTE ON FUNCTION public.is_verified_holder(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_verified_holder(uuid) FROM anon, public;