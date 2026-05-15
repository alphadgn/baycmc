import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";
import { SiweMessage } from "siwe";
import { createPublicClient, http, getAddress, parseAbi, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ETH_RPC_URL, DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";
import { runLuminaCheckAndPersist } from "@/server/lumina.server";
import { runOtherpageCheckAndPersist } from "@/server/otherpage.server";
import { deriveWalletPassword } from "@/server/wallet-password";

/**
 * Privy / SIWE entrance verification.
 *
 * Flow:
 *   1. Client opens Privy modal, user connects an EVM wallet, signs a SIWE
 *      message generated client-side.
 *   2. Client posts { message, signature } here.
 *   3. We verify the SIWE signature, then call balanceOf() on BAYC and MAYC
 *      via a public Ethereum RPC.
 *   4. If they own at least one of either, we mint a Supabase session for
 *      that wallet (same pattern as tokenproof).
 */

const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;
const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

const erc721Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

// delegate.cash v2 — fetch every vault that has delegated to `to`.
// Delegation type enum: 0 NONE, 1 ALL, 2 CONTRACT, 3 ERC721, 4 ERC20, 5 ERC1155.
const delegateRegistryAbi = parseAbi([
  "struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }",
  "function getIncomingDelegations(address to) view returns (Delegation[])",
]);

function client() {
  return createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPC_URL, { timeout: 8_000, retryCount: 1 }),
  });
}

/**
 * Reject after `ms` milliseconds with a descriptive error so a hung
 * upstream RPC can never wedge the verify flow. Successful resolves /
 * rejections from `p` are passed through unchanged.
 */
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

const POSITIVE_BALANCE_TTL_MS = 60_000;
const ZERO_BALANCE_TTL_MS = 15_000;
const DELEGATION_TTL_MS = 30_000;

type BalancePair = { bayc: bigint; mayc: bigint };
type BalanceCacheEntry = BalancePair & { expiresAt: number };
type DelegationCacheEntry = { vaults: `0x${string}`[]; expiresAt: number };

const balanceCache = new Map<string, BalanceCacheEntry>();
const delegationCache = new Map<string, DelegationCacheEntry>();

function balanceCacheKey(owner: `0x${string}`) {
  return `1:${owner.toLowerCase()}:bayc-mayc`;
}

function delegationCacheKey(signer: `0x${string}`) {
  return `1:${signer.toLowerCase()}:incoming-delegations-v2`;
}

async function balancesFor(
  c: ReturnType<typeof client>,
  owner: `0x${string}`,
): Promise<BalancePair> {
  const now = Date.now();
  const key = balanceCacheKey(owner);
  const hit = balanceCache.get(key);
  if (hit && hit.expiresAt > now) {
    return { bayc: hit.bayc, mayc: hit.mayc };
  }

  const [bayc, mayc] = await Promise.all([
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
  ]);

  const hasBalance = bayc > 0n || mayc > 0n;
  balanceCache.set(key, {
    bayc,
    mayc,
    expiresAt: now + (hasBalance ? POSITIVE_BALANCE_TTL_MS : ZERO_BALANCE_TTL_MS),
  });

  return { bayc, mayc };
}

/**
 * Resolve every "vault" wallet that has delegated authority to `signer`
 * for either BAYC or MAYC (or for ALL / the entire wallet) via delegate.cash
 * v2. We treat the signer as a valid holder if any such vault holds the
 * collection — this is the standard "delegated for vacation/entry" pattern.
 */
async function resolveDelegatedVaults(
  c: ReturnType<typeof client>,
  signer: `0x${string}`,
): Promise<`0x${string}`[]> {
  const now = Date.now();
  const key = delegationCacheKey(signer);
  const hit = delegationCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.vaults;
  }

  try {
    const delegations = (await c.readContract({
      address: DELEGATE_REGISTRY_V2,
      abi: delegateRegistryAbi,
      functionName: "getIncomingDelegations",
      args: [signer],
    })) as ReadonlyArray<{
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
      // Only "no rights restriction" (0x00..00) counts for entry — custom
      // rights strings narrow delegation to specific use-cases.
      const noRights =
        d.rights === "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (!noRights) continue;

      // ALL → vault delegated their entire wallet.
      if (d.type_ === 1) {
        vaults.add(getAddress(d.from));
        continue;
      }
      // CONTRACT or ERC721 scoped to BAYC/MAYC contracts.
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
    console.error("delegate.cash lookup failed", e);
    return [];
  }
}

/**
 * Public Privy config — App IDs are publishable, safe to ship to the client.
 * We surface them via a server fn so the secret value stays out of the
 * browser bundle until the user actually opens the entrance.
 */
export const getPrivyPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const appId = process.env.PRIVY_APP_ID ?? "";
  return { appId, configured: appId.length > 0 };
});

/**
 * Audit log for Privy embedded EVM wallet auto-provisioning.
 *
 * Safeguard against double-provisioning across concurrent sessions / rapid
 * re-auth: we look up any prior `privy.embedded_wallet.provisioned` event
 * for the same Privy user id BEFORE inserting. If one exists we return
 * `{ deduped: true }` and the client should treat the existing wallet as
 * canonical instead of attempting another createWallet().
 */
export const logEmbeddedWalletProvisioned = createServerFn({ method: "POST" })
  .inputValidator((input: { privyUserId: string; walletAddress: string; email?: string | null }) =>
    z
      .object({
        privyUserId: z.string().min(1).max(200),
        walletAddress: z.string().min(10).max(64),
        email: z.string().email().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!isAddress(data.walletAddress)) {
      return { ok: false as const, reason: "invalid-address" };
    }
    const wallet = getAddress(data.walletAddress);
    const eventType = "privy.embedded_wallet.provisioned";

    // Dedupe: any prior provisioning event for this Privy user id wins.
    const { data: prior } = await supabaseAdmin
      .from("audit_logs")
      .select("id, metadata")
      .eq("event_type", eventType)
      .contains("metadata", { privy_user_id: data.privyUserId })
      .limit(1);

    if (prior && prior.length > 0) {
      const existing = prior[0].metadata as { wallet_address?: string } | null;
      return {
        ok: true as const,
        deduped: true as const,
        existingWallet: existing?.wallet_address ?? null,
      };
    }

    const { error } = await supabaseAdmin.from("audit_logs").insert({
      event_type: eventType,
      actor_id: null,
      target_id: null,
      metadata: {
        privy_user_id: data.privyUserId,
        wallet_address: wallet,
        email: data.email ?? null,
        provisioned_at: new Date().toISOString(),
      },
    });
    if (error) {
      console.error("audit log insert failed", error);
      return { ok: false as const, reason: "insert-failed" };
    }
    return { ok: true as const, deduped: false as const, existingWallet: null };
  });

// Simple in-memory token-bucket rate limiter, keyed by wallet address.
// Protects against verification spam / DDoS / re-entry attacks. Best-effort
// only — production deployments should layer a CDN / WAF on top.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6; // 6 verification attempts per wallet per minute
const INSPECT_RATE_LIMIT_MAX = 30;
type Bucket = { count: number; resetAt: number };
const verifyBuckets = new Map<string, Bucket>();
const inspectBuckets = new Map<string, Bucket>();

function rateLimit(map: Map<string, Bucket>, key: string, max: number) {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true as const, retryAfterMs: 0 };
  }
  if (b.count >= max) {
    return { ok: false as const, retryAfterMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true as const, retryAfterMs: 0 };
}

/**
 * Inspect a single embedded-wallet address: returns BAYC/MAYC balances for
 * the address itself plus any delegate.cash v2 vault that has delegated to
 * it (so the UI can show "direct" vs "delegated from <vault>" per address).
 */
export const inspectWalletHoldings = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string }) =>
    z.object({ address: z.string().min(10).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!isAddress(data.address)) {
      return { ok: false as const, reason: "invalid-address" };
    }
    const address = getAddress(data.address) as `0x${string}`;
    const rl = rateLimit(inspectBuckets, address.toLowerCase(), INSPECT_RATE_LIMIT_MAX);
    if (!rl.ok) {
      return { ok: false as const, reason: "rate-limited", retryAfterMs: rl.retryAfterMs };
    }
    const c = client();
    const [own, vaults] = await Promise.all([
      balancesFor(c, address).catch(() => ({ bayc: 0n, mayc: 0n })),
      resolveDelegatedVaults(c, address).catch(() => [] as `0x${string}`[]),
    ]);

    const delegatedSources: Array<{
      vault: string;
      bayc: string;
      mayc: string;
      detailsUrl: string;
    }> = [];
    for (const v of vaults) {
      const b = await balancesFor(c, v).catch(() => ({ bayc: 0n, mayc: 0n }));
      if (b.bayc > 0n || b.mayc > 0n) {
        delegatedSources.push({
          vault: v,
          bayc: b.bayc.toString(),
          mayc: b.mayc.toString(),
          detailsUrl: `https://delegate.cash/registry?delegate=${address}&vault=${v}`,
        });
      }
    }

    return {
      ok: true as const,
      address,
      direct: { bayc: own.bayc.toString(), mayc: own.mayc.toString() },
      delegated: delegatedSources,
    };
  });

export const verifyPrivyOwnership = createServerFn({ method: "POST" })
  .inputValidator((input: { message: string; signature: string }) =>
    z
      .object({
        message: z.string().min(20).max(4000),
        signature: z.string().min(20).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // 1) Verify SIWE signature + domain + expiration to prevent replay
    //    attacks from signatures issued for other sites.
    let address: string;
    try {
      const siwe = new SiweMessage(data.message);

      // Domain check: the SIWE message must be bound to this server's host.
      // Allow a configured override (SITE_DOMAIN) for environments behind
      // proxies; otherwise fall back to the request host.
      const requestHost = (() => {
        try {
          return getRequestHost();
        } catch {
          return null;
        }
      })();
      const expectedDomain = (process.env.SITE_DOMAIN ?? requestHost ?? "").toLowerCase();
      if (!expectedDomain) {
        throw new Error("Server domain not configured");
      }
      const messageDomain = (siwe.domain ?? "").toLowerCase();
      if (messageDomain !== expectedDomain) {
        console.warn("SIWE domain mismatch", { messageDomain, expectedDomain });
        throw new Error("Signature was not issued for this site.");
      }

      // Expiration check: reject expired/future-dated messages.
      if (siwe.expirationTime) {
        const exp = new Date(siwe.expirationTime).getTime();
        if (Number.isFinite(exp) && exp < Date.now()) {
          throw new Error("Signature has expired. Please sign again.");
        }
      }
      if (siwe.issuedAt) {
        const iat = new Date(siwe.issuedAt).getTime();
        // Reject signatures older than 10 minutes — short window prevents replays.
        if (Number.isFinite(iat) && Date.now() - iat > 10 * 60 * 1000) {
          throw new Error("Signature is too old. Please sign again.");
        }
      }

      const result = await siwe.verify({ signature: data.signature });
      if (!result.success || !result.data?.address) {
        throw new Error("Signature verification failed");
      }
      address = result.data.address;
    } catch (e) {
      console.error("SIWE verify failed", e);
      const msg = e instanceof Error ? e.message : "";
      throw new Error(
        msg && (msg.includes("expired") || msg.includes("too old") || msg.includes("this site"))
          ? msg
          : "We couldn't verify your wallet signature. Please try again.",
      );
    }

    if (!isAddress(address)) {
      throw new Error("Invalid wallet address returned from signature.");
    }
    const wallet = getAddress(address);

    const rl = rateLimit(verifyBuckets, wallet.toLowerCase(), RATE_LIMIT_MAX);
    if (!rl.ok) {
      return {
        verified: false as const,
        reason: `Too many verification attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
        wallet,
      };
    }

    // 2) Check BAYC + MAYC balances on-chain. The signer wallet is the
    //    Privy embedded/connected wallet for the user's email. They may not
    //    hold the apes directly — instead they may be a "hot" wallet that a
    //    cold "vault" has delegated to via delegate.cash for entry purposes.
    //    We therefore also walk every incoming delegation and check those
    //    vaults' balances. Any positive balance (signer OR delegated vault)
    //    counts as verified ownership.
    const c = client();

    // Direct balance check — independent. RPC failure leaves balance=0 but
    // does not block sign-in: the user still gets a lobby session.
    let signerBals = { bayc: 0n, mayc: 0n };
    let directLookupOk = true;
    try {
      signerBals = await balancesFor(c, wallet as `0x${string}`);
    } catch (e) {
      console.error("RPC balanceOf (signer) failed", e);
      directLookupOk = false;
    }

    // Delegation lookup — independent of direct check. Errors degrade to
    // "no delegation found" so users are never blocked from the lobby
    // by a delegate.cash / RPC outage. Direct ownership remains the
    // primary path.
    let vaults: `0x${string}`[] = [];
    let delegationLookupOk = true;
    try {
      vaults = await resolveDelegatedVaults(c, wallet as `0x${string}`);
    } catch (e) {
      console.error("delegate.cash lookup threw", e);
      delegationLookupOk = false;
    }

    let totalBayc = signerBals.bayc;
    let totalMayc = signerBals.mayc;
    let delegatedFrom: `0x${string}` | null = null;
    let verificationBasis: "direct" | "delegated" = "direct";

    if (totalBayc === 0n && totalMayc === 0n && vaults.length > 0) {
      for (const v of vaults) {
        try {
          const b = await balancesFor(c, v);
          if (b.bayc > 0n || b.mayc > 0n) {
            totalBayc += b.bayc;
            totalMayc += b.mayc;
            delegatedFrom = v;
            verificationBasis = "delegated";
            break;
          }
        } catch (e) {
          console.error("RPC balanceOf failed for vault", v, e);
        }
      }
    }

    const holdsApe = totalBayc > 0n || totalMayc > 0n;
    const collection: "BAYC" | "MAYC" | null = holdsApe
      ? totalBayc > 0n
        ? "BAYC"
        : "MAYC"
      : null;
    const delegationDetailsUrl = delegatedFrom
      ? `https://delegate.cash/registry?delegate=${wallet}&vault=${delegatedFrom}`
      : null;

    // 3) Mint / fetch Supabase user. Every successful signature gets a
    //    session — gated areas are still protected by RLS via the
    //    bayc_verified / is_token_proof_verified helpers, so non-holders
    //    only see the main lobby and direct messages.
    const lower = wallet.toLowerCase();
    const email = `${lower}@wallet.baycmc.local`;
    const password = await deriveWalletPassword(lower);

    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const found = existing?.users.find((u) => u.email === email);
    let userId = found?.id;

    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { wallet: lower, via: "privy" },
      });
      if (error) throw error;
      userId = created.user!.id;
    } else {
      await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    }

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, wallet_address: lower }, { onConflict: "id" });

    await supabaseAdmin.from("user_verifications").upsert(
      {
        user_id: userId,
        bayc_verified: holdsApe,
        bayc_collection: collection,
        delegation_verified: verificationBasis === "delegated",
        delegation_vault: delegatedFrom,
        verified_at: holdsApe ? new Date().toISOString() : null,
      },
      { onConflict: "user_id" },
    );

    if (holdsApe) {
      const apeHolder = delegatedFrom ?? wallet;
      await Promise.all([
        runLuminaCheckAndPersist({ userId, wallet: apeHolder }).catch((e) =>
          console.error("Lumina post-privy check failed", e),
        ),
        runOtherpageCheckAndPersist({ userId, wallet: apeHolder }).catch((e) =>
          console.error("Otherpage post-privy check failed", e),
        ),
      ]);
    }

    const { data: signIn, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signIn.session) {
      throw signInErr ?? new Error("Could not mint session");
    }

    return {
      verified: holdsApe,
      collection,
      wallet,
      verificationBasis,
      delegatedFrom,
      delegationDetailsUrl,
      delegationLookupOk,
      directLookupOk,
      delegationVaultsChecked: vaults.length,
      reason: holdsApe
        ? null
        : vaults.length > 0
          ? "Signed in to the lobby. No BAYC/MAYC found in this wallet or its delegated vaults — gated rooms remain locked."
          : delegationLookupOk
            ? "Signed in to the lobby. No BAYC/MAYC in this wallet and no delegate.cash delegation found."
            : "Signed in to the lobby. delegate.cash lookup unavailable; only direct ownership was checked.",
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
    };
  });
