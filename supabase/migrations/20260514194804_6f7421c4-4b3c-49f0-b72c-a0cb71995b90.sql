CREATE OR REPLACE FUNCTION public.is_token_proof_verified(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_verifications
    WHERE user_id = _user_id AND bayc_verified = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_lifer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_verifications
    WHERE user_id = _user_id
      AND bayc_verified = true
      AND otherpage_verified = true
  );
$$;