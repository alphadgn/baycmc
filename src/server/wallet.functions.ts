import { createServerFn } from "@tanstack/react-start";
import { getRequestHost, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { SiweMessage } from "siwe";
import { createPublicClient, http, fallback, getAddress, parseAbi, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";

/**
 * Glyph / SIWE entrance verification.
 *
 * Flow:
 *   1. Client connects an EVM wallet through Glyph, then signs a SIWE
 *      message generated client-side.
 *   2. Client posts { message, signature } here.
 *   3. We verify the SIWE signature, then call balanceOf() on BAYC and MAYC
 *      via a public Ethereum RPC.
 *   4. Every valid signature mints a Supabase session for that wallet (the
 *      lobby). Holding at least one BAYC/MAYC (directly or via delegate.cash)
 *      flips bayc_verified, which RLS uses to unlock gated rooms.
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
  const configured = process.env.ETH_RPC_URL?.trim();
  // Try the admin-provisioned RPC first, then fall back through several
  // public mainnet RPCs so a single provider outage doesn't break sign-in.
  const urls = [
    configured,
    "https://eth.llamarpc.com",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
  ].filter((u): u is string => Boolean(u));
  if (!configured) {
    console.warn("[wallet.functions] ETH_RPC_URL not set — using public RPC fallbacks");
  }
  return createPublicClient({
    chain: mainnet,
    transport: fallback(
      urls.map((u) => http(u, { timeout: 6_000, retryCount: 1 })),
      { rank: false, retryCount: 1 },
    ),
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
 * Inspect a single wallet address: returns BAYC/MAYC balances for the
 * address itself plus any delegate.cash v2 vault that has delegated to it
 * (so the UI can show "direct" vs "delegated from <vault>" per address).
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

const nonceBuckets = new Map<string, Bucket>();
const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * Issue a single-use SIWE nonce bound to a wallet address. The client fetches
 * this as soon as the wallet connects (BEFORE the "Sign to enter" tap) so the
 * signing popup still opens synchronously inside the user's gesture.
 *
 * Previously the nonce was generated in the browser and never checked, so a
 * captured signature could be replayed for 10 minutes.
 */
export const getSiweNonce = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string }) =>
    z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    const address = getAddress(data.address);
    const rl = rateLimit(nonceBuckets, address.toLowerCase(), 12);
    if (!rl.ok) {
      throw new Error(
        `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Transient database / network hiccups used to surface straight away as
    // "Could not start sign-in". Retry a few times (fresh nonce each try) and
    // log the real reason so a persistent failure can be diagnosed.
    let lastError: { message?: string; code?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + SIWE_NONCE_TTL_MS).toISOString();
      try {
        const { error } = await supabaseAdmin.from("auth_nonces").insert({
          wallet_address: address.toLowerCase(),
          nonce,
          expires_at: expiresAt,
          consumed: false,
        });
        if (!error) {
          // Housekeeping, best effort: drop nonces that expired over a day ago.
          if (Math.random() < 0.1) {
            void supabaseAdmin
              .from("auth_nonces")
              .delete()
              .lt("expires_at", new Date(Date.now() - 86_400_000).toISOString())
              .then(() => undefined);
          }
          return { nonce, expiresAt };
        }
        lastError = error;
      } catch (e) {
        lastError = { message: e instanceof Error ? e.message : String(e) };
      }
      console.error("[siwe] nonce insert failed", { attempt, ...lastError });
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
    throw new Error(
      `Could not start sign-in. Please try again.${
        lastError?.code ? ` (ref ${lastError.code})` : ""
      }`,
    );
  });

/**
 * Ask Glyph's API (server-to-server) which wallets are linked to the signer's
 * Glyph account. The client only forwards its Glyph widget token; Glyph — not
 * the browser — vouches for the list, and the token is bound to the signer's
 * address via the x-evm-address header.
 */
async function fetchGlyphLinkedWalletsServer(
  signer: string,
  glyph: { token: string; nonce: string } | undefined,
): Promise<`0x${string}`[]> {
  if (!glyph) return [];
  try {
    const res = await withTimeout(
      fetch("https://useglyph.io/api/widget/user", {
        headers: {
          Authorization: `Bearer ${glyph.token}`,
          "x-evm-address": signer,
          "x-glyph-nonce": glyph.nonce,
          "Content-Type": "application/json",
        },
      }),
      5_000,
      "glyph user lookup",
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      evmWallet?: string;
      smartWallet?: string;
      linkedWallets?: Array<{ address?: string }>;
    } | null;
    // The Glyph account must actually belong to the signer.
    const owners = [json?.evmWallet, json?.smartWallet]
      .filter((a): a is string => !!a && isAddress(a))
      .map((a) => a.toLowerCase());
    if (!owners.includes(signer.toLowerCase())) return [];
    const out: `0x${string}`[] = [];
    for (const a of [
      json?.evmWallet,
      json?.smartWallet,
      ...(json?.linkedWallets ?? []).map((w) => w?.address),
    ]) {
      if (a && isAddress(a)) out.push(getAddress(a) as `0x${string}`);
    }
    return out;
  } catch (e) {
    console.warn("[verifyOwnership] Glyph linked-wallet lookup failed", e);
    return [];
  }
}

export const verifyOwnership = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      message: string;
      signature: string;
      glyphSession?: { token: string; nonce: string };
      /** @deprecated Ignored — client-supplied wallet lists are never trusted. */
      linkedWallets?: string[];
    }) =>
      z
        .object({
          message: z.string().min(20).max(4000),
          signature: z.string().min(20).max(400),
          glyphSession: z
            .object({ token: z.string().min(10).max(4096), nonce: z.string().min(4).max(256) })
            .optional(),
          linkedWallets: z.array(z.string()).max(20).optional(),
        })
        .parse(input),
  )

  .handler(async ({ data }) => {
    // 1) Verify SIWE signature + domain + expiration to prevent replay
    //    attacks from signatures issued for other sites.
    let address: string;
    try {
      const siwe = new SiweMessage(data.message);

      // Domain check: the SIWE message must be bound to the host the user
      // actually visited. In preview / proxy environments the worker's
      // internal request host (e.g. "localhost:8080") differs from the
      // browser-visible host, so prefer the Origin/Referer header (set by
      // the browser to the real site) and fall back to the request host.
      const headerHost = (() => {
        try {
          const origin = getRequestHeader("origin") ?? getRequestHeader("referer");
          if (!origin) return null;
          return new URL(origin).host;
        } catch {
          return null;
        }
      })();
      const requestHost = (() => {
        try {
          return getRequestHost();
        } catch {
          return null;
        }
      })();
      const acceptedDomains = new Set(
        [process.env.SITE_DOMAIN, headerHost, requestHost]
          .filter((d): d is string => Boolean(d))
          .map((d) => d.toLowerCase()),
      );
      if (acceptedDomains.size === 0) {
        throw new Error("Server domain not configured");
      }
      const messageDomain = (siwe.domain ?? "").toLowerCase();
      if (!acceptedDomains.has(messageDomain)) {
        console.warn("SIWE domain mismatch", {
          messageDomain,
          acceptedDomains: [...acceptedDomains],
        });
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

      // Single-use, server-issued nonce bound to this wallet. Atomic consume
      // (UPDATE … WHERE consumed = false) so two parallel replays can't both win.
      const { supabaseAdmin: nonceDb } = await import("@/integrations/supabase/client.server");
      const { data: consumed } = await nonceDb
        .from("auth_nonces")
        .update({ consumed: true })
        .eq("nonce", siwe.nonce)
        .eq("consumed", false)
        .eq("wallet_address", address.toLowerCase())
        .gt("expires_at", new Date().toISOString())
        .select("id");
      if (!consumed || consumed.length !== 1) {
        throw new Error("Signature has expired. Please sign again.");
      }
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

    // 2) Check BAYC + MAYC balances on-chain via Alchemy (ETH_RPC_URL), and
    //    independently look for delegate.cash vaults. Delegation lookup is
    //    non-fatal: if it times out or the registry RPC fails, direct balance
    //    verification still completes and the user still enters the lobby.
    const c = client();

    const [balancesResult, vaultsResult] = await Promise.allSettled([
      balancesFor(c, wallet as `0x${string}`),
      resolveDelegatedVaults(c, wallet as `0x${string}`),
    ]);

    if (balancesResult.status === "rejected") {
      console.error("RPC balanceOf (signer) failed", balancesResult.reason);
      throw new Error(
        "We couldn't reach the Ethereum network to verify ownership. Please try again in a moment.",
      );
    }

    const signerBals = balancesResult.value;
    const directLookupOk = true;
    const delegationLookupOk = vaultsResult.status === "fulfilled";
    if (vaultsResult.status === "rejected") {
      console.warn("delegate.cash lookup failed during ownership verify", vaultsResult.reason);
    }
    const vaults = delegationLookupOk ? vaultsResult.value : [];

    let totalBayc = signerBals.bayc;
    let totalMayc = signerBals.mayc;
    let delegatedFrom: `0x${string}` | null = null;
    const linkedHolder: `0x${string}` | null = null;

    // Collect every additional wallet to inspect: delegate.cash vaults that
    // delegated to the signer, plus any Glyph "linked wallets" the user has
    // attached to their account (signed in via the Glyph modal). For linked
    // wallets we also walk their own incoming delegations.
    //
    // SECURITY: the old code trusted a `linkedWallets` array sent by the
    // browser, so anyone could sign with an empty wallet, list a whale's
    // address, and be marked BAYC-verified. Linked wallets now come ONLY from
    // (a) Glyph's API, queried server-side with the signer-bound Glyph token,
    // and (b) wallets this account already proved with a signature
    // (`linked_wallets.verified_at`, see linked-wallets.functions.ts).
    const lowerSigner = wallet.toLowerCase();
    const linkedAddrs: `0x${string}`[] = [];
    const pushLinked = (raw: string | null | undefined) => {
      if (!raw || !isAddress(raw)) return;
      const addr = getAddress(raw) as `0x${string}`;
      if (addr.toLowerCase() === lowerSigner) return;
      if (linkedAddrs.some((a) => a.toLowerCase() === addr.toLowerCase())) return;
      linkedAddrs.push(addr);
    };
    for (const a of await fetchGlyphLinkedWalletsServer(wallet, data.glyphSession)) pushLinked(a);
    {
      const { supabaseAdmin: lwDb } = await import("@/integrations/supabase/client.server");
      const { data: owner } = await lwDb
        .from("profiles")
        .select("id")
        .eq("wallet_address", lowerSigner)
        .maybeSingle();
      if (owner?.id) {
        const { data: proven } = await lwDb
          .from("linked_wallets")
          .select("address")
          .eq("user_id", owner.id)
          .not("verified_at", "is", null)
          .limit(20);
        for (const r of proven ?? []) pushLinked(r.address as string);
      }
    }

    if (totalBayc === 0n && totalMayc === 0n && vaults.length > 0) {
      for (const v of vaults) {
        try {
          const b = await balancesFor(c, v);
          if (b.bayc > 0n || b.mayc > 0n) {
            totalBayc += b.bayc;
            totalMayc += b.mayc;
            delegatedFrom = v;
            break;
          }
        } catch (e) {
          console.error("RPC balanceOf (delegated vault) failed", v, e);
        }
      }
    }

    // Previously-linked and Glyph-linked wallets are NOT walked for access:
    // only wallets proven by signature in THIS session count (the signer
    // here; more can be proven in-session via wallet linking). They are
    // still recorded on the profile below for account-merge detection.

    const verificationBasis: "direct" | "delegated" | "linked" = delegatedFrom
      ? "delegated"
      : linkedHolder
        ? "linked"
        : "direct";

    let holdsApe = totalBayc > 0n || totalMayc > 0n;
    let collection: string | null = holdsApe ? (totalBayc > 0n ? "BAYC" : "MAYC") : null;
    const delegationDetailsUrl = delegatedFrom
      ? `https://delegate.cash/registry?delegate=${linkedHolder ?? wallet}&vault=${delegatedFrom}`
      : null;

    // 3) Mint / fetch Supabase user. Every successful signature gets a
    //    session — gated areas are still protected by RLS via the
    //    bayc_verified / is_verified_holder helpers, so non-holders
    //    only see the main lobby and direct messages.
    const lower = wallet.toLowerCase();
    const email = `${lower}@wallet.baycmc.local`;
    const { deriveWalletPassword } = await import("@/server/wallet-password");
    const password = await deriveWalletPassword(lower);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A wallet that is nobody's PRIMARY wallet but is a signature-verified
    // linked wallet of exactly one account (e.g. the other half of a merged
    // account) signs into THAT account — with its roles — instead of minting
    // a fresh, privilege-less account for the wallet.
    let linkedOwnerId: string | null = null;
    {
      const { data: primaryOwner } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("wallet_address", lower)
        .maybeSingle();
      if (!primaryOwner) {
        const { data: rows } = await supabaseAdmin
          .from("linked_wallets")
          .select("user_id")
          .ilike("address", lower)
          .not("verified_at", "is", null)
          .limit(5);
        const owners = new Set((rows ?? []).map((r) => r.user_id as string));
        if (owners.size === 1) linkedOwnerId = [...owners][0] ?? null;
      }
    }

    const { data: created, error: createErr } = linkedOwnerId
      ? { data: { user: { id: linkedOwnerId } }, error: null }
      : await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { wallet: lower, via: "glyph" },
        });
    let userId = created.user?.id;

    if (!userId) {
      const alreadyExists = createErr?.message?.toLowerCase().includes("already");
      if (!alreadyExists) throw createErr ?? new Error("Could not create wallet session");

      // Look the account up by its wallet (indexed) instead of scanning the
      // first 1,000 auth users — that scan stopped finding returning members
      // once the club grew past 1,000 accounts.
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("wallet_address", lower)
        .maybeSingle();
      userId = (prof?.id as string | undefined) ?? undefined;
      for (let page = 1; !userId && page <= 50; page++) {
        const { data: existing } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        const found = existing?.users.find((u) => u.email === email);
        userId = found?.id;
        if (!existing || existing.users.length < 1000) break;
      }
      if (!userId) throw new Error("Could not find wallet session");
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
      });
      if (updateErr) throw updateErr;
    }

    // Build the canonical set of wallet addresses associated with this account:
    // the signing wallet + every Glyph-linked wallet + any delegate.cash vault
    // that delegated ape ownership to it. Used for account-merge collision
    // detection so a duplicate account that shares ANY of these wallets is
    // surfaced — not just the primary signer.
    const allLinked = new Set<string>();
    allLinked.add(lower);
    for (const a of linkedAddrs) allLinked.add(a.toLowerCase());
    if (delegatedFrom) allLinked.add(delegatedFrom.toLowerCase());
    const { data: existingProf } = await supabaseAdmin
      .from("profiles")
      .select("linked_wallets")
      .eq("id", userId)
      .maybeSingle();
    for (const w of (existingProf?.linked_wallets as string[] | null) ?? []) {
      if (w) allLinked.add(w.toLowerCase());
    }
    await supabaseAdmin.from("profiles").upsert(
      linkedOwnerId
        ? // Keep the owner's primary wallet; this wallet stays a linked one.
          { id: userId, linked_wallets: Array.from(allLinked) }
        : { id: userId, wallet_address: lower, linked_wallets: Array.from(allLinked) },
      { onConflict: "id" },
    );

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

    // Fast path above only checks BAYC/MAYC. If it found nothing, run the
    // central ownership engine, which covers every whitelisted collection
    // (CryptoPunks, Pudgy Penguins, …) across linked + delegated wallets.
    // Always run it, FRESH: every sign-in re-checks the wallets on-chain and
    // grants access only from what they hold right now — nothing verified in
    // a previous session carries over, and a failed check grants nothing.
    {
      try {
        const { recomputeOwnership, startSessionWallets } =
          await import("@/server/ownership.server");
        // New sign-in session: the signer is the only proven wallet so far.
        await startSessionWallets(userId, lower);
        const snap = await recomputeOwnership(userId, {
          fresh: true,
          confirmedLabels: holdsApe && collection ? [collection] : [],
        });
        if (snap.tokenProof && !holdsApe) {
          holdsApe = true;
          collection = snap.collection;
        }
      } catch (e) {
        console.error("recomputeOwnership during sign-in failed", e);
      }
    }

    if (holdsApe) {
      const apeHolder = delegatedFrom ?? linkedHolder ?? wallet;

      const [{ runLuminaCheckAndPersist }, { runOtherpageCheckAndPersist }] = await Promise.all([
        import("@/server/lumina.server"),
        import("@/server/otherpage.server"),
      ]);
      await Promise.all([
        runLuminaCheckAndPersist({ userId, wallet: apeHolder }).catch((e) =>
          console.error("Lumina post-verify check failed", e),
        ),
        runOtherpageCheckAndPersist({ userId, wallet: apeHolder }).catch((e) =>
          console.error("Otherpage post-verify check failed", e),
        ),
      ]);
    }

    const { data: signIn, error: signInErr } = linkedOwnerId
      ? await sessionForUser(supabaseAdmin, linkedOwnerId)
      : await supabaseAdmin.auth.signInWithPassword({ email, password });
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
      linkedWalletsChecked: linkedAddrs.length,
      linkedHolder,
      reason: holdsApe
        ? null
        : linkedAddrs.length > 0
          ? "Signed in to the lobby. No BAYC/MAYC found in this wallet, linked wallets, or any delegated vaults — gated rooms remain locked."
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

/**
 * Session for an existing account the caller has just proven control of
 * (a verified linked wallet). Uses a one-time magic-link token server-side;
 * nothing is emailed and the token never leaves the server.
 */
async function sessionForUser(
  admin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  userId: string,
) {
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
  const ownerEmail = u?.user?.email;
  if (uErr || !ownerEmail) {
    return { data: { session: null }, error: uErr ?? new Error("Account has no login email") };
  }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ownerEmail,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { data: { session: null }, error: linkErr ?? new Error("Could not mint session") };
  }
  const { data, error } = await admin.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return { data: { session: data?.session ?? null }, error };
}
