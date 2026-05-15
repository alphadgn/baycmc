-- Lobby users must be able to edit their own profile.
--
-- Migration 20260514195102 added `is_token_proof_verified(auth.uid())` to
-- the profiles INSERT and UPDATE policies, which silently dropped writes
-- from any signed-in user who hadn't yet verified BAYC/MAYC. That's the
-- opposite of the tiering spec — username, bio, and avatar are baseline
-- profile fields available to every signed-in user. Only gated content
-- (conference rooms, feed posts, lifer chat) sits behind token-proof.
--
-- This migration drops the verified-only profile write policies and
-- restores the original "users can edit their own profile" policies.

DROP POLICY IF EXISTS "Verified users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Verified users can update their own profile" ON public.profiles;
-- Belt-and-suspenders: drop any legacy variants that may still exist.
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
