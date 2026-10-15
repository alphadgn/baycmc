/**
 * "0x1234…abcd" for display. Safe for accounts with no wallet (email
 * sign-ups have wallet_address = null) — returns the fallback instead of
 * throwing, which used to crash whole pages (e.g. Super Admin → Users).
 */
export function shortAddress(addr: string | null | undefined, fallback = "—"): string {
  if (!addr) return fallback;
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
