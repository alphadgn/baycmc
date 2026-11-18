/** SIWE domains this deployment accepts (SITE_DOMAIN may be a comma-separated list). */
export function acceptedSiweDomains(
  siteDomain: string | undefined,
  requestHost: string | null,
  browserHost: string | null,
): Set<string> {
  const configured = (siteDomain ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const out = new Set(configured);
  if (requestHost) out.add(requestHost.toLowerCase());
  // Legacy: without SITE_DOMAIN the Origin/Referer host is the only way to learn the
  // browser-visible host behind a proxy. It's attacker-influenced, so it's accepted
  // ONLY when SITE_DOMAIN is unset (with a warning). Set SITE_DOMAIN in production.
  if (configured.length === 0 && browserHost) out.add(browserHost.toLowerCase());
  return out;
}

/** Email domain reserved for server-minted wallet accounts; never valid for sign-up. */
export const WALLET_ACCOUNT_EMAIL_DOMAIN = "wallet.baycmc.local";

export function isReservedWalletEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return (
    domain === WALLET_ACCOUNT_EMAIL_DOMAIN || domain.endsWith(`.${WALLET_ACCOUNT_EMAIL_DOMAIN}`)
  );
}
