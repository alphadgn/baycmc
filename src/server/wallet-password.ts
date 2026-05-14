/**
 * Derive a Supabase auth password for a wallet-based user.
 *
 * Uses SHA-256 over the full SUPABASE_SERVICE_ROLE_KEY (not a 16-char prefix)
 * concatenated with the lowercase wallet address. The key is never bundled
 * to the client, so this stays a server-side derivation.
 *
 * Even if the service-role key leaks, this just becomes a long random
 * password — but anyone with the service-role key can already mint sessions
 * directly via admin APIs, so the leak is the actual incident.
 */
export async function deriveWalletPassword(wallet: string): Promise<string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  const data = new TextEncoder().encode(`baycmc:v2:${wallet.toLowerCase()}:${key}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
