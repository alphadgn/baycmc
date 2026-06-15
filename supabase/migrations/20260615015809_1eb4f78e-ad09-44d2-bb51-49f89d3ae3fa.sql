-- Replace the always-true write policies on karaoke_sessions with
-- performer/host/admin-scoped ones. Surfaced by the Supabase linter
-- (rule 0024_permissive_rls_policy).
DROP POLICY IF EXISTS "karaoke_sessions insert for authenticated" ON public.karaoke_sessions;
DROP POLICY IF EXISTS "karaoke_sessions update for authenticated" ON public.karaoke_sessions;

CREATE POLICY "karaoke_sessions insert by performer or host"
  ON public.karaoke_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    performer_user_id = auth.uid()
    OR public.is_room_host(room_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "karaoke_sessions update by performer or host"
  ON public.karaoke_sessions
  FOR UPDATE
  TO authenticated
  USING (
    performer_user_id = auth.uid()
    OR public.is_room_host(room_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    performer_user_id = auth.uid()
    OR public.is_room_host(room_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );