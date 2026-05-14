/**
 * Local cache of the user's verified session.
 *
 * The canonical truth lives in Supabase (`user_verifications`), but caching
 * the verified state in localStorage lets the header render the wallet pill
 * immediately on page load — no flash of the "Entrance" button while the
 * Supabase session and verifications are still loading. Cached data is
 * scoped by wallet address and expires after VERIFY_TTL_MS.
 */

export interface VerifiedSession {
  address: string;
  collection: "BAYC" | "MAYC" | null;
  verifiedAt: number;
}

const KEY = "bayc_verified_session";
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function readVerifiedSession(): VerifiedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifiedSession;
    if (!parsed?.address || typeof parsed.verifiedAt !== "number") return null;
    if (Date.now() - parsed.verifiedAt > VERIFY_TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeVerifiedSession(session: VerifiedSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // ignore quota/private-mode errors
  }
}

export function clearVerifiedSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
