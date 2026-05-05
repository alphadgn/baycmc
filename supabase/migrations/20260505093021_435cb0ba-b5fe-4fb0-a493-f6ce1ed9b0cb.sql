
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_token_proof_verified(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_lifer(uuid) FROM authenticated;
