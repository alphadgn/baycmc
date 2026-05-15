-- Three-tier access model: lobby (signed-in), verified holder (BAYC/MAYC), lifer.
-- 1) Add is_verified_holder() as the new canonical helper; keep
--    is_token_proof_verified() as a wrapper for backward compatibility
--    so existing RLS policies keep evaluating without an interruption.

CREATE OR REPLACE FUNCTION public.is_verified_holder(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_verifications
    WHERE user_id = _user_id AND bayc_verified = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_token_proof_verified(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_verified_holder(_user_id);
$$;

REVOKE EXECUTE ON FUNCTION public.is_verified_holder(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_verified_holder(uuid) TO authenticated;

-- 2) Open SELECT on rooms to every authenticated user so the lobby can
--    render a locked-state preview. Writes/management still gated.
DROP POLICY IF EXISTS "Token-proof users can read token-proof rooms" ON public.rooms;
CREATE POLICY "Authenticated users can read rooms (locked preview)"
ON public.rooms
FOR SELECT
TO authenticated
USING (true);

-- 3) Open SELECT on profiles to every authenticated user (public directory).
--    Wallet address remains a column but the lobby queries don't select it.
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 4) Tighten posts / messages / likes / comments SELECT to verified holders.
--    Lobby members do not see the feed or main commons.
DROP POLICY IF EXISTS "Authenticated users can read main lobby messages" ON public.messages;
CREATE POLICY "Verified holders can read main lobby messages"
ON public.messages
FOR SELECT
TO authenticated
USING (public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can send own main lobby messages" ON public.messages;
CREATE POLICY "Verified holders can send own messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read main lobby posts" ON public.posts;
CREATE POLICY "Verified holders can read posts"
ON public.posts
FOR SELECT
TO authenticated
USING (public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can create own main lobby posts" ON public.posts;
CREATE POLICY "Verified holders can create own posts"
ON public.posts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read main lobby comments" ON public.post_comments;
CREATE POLICY "Verified holders can read comments"
ON public.post_comments
FOR SELECT
TO authenticated
USING (public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can create own main lobby comments" ON public.post_comments;
CREATE POLICY "Verified holders can create own comments"
ON public.post_comments
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read main lobby likes" ON public.post_likes;
CREATE POLICY "Verified holders can read likes"
ON public.post_likes
FOR SELECT
TO authenticated
USING (public.is_verified_holder(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can like as themselves" ON public.post_likes;
CREATE POLICY "Verified holders can like as themselves"
ON public.post_likes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_verified_holder(auth.uid()));