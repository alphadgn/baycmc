/**
 * Validate that a URL is safe to fetch from server-side (SSRF guard).
 *
 * Rejects:
 * - non-HTTPS schemes (no http://, file://, ftp://, gopher://, etc.)
 * - localhost / loopback / link-local / private RFC1918 / cloud metadata
 *
 * Throws on invalid input. Returns the parsed URL on success.
 */
export function assertSafeHttpsUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (u.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed.");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("URL points to a private or internal address.");
  }
  return u;
}
