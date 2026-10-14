-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening + email-account fixes (Oct 2026 audit)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Every auth user gets a profile row. Email/password and Glyph-email
--    sign-ups previously had NO profile (only the wallet server fn created
--    one), so their names rendered as raw ids in the lobby, chat and karaoke
--    queue and profile-dependent features silently failed.
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill existing accounts that never got a profile.
INSERT INTO public.profiles (id, username)
SELECT u.id, NULL FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2. Search-cache poisoning: any signed-in user could INSERT/UPDATE cached
--    "karaoke" search results (arbitrary URLs served to every other user).
--    The server fn writes with the service role, so clients need read only.
DROP POLICY IF EXISTS "karaoke_search_cache insert auth" ON public.karaoke_search_cache;
DROP POLICY IF EXISTS "karaoke_search_cache update auth" ON public.karaoke_search_cache;
REVOKE INSERT, UPDATE, DELETE ON public.karaoke_search_cache FROM authenticated, anon;
GRANT ALL ON public.karaoke_search_cache TO service_role;

-- 3. SIWE nonces are now server-issued (see getSiweNonce). Keep the table
--    lean and unreadable from the client.
ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_nonces FROM anon, authenticated;
GRANT ALL ON public.auth_nonces TO service_role;
CREATE INDEX IF NOT EXISTS auth_nonces_unconsumed_idx
  ON public.auth_nonces (nonce) WHERE consumed = false;

CREATE OR REPLACE FUNCTION public.purge_expired_auth_nonces()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.auth_nonces WHERE expires_at < now() - interval '1 day' RETURNING 1)
  SELECT count(*)::int FROM d
$$;
REVOKE ALL ON FUNCTION public.purge_expired_auth_nonces() FROM PUBLIC, anon, authenticated;

-- 4. Fast wallet → account lookup (replaces listUsers(perPage:1000), which
--    stopped finding returning wallets once the club passed 1,000 accounts).
CREATE INDEX IF NOT EXISTS profiles_wallet_lower_idx ON public.profiles (lower(wallet_address));
