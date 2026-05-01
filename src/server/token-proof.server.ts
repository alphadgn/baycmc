// Server-only Token Proof gate.
//
// Every gated server action must call `requireTokenProof(...)` before doing
// anything privileged. The check is a fresh on-chain `balanceOf` against the
// requested contract, with a short-lived in-process cache to keep RPC load
// bounded. The cache stores BOTH positive and negative results, but with
// short TTLs so revocations propagate quickly.
//
// SECURITY:
//   - The cache is keyed by (chainId, contract, wallet). Wallet must be
//     checksummed by the caller — pass only addresses that came from a SIWE
//     signature this session, never from request bodies untouched.
//   - On any RPC error we DENY (fail-closed). Never return verified=true
//     when the chain call failed.
//   - `invalidateTokenProof` lets callers bust the cache (e.g. when a user
//     claims they just minted/transferred and we want a fresh look).
import { createPublicClient, getAddress, http, parseAbi, type Address } from "viem";
import { mainnet } from "viem/chains";
import { ETH_RPC_URL } from "@/lib/web3/constants";

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const POSITIVE_TTL_MS = 60_000; // 1 min — verified holders re-checked often enough
const NEGATIVE_TTL_MS = 15_000; // 15s  — non-holders re-checked very quickly

interface CacheEntry {
  balance: bigint;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function key(chainId: number, contract: string, wallet: string): string {
  return `${chainId}:${contract.toLowerCase()}:${wallet.toLowerCase()}`;
}

let _client: ReturnType<typeof createPublicClient> | null = null;
function client() {
  if (!_client) {
    _client = createPublicClient({ chain: mainnet, transport: http(ETH_RPC_URL) });
  }
  return _client;
}

export interface TokenProofResult {
  verified: boolean;
  balance: number;
  cached: boolean;
  reason?: string;
}

/**
 * Fresh on-chain `balanceOf` check, with short-lived caching.
 *
 * Returns `{ verified: true }` only when the wallet currently holds at least
 * `minBalance` tokens of the contract on the given chain. RPC errors and
 * insufficient balance both return `verified: false`.
 */
export async function requireTokenProof(args: {
  wallet: string;
  contract: string;
  minBalance?: number;
  chainId?: number;
}): Promise<TokenProofResult> {
  const minBalance = BigInt(args.minBalance ?? 1);
  const chainId = args.chainId ?? 1;

  let wallet: Address;
  let contract: Address;
  try {
    wallet = getAddress(args.wallet);
    contract = getAddress(args.contract);
  } catch {
    return { verified: false, balance: 0, cached: false, reason: "Invalid address" };
  }

  const k = key(chainId, contract, wallet);
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) {
    const verified = hit.balance >= minBalance;
    return { verified, balance: Number(hit.balance), cached: true };
  }

  let balance: bigint;
  try {
    balance = (await client().readContract({
      address: contract,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [wallet],
    })) as bigint;
  } catch (e) {
    console.error("[token-proof] balanceOf failed", { contract, wallet, error: e });
    // Fail-closed: do NOT cache RPC failures so the next request retries.
    return { verified: false, balance: 0, cached: false, reason: "RPC error" };
  }

  const verified = balance >= minBalance;
  cache.set(k, {
    balance,
    expiresAt: now + (verified ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return { verified, balance: Number(balance), cached: false };
}

export function invalidateTokenProof(args: {
  wallet: string;
  contract: string;
  chainId?: number;
}): void {
  try {
    const wallet = getAddress(args.wallet);
    const contract = getAddress(args.contract);
    cache.delete(key(args.chainId ?? 1, contract, wallet));
  } catch {
    // ignore — invalid input simply has nothing to invalidate
  }
}

// Test seam — only used by unit tests.
export function __resetTokenProofCacheForTests() {
  cache.clear();
}
