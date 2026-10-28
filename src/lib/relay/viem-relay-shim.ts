/**
 * viem, as seen by the Relay swap widget (@relayprotocol/*). Wired in by
 * vite.config.ts for imports coming from Relay's packages only.
 *
 * Relay's SwapWidget converts the amount box with parseUnits() on every
 * render, including while the box is empty. Older viem returned 0 for "";
 * current viem throws "Value `` is not a valid decimal number.", which
 * crashed the whole My activity page. Anything that isn't a complete
 * number yet ("", ".", "-", " 1", "1,5") is read as 0 here, so the widget
 * simply shows no quote until a real amount is typed.
 */
import { parseUnits as viemParseUnits, parseEther as viemParseEther } from "viem";

export * from "viem";

function normalizeAmount(value: unknown): string {
  const v = typeof value === "string" ? value.trim().replace(/,/g, ".") : String(value ?? "");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(v) ? v : "0";
}

export function parseUnits(value: string, decimals: number): bigint {
  return viemParseUnits(normalizeAmount(value), decimals);
}

export function parseEther(value: string, unit?: "wei" | "gwei"): bigint {
  return viemParseEther(normalizeAmount(value), unit);
}
