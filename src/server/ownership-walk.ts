/**
 * Pure on-chain holdings walk used by `verifyOwnership` (wallet.functions.ts).
 *
 * Extracted so we can unit-test every linked-wallet + delegate.cash edge case
 * without needing SIWE / Supabase. The functions here all take a viem
 * PublicClient (or a structural duck-type of one), so tests can pass a mock
 * client that returns canned `readContract` results.
 *
 * The walk order intentionally mirrors `verifyOwnership` so the contract
 * stays in lockstep with the production code path:
 *
 *   1. balanceOf(BAYC) + balanceOf(MAYC) on the signer wallet
 *   2. if zero → check every delegate.cash v2 vault that delegated to the signer
 *   3. if still zero → walk every Glyph-linked wallet (skipping the signer
 *      itself, deduping, and skipping non-EVM addresses)
 *   4. for each linked wallet, also walk its own incoming delegate.cash vaults
 *
 * As soon as one path yields a positive balance we short-circuit and return
 * with the matching `delegatedFrom` / `linkedHolder` set so the caller can
 * surface a faithful `verificationBasis`.
 */
import { type PublicClient, getAddress, parseAbi, isAddress } from "viem";
import { DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";

export const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;
export const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

export const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export const delegateRegistryAbi = parseAbi([
  "struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }",
  "function getIncomingDelegations(address to) view returns (Delegation[])",
]);

// Reasonable per-call timeouts — production callers wrap the full walk in
// their own timeout too, but these prevent a single hung RPC from blocking
// the whole orchestration.
const BALANCE_TIMEOUT_MS = 8_000;
const DELEGATION_TIMEOUT_MS = 6_000;

const POSITIVE_BALANCE_TTL_MS = 60_000;
const ZERO_BALANCE_TTL_MS = 15_000;
const DELEGATION_TTL_MS = 30_000;

type BalancePair = { bayc: bigint; mayc: bigint };
type BalanceCacheEntry = BalancePair & { expiresAt: number };
type DelegationCacheEntry = { vaults: `0x${string}`[]; expiresAt: number };

const balanceCache = new Map<string, BalanceCacheEntry>();
const delegationCache = new Map<string, DelegationCacheEntry>();

/** Test-only: wipe the in-memory caches so each test starts clean. */
export function __resetOwnershipCachesForTests() {
  balanceCache.clear();
  delegationCache.clear();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Minimal structural shape of viem's PublicClient that we use. Lets tests
 * pass a tiny mock without re-implementing the full client.
 */
export type OwnershipClient = Pick<PublicClient, "readContract">;

export async function balancesFor(
  c: OwnershipClient,
  owner: `0x${string}`,
): Promise<BalancePair> {
  const now = Date.now();
  const key = `1:${owner.toLowerCase()}:bayc-mayc`;
  const hit = balanceCache.get(key);
  if (hit && hit.expiresAt > now) return { bayc: hit.bayc, mayc: hit.mayc };

  const [bayc, mayc] = await withTimeout(
    Promise.all([
      c.readContract({
        address: BAYC,
        abi: erc721Abi,
        functionName: "balanceOf",
        args: [owner],
      }) as Promise<bigint>,
      c.readContract({
        address: MAYC,
        abi: erc721Abi,
        functionName: "balanceOf",
        args: [owner],
      }) as Promise<bigint>,
    ]),
    BALANCE_TIMEOUT_MS,
    `balanceOf BAYC/MAYC for ${owner}`,
  );

  const positive = bayc > 0n || mayc > 0n;
  balanceCache.set(key, {
    bayc,
    mayc,
    expiresAt: now + (positive ? POSITIVE_BALANCE_TTL_MS : ZERO_BALANCE_TTL_MS),
  });
  return { bayc, mayc };
}

/**
 * Resolve every delegate.cash v2 vault that has delegated full or
 * BAYC/MAYC-scoped authority (with no rights restrictions) to `signer`.
 */
export async function resolveDelegatedVaults(
  c: OwnershipClient,
  signer: `0x${string}`,
): Promise<`0x${string}`[]> {
  const now = Date.now();
  const key = `1:${signer.toLowerCase()}:incoming-delegations-v2`;
  const hit = delegationCache.get(key);
  if (hit && hit.expiresAt > now) return hit.vaults;

  try {
    const delegations = (await withTimeout(
      c.readContract({
        address: DELEGATE_REGISTRY_V2,
        abi: delegateRegistryAbi,
        functionName: "getIncomingDelegations",
        args: [signer],
      }),
      DELEGATION_TIMEOUT_MS,
      "getIncomingDelegations",
    )) as ReadonlyArray<{
      type_: number;
      to: `0x${string}`;
      from: `0x${string}`;
      rights: `0x${string}`;
      contract_: `0x${string}`;
      tokenId: bigint;
      amount: bigint;
    }>;

    const vaults = new Set<string>();
    for (const d of delegations) {
      const noRights =
        d.rights === "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (!noRights) continue;

      // ALL → entire wallet delegated.
      if (d.type_ === 1) {
        vaults.add(getAddress(d.from));
        continue;
      }
      // CONTRACT or ERC721 scoped to BAYC/MAYC.
      if (d.type_ === 2 || d.type_ === 3) {
        const c_ = d.contract_.toLowerCase();
        if (c_ === BAYC.toLowerCase() || c_ === MAYC.toLowerCase()) {
          vaults.add(getAddress(d.from));
        }
      }
    }

    const resolved = [...vaults] as `0x${string}`[];
    delegationCache.set(key, { vaults: resolved, expiresAt: now + DELEGATION_TTL_MS });
    return resolved;
  } catch (e) {
    // Swallow + log — delegation lookup is non-fatal for entry.
    console.error("delegate.cash lookup failed", e);
    return [];
  }
}

export interface WalkResult {
  /** True if at least one path yielded BAYC or MAYC. */
  holdsApe: boolean;
  totalBayc: bigint;
  totalMayc: bigint;
  /** delegate.cash vault that owned the qualifying tokens, if any. */
  delegatedFrom: `0x${string}` | null;
  /** Glyph-linked wallet (or vault delegating to one) that qualified, if any. */
  linkedHolder: `0x${string}` | null;
  /** Verification basis the caller should surface to the client. */
  basis: "direct" | "delegated" | "linked";
  /** Number of delegate.cash vaults inspected for the signer (for telemetry). */
  vaultsChecked: number;
  /** Number of Glyph-linked wallets we actually walked (post-dedupe). */
  linkedChecked: number;
}

export interface WalkInput {
  signer: `0x${string}`;
  linkedWallets?: readonly string[];
}

/**
 * Walk the signer, its delegate.cash vaults, then every Glyph-linked wallet
 * (and each linked wallet's incoming delegations) until BAYC/MAYC is found.
 *
 * Throws if the signer's `balanceOf` call fails — this is intentional, since
 * the caller has nothing to verify if the primary on-chain check is hosed.
 * Delegation lookups and linked-wallet walks are best-effort and fail open.
 */
export async function walkOwnership(c: OwnershipClient, input: WalkInput): Promise<WalkResult> {
  const signerBals = await balancesFor(c, input.signer);

  let totalBayc = signerBals.bayc;
  let totalMayc = signerBals.mayc;
  let delegatedFrom: `0x${string}` | null = null;
  let linkedHolder: `0x${string}` | null = null;

  // Direct hit — short-circuit before any delegation / linked walks.
  if (totalBayc > 0n || totalMayc > 0n) {
    return {
      holdsApe: true,
      totalBayc,
      totalMayc,
      delegatedFrom,
      linkedHolder,
      basis: "direct",
      vaultsChecked: 0,
      linkedChecked: 0,
    };
  }

  // delegate.cash vaults that delegated to the signer.
  const vaults = await resolveDelegatedVaults(c, input.signer).catch(
    () => [] as `0x${string}`[],
  );

  for (const v of vaults) {
    try {
      const b = await balancesFor(c, v);
      if (b.bayc > 0n || b.mayc > 0n) {
        totalBayc += b.bayc;
        totalMayc += b.mayc;
        delegatedFrom = v;
        return {
          holdsApe: true,
          totalBayc,
          totalMayc,
          delegatedFrom,
          linkedHolder: null,
          basis: "delegated",
          vaultsChecked: vaults.length,
          linkedChecked: 0,
        };
      }
    } catch (e) {
      console.error("balanceOf vault failed", v, e);
    }
  }

  // Dedupe linked wallets: skip non-EVM, skip the signer itself, skip dupes.
  const lowerSigner = input.signer.toLowerCase();
  const linkedAddrs: `0x${string}`[] = [];
  for (const raw of input.linkedWallets ?? []) {
    if (typeof raw !== "string" || !isAddress(raw)) continue;
    const addr = getAddress(raw) as `0x${string}`;
    if (addr.toLowerCase() === lowerSigner) continue;
    if (linkedAddrs.some((a) => a.toLowerCase() === addr.toLowerCase())) continue;
    linkedAddrs.push(addr);
  }

  for (const linked of linkedAddrs) {
    try {
      const b = await balancesFor(c, linked);
      if (b.bayc > 0n || b.mayc > 0n) {
        totalBayc += b.bayc;
        totalMayc += b.mayc;
        linkedHolder = linked;
        return {
          holdsApe: true,
          totalBayc,
          totalMayc,
          delegatedFrom: null,
          linkedHolder,
          basis: "linked",
          vaultsChecked: vaults.length,
          linkedChecked: linkedAddrs.length,
        };
      }
      const linkedVaults = await resolveDelegatedVaults(c, linked).catch(
        () => [] as `0x${string}`[],
      );
      for (const v of linkedVaults) {
        try {
          const vb = await balancesFor(c, v);
          if (vb.bayc > 0n || vb.mayc > 0n) {
            totalBayc += vb.bayc;
            totalMayc += vb.mayc;
            return {
              holdsApe: true,
              totalBayc,
              totalMayc,
              delegatedFrom: v,
              linkedHolder: linked,
              basis: "linked",
              vaultsChecked: vaults.length,
              linkedChecked: linkedAddrs.length,
            };
          }
        } catch (e) {
          console.error("balanceOf linked-vault failed", v, e);
        }
      }
    } catch (e) {
      console.error("balanceOf linked wallet failed", linked, e);
    }
  }

  return {
    holdsApe: false,
    totalBayc,
    totalMayc,
    delegatedFrom: null,
    linkedHolder: null,
    basis: "direct",
    vaultsChecked: vaults.length,
    linkedChecked: linkedAddrs.length,
  };
}
