ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS linked_wallets text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS profiles_linked_wallets_gin
  ON public.profiles USING GIN (linked_wallets);