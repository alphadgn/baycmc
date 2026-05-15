import { createPublicClient, http, getAddress, parseAbi, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";
import { runOtherpageCheckAndPersist } from "@/server/otherpage.server";
import { runLuminaCheckAndPersist } from "@/server/lumina.server";

/**
 * Centralized ownership recomputation.
 *
 * Runs a fresh on-chain BAYC/MAYC balanceOf for the user's connected wallet
 * AND walks delegate.cash v2 incoming delegations, updating
 * `user_verifications` with the latest truth. Used by:
 *   - `revalidateOwnership` server fn (manual / hook-driven refresh)
 *   - `getLivekitToken` (real-time gate check on room entry)
 *   - any future cron / webhook re-verification flow
 *
 * Cache TTL is short so revoked delegations are reflected within ~30s.
 */

const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;
const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const delegateRegistryAbi = parseAbi([
  "struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }",
  "function getIncomingDelegations(address to) view returns (Delegation[])",
]);

function publicClient() {
  return createPublicClient({ chain: mainnet, transport: http(ethRpcUrl(), { timeout: 8_000, retryCount: 1 }) });
}

function ethRpcUrl() {
  const url = process.env.ETH_RPC_URL;
  if (!url) {
    throw new Error("Ethereum RPC is not configured.");
  }
  return url;
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

async function balancesFor(c: ReturnType<typeof publicClient>, owner: `0x${string}`) {
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
    8_000,
    `balanceOf BAYC/MAYC for ${owner}`,
  );
  return { bayc, mayc };
}

async function resolveDelegatedVaults(
  c: ReturnType<typeof publicClient>,
  signer: `0x${string}`,
): Promise<`0x${string}`[]> {
  try {
    const delegations = (await withTimeout(
      c.readContract({
        address: DELEGATE_REGISTRY_V2,
        abi: delegateRegistryAbi,
        functionName: "getIncomingDelegations",
        args: [signer],
      }),
      6_000,
      "getIncomingDelegations",
    )) as ReadonlyArray<{
      type_: number;
      from: `0x${string}`;
      rights: `0x${string}`;
      contract_: `0x${string}`;
    }>;

    const vaults = new Set<string>();
    for (const d of delegations) {
      const noRights =
        d.rights ===
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (!noRights) continue;
      if (d.type_ === 1) {
        vaults.add(getAddress(d.from));
        continue;
      }
      if (d.type_ === 2 || d.type_ === 3) {
        const contract = d.contract_.toLowerCase();
        if (contract === BAYC.toLowerCase() || contract === MAYC.toLowerCase()) {
          vaults.add(getAddress(d.from));
        }
      }
    }
    return [...vaults] as `0x${string}`[];
  } catch (e) {
    console.error("delegate.cash lookup failed", e);
    return [];
  }
}

export interface OwnershipSnapshot {
  wallet: string | null;
  tokenProof: boolean;
  collection: "BAYC" | "MAYC" | null;
  delegationVerified: boolean;
  delegationVault: string | null;
  otherpageVerified: boolean;
  reason: string | null;
}

/**
 * Recompute and persist ownership for a Supabase user. Always returns the
 * fresh snapshot. Failures degrade gracefully — RPC errors leave previous
 * verification untouched only when they prevented us from reading at all;
 * confirmed zero balances flip the row to false (revocation propagation).
 */
export async function recomputeOwnership(userId: string): Promise<OwnershipSnapshot> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("wallet_address")
    .eq("id", userId)
    .maybeSingle();

  const walletRaw = profile?.wallet_address ?? null;
  if (!walletRaw || !isAddress(walletRaw)) {
    return {
      wallet: null,
      tokenProof: false,
      collection: null,
      delegationVerified: false,
      delegationVault: null,
      otherpageVerified: false,
      reason: "no-wallet-on-profile",
    };
  }

  const wallet = getAddress(walletRaw) as `0x${string}`;
  const c = publicClient();

  let signer = { bayc: 0n, mayc: 0n };
  let directOk = true;
  try {
    signer = await balancesFor(c, wallet);
  } catch (e) {
    console.error("recompute: signer balanceOf failed", e);
    directOk = false;
  }

  let vaults: `0x${string}`[] = [];
  try {
    vaults = await resolveDelegatedVaults(c, wallet);
  } catch (e) {
    console.error("recompute: delegate lookup failed", e);
  }

  let totalBayc = signer.bayc;
  let totalMayc = signer.mayc;
  let delegatedFrom: `0x${string}` | null = null;
  let basisDelegated = false;

  if (totalBayc === 0n && totalMayc === 0n && vaults.length > 0) {
    for (const v of vaults) {
      try {
        const b = await balancesFor(c, v);
        if (b.bayc > 0n || b.mayc > 0n) {
          totalBayc += b.bayc;
          totalMayc += b.mayc;
          delegatedFrom = v;
          basisDelegated = true;
          break;
        }
      } catch (e) {
        console.error("recompute: vault balanceOf failed", v, e);
      }
    }
  }

  const holds = totalBayc > 0n || totalMayc > 0n;
  const collection: "BAYC" | "MAYC" | null = holds
    ? totalBayc > 0n
      ? "BAYC"
      : "MAYC"
    : null;

  // Only flip bayc_verified=false on a CONFIRMED zero read. If RPC failed
  // entirely (directOk=false AND no vaults checked successfully), preserve
  // the prior row to avoid false negatives during outages.
  const confirmedZero = directOk && !holds;
  const updates: {
    user_id: string;
    delegation_verified: boolean;
    delegation_vault: string | null;
    bayc_verified?: boolean;
    bayc_collection?: string | null;
    verified_at?: string | null;
  } = {
    user_id: userId,
    delegation_verified: basisDelegated,
    delegation_vault: delegatedFrom,
  };
  if (holds) {
    updates.bayc_verified = true;
    updates.bayc_collection = collection;
    updates.verified_at = new Date().toISOString();
  } else if (confirmedZero) {
    updates.bayc_verified = false;
    updates.bayc_collection = null;
    updates.verified_at = null;
  }

  await supabaseAdmin
    .from("user_verifications")
    .upsert(updates, { onConflict: "user_id" });

  // Re-evaluate Otherpage on the ape-holder wallet (signer or vault).
  const apeWallet = delegatedFrom ?? wallet;
  let otherpageVerified = false;
  try {
    const op = await runOtherpageCheckAndPersist({ userId, wallet: apeWallet });
    otherpageVerified = op.verified;
  } catch (e) {
    console.error("recompute: otherpage check failed", e);
  }
  // Lumina is best-effort — don't fail the snapshot if it errors.
  runLuminaCheckAndPersist({ userId, wallet: apeWallet }).catch(() => {});

  return {
    wallet,
    tokenProof: holds,
    collection,
    delegationVerified: basisDelegated,
    delegationVault: delegatedFrom,
    otherpageVerified,
    reason: holds
      ? null
      : confirmedZero
        ? vaults.length > 0
          ? "delegation-revoked-or-empty-vault"
          : "no-direct-and-no-delegation"
        : "rpc-unavailable-prior-state-preserved",
  };
}
