DROP POLICY IF EXISTS "Token-proof users create posts" ON public.posts;
DROP POLICY IF EXISTS "Token-proof users read posts" ON public.posts;
DROP POLICY IF EXISTS "Token-proof users comment" ON public.post_comments;
DROP POLICY IF EXISTS "Token-proof users read comments" ON public.post_comments;
DROP POLICY IF EXISTS "Token-proof users like" ON public.post_likes;
DROP POLICY IF EXISTS "Token-proof users read likes" ON public.post_likes;
DROP POLICY IF EXISTS "Verified users can post messages" ON public.messages;
DROP POLICY IF EXISTS "Verified users can read messages" ON public.messages;

CREATE POLICY "Authenticated users can create own main lobby posts"
ON public.posts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can read main lobby posts"
ON public.posts
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create own main lobby comments"
ON public.post_comments
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can read main lobby comments"
ON public.post_comments
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can like as themselves"
ON public.post_likes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can read main lobby likes"
ON public.post_likes
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can send own main lobby messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can read main lobby messages"
ON public.messages
FOR SELECT
TO authenticated
USING (true);