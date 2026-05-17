
DO $$ BEGIN
  CREATE TYPE public.chapter_submission_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.chapter_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  chapter_name TEXT NOT NULL,
  city TEXT,
  region TEXT,
  pitch TEXT,
  status public.chapter_submission_status NOT NULL DEFAULT 'pending',
  reviewer_id UUID,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chapter_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own submission" ON public.chapter_submissions;
CREATE POLICY "Users insert own submission" ON public.chapter_submissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own submission" ON public.chapter_submissions;
CREATE POLICY "Users read own submission" ON public.chapter_submissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins update submissions" ON public.chapter_submissions;
CREATE POLICY "Admins update submissions" ON public.chapter_submissions
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

DROP TRIGGER IF EXISTS set_chapter_submissions_updated_at ON public.chapter_submissions;
CREATE TRIGGER set_chapter_submissions_updated_at
  BEFORE UPDATE ON public.chapter_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS chapter_submissions_status_idx ON public.chapter_submissions(status, created_at DESC);
