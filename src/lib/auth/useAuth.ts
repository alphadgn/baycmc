import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { clearWalletAuthLocalState } from "@/lib/auth/useGlyphBridge";

export type AppRole = "super_admin" | "admin" | "verified_user" | "chapter_leader";

export interface Profile {
  id: string;
  wallet_address: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
}

export interface Verifications {
  bayc_verified: boolean;
  lumina_verified: boolean;
  delegation_verified: boolean;
  otherpage_verified: boolean;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user, loading, isAuthenticated: !!session };
}

/**
 * Full sign-out. Matches the inactivity-timeout teardown so the next
 * visit must go through the Glyph modal from scratch.
 *
 *   1. Supabase sign-out — drops the API session.
 *   2. Dispatch `baycmc:wallet-logout` — the GlyphBridge handles this
 *      from inside Glyph's React context and calls its `logout()`.
 *   3. Wipe persisted Glyph + verify-cache state from local/sessionStorage.
 *
 * Skipping (2) or (3) would let Glyph's persisted session silently
 * re-authenticate the user on next visit without the modal.
 */
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("[signOut] supabase signOut failed", e);
  }
  try {
    window.dispatchEvent(new Event("baycmc:wallet-logout"));
  } catch {
    /* noop */
  }
  clearWalletAuthLocalState();
}
