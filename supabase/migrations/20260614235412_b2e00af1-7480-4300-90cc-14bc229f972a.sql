
-- Account-collision merge decisions: one row per canonical pair of user ids.
CREATE TABLE public.account_merge_decisions (
  user_a_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision   text NOT NULL CHECK (decision IN ('merged','separate')),
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE INDEX account_merge_decisions_b_idx ON public.account_merge_decisions(user_b_id);

GRANT SELECT ON public.account_merge_decisions TO authenticated;
GRANT ALL ON public.account_merge_decisions TO service_role;

ALTER TABLE public.account_merge_decisions ENABLE ROW LEVEL SECURITY;

-- Users see only decisions involving their own account. Admins see all.
CREATE POLICY "Users see their own merge decisions"
  ON public.account_merge_decisions FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Only super_admin can directly delete (re-open the prompt for a pair).
CREATE POLICY "Super admins can reset merge decisions"
  ON public.account_merge_decisions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Inserts/updates happen via service_role inside server functions only.
