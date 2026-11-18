/**
 * Client-side throttle for the verified-route ownership recompute. Each
 * recompute re-scans every wallet on-chain; doing it on EVERY navigation cost
 * 3-4 round trips per click. Within the TTL the database row written by the
 * last recompute is trusted (server functions and RLS still enforce access).
 */
export const OWNERSHIP_REVALIDATE_TTL_MS = 60_000;

const last = new Map<string, number>();

export function ownershipRecheckDue(userId: string, now = Date.now()): boolean {
  const at = last.get(userId);
  return at === undefined || now - at >= OWNERSHIP_REVALIDATE_TTL_MS;
}

export function markOwnershipRechecked(userId: string, now = Date.now()): void {
  last.set(userId, now);
}

/** Forget cached checks (sign-out, wallet change, explicit refresh). */
export function resetOwnershipRecheck(userId?: string): void {
  if (userId) last.delete(userId);
  else last.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("baycmc:verification-refresh", () => resetOwnershipRecheck());
}
