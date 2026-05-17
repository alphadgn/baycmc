CREATE OR REPLACE FUNCTION public.is_verified_holder(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_verifications
      WHERE user_id = _user_id AND bayc_verified = true
    )
    OR public.has_role(_user_id, 'verified_user'::app_role)
    OR public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'super_admin'::app_role);
$function$;