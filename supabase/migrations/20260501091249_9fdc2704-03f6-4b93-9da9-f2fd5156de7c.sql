-- Helper: is the user verified via Token Proof (BAYC)?
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

-- Helper: is the user a Lifer (Token Proof AND Otherpage)?
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

-- Main messages thread (Token Proof verified users)
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verified users can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_token_proof_verified(auth.uid()));

CREATE POLICY "Verified users can post messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_token_proof_verified(auth.uid()));

CREATE POLICY "Authors can update own messages"
  ON public.messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authors can delete own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX messages_created_at_idx ON public.messages (created_at DESC);

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lifer messages thread (dual-verified only)
CREATE TABLE public.lifer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lifer_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lifers can read lifer messages"
  ON public.lifer_messages FOR SELECT TO authenticated
  USING (public.is_lifer(auth.uid()));

CREATE POLICY "Lifers can post lifer messages"
  ON public.lifer_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_lifer(auth.uid()));

CREATE POLICY "Lifer authors can update own"
  ON public.lifer_messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.is_lifer(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_lifer(auth.uid()));

CREATE POLICY "Lifer authors can delete own"
  ON public.lifer_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.is_lifer(auth.uid()));

CREATE INDEX lifer_messages_created_at_idx ON public.lifer_messages (created_at DESC);

CREATE TRIGGER lifer_messages_set_updated_at
  BEFORE UPDATE ON public.lifer_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lifer_messages;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.lifer_messages REPLICA IDENTITY FULL;