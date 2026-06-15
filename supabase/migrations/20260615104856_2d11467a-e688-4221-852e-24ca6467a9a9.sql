
CREATE TABLE public.linked_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address text NOT NULL,
  label text,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linked_wallets_address_format CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT linked_wallets_unique_per_user UNIQUE (user_id, address)
);

CREATE INDEX linked_wallets_user_id_idx ON public.linked_wallets(user_id);
CREATE INDEX linked_wallets_address_idx ON public.linked_wallets(lower(address));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.linked_wallets TO authenticated;
GRANT ALL ON public.linked_wallets TO service_role;

ALTER TABLE public.linked_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own linked wallets"
  ON public.linked_wallets FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Users insert own linked wallets"
  ON public.linked_wallets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own linked wallets"
  ON public.linked_wallets FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own linked wallets"
  ON public.linked_wallets FOR DELETE TO authenticated
  USING (user_id = auth.uid());
