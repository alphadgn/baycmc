/**
 * Per-Worker-invocation memo for balanceOf reads. 60s TTL.
 *
 * Workers are short-lived so this is effectively a request-burst dedupe
 * (e.g. parallel `_verified` beforeLoad + livekit gate firing in the same
 * tick). The persisted source of truth remains `user_verifications`.
 */
const TTL_MS = 60_000;

type Entry = { value: bigint; expires: number };
const memo = new Map<string, Entry>();

function key(wallet: string, contract: string, block: bigint) {
  return `${wallet.toLowerCase()}:${contract.toLowerCase()}:${block.toString()}`;
}

export function getBalance(wallet: string, contract: string, block: bigint): bigint | null {
  const k = key(wallet, contract, block);
  const hit = memo.get(k);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memo.delete(k);
    return null;
  }
  return hit.value;
}

export function setBalance(wallet: string, contract: string, block: bigint, value: bigint) {
  memo.set(key(wallet, contract, block), { value, expires: Date.now() + TTL_MS });
  if (memo.size > 2000) {
    // Trim oldest ~25% to bound memory.
    const cutoff = Date.now();
    for (const [k, v] of memo) {
      if (v.expires < cutoff) memo.delete(k);
      if (memo.size <= 1500) break;
    }
  }
}
