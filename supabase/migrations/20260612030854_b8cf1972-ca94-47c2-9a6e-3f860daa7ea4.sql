GRANT SELECT, INSERT, UPDATE, DELETE ON public.karaoke_sessions TO authenticated;
GRANT ALL ON public.karaoke_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.karaoke_queue TO authenticated;
GRANT ALL ON public.karaoke_queue TO service_role;

DROP POLICY IF EXISTS "karaoke_queue delete self or current performer" ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_queue delete for live room cleanup" ON public.karaoke_queue;

CREATE POLICY "karaoke_queue delete own entry"
  ON public.karaoke_queue FOR DELETE
  TO authenticated USING (user_id = auth.uid());