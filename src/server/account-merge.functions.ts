import { getAddress } from "viem";
/**
 * Account-merge / keep-separate flow.
 *
 * When a user signs in with credentials that match an existing OTHER account
 * (same email, or — in future — a wallet that's been assigned elsewhere),
 * the app prompts them ONCE to either merge the two accounts or keep them
 * separate forever. The decision is stored per canonical pair in
 * `account_merge_decisions`. Only super_admins can reset a decision.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole = "super_admin" | "admin" | "verified_user" | "chapter_leader";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Canonical (a < b) ordering for a pair of user ids. */
function pairKey(x: string, y: string): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

export interface CollisionInfo {
  otherUserId: string;
  collisionReason: "email" | "wallet";
  otherProfile: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    wallet_address: string | null;
    bio: string | null;
    created_at: string | null;
  };
  myProfile: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    wallet_address: string | null;
    bio: string | null;
    created_at: string | null;
  };
}

/**
 * Look for ANOTHER auth.users account sharing the caller's email (or wallet).
 * Returns null when no collision exists OR when a prior decision already
 * resolved this pair.
 */
/**
 * Server-side collision detection. Used by findAccountCollision AND re-run by
 * mergeAccounts / recordKeepSeparate so a caller can never act on an
 * arbitrary `otherUserId`.
 *
 * SECURITY: wallet matches use only server-verified sources —
 * profiles.wallet_address (written by the SIWE server fn) and
 * linked_wallets rows with verified_at (signature-proven). The old
 * profiles.linked_wallets array was populated from client input and could be
 * poisoned to "collide" with any victim.
 */
async function detectCollision(
  me: string,
): Promise<{ otherId: string; reason: "email" | "wallet" } | null> {
  const admin = await getAdmin();
  const { data: myAuth } = await admin.auth.admin.getUserById(me);
  const myEmail = myAuth?.user?.email?.toLowerCase() ?? null;

  const myWallets = new Set<string>();
  const { data: myProf } = await admin
    .from("profiles")
    .select("wallet_address")
    .eq("id", me)
    .maybeSingle();
  if (myProf?.wallet_address) myWallets.add(String(myProf.wallet_address).toLowerCase());
  const { data: myLinked } = await admin
    .from("linked_wallets")
    .select("address")
    .eq("user_id", me)
    .not("verified_at", "is", null);
  for (const r of myLinked ?? []) myWallets.add(String(r.address).toLowerCase());

  // 1. Email collision (synthetic wallet emails never collide with real ones).
  if (myEmail && !myEmail.endsWith("@wallet.baycmc.local")) {
    for (let page = 1; page <= 50; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const dupe = list?.users.find(
        (u) => u.id !== me && (u.email ?? "").toLowerCase() === myEmail,
      );
      if (dupe) return { otherId: dupe.id, reason: "email" };
      if (!list || list.users.length < 1000) break;
    }
  }

  // 2. Wallet collision against verified data only.
  if (myWallets.size > 0) {
    const walletArr = Array.from(myWallets).filter((w) => /^0x[0-9a-f]{40}$/.test(w));
    if (walletArr.length > 0) {
      const { data: primaryDupes } = await admin
        .from("profiles")
        .select("id")
        .neq("id", me)
        .in("wallet_address", walletArr)
        .limit(1);
      if (primaryDupes && primaryDupes.length > 0) {
        return { otherId: primaryDupes[0].id as string, reason: "wallet" };
      }
      // Filter by address in the query (addresses are stored checksummed,
      // so match case-insensitively). Previously this read the first 200
      // linked wallets of ANY user and filtered in memory, which stopped
      // finding duplicates once the table grew past 200 rows.
      const { data: linkedDupes } = await admin
        .from("linked_wallets")
        .select("user_id,address")
        .neq("user_id", me)
        .not("verified_at", "is", null)
        .or(walletArr.map((w) => `address.ilike.${w}`).join(","))
        .limit(50);
      const hit = (linkedDupes ?? []).find((r) => myWallets.has(String(r.address).toLowerCase()));
      if (hit) return { otherId: hit.user_id as string, reason: "wallet" };
    }
  }
  return null;
}

export const findAccountCollision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CollisionInfo | null> => {
    const me = context.userId;
    const admin = await getAdmin();
    const { data: myProf } = await admin
      .from("profiles")
      .select("id,username,avatar_url,wallet_address,bio,created_at")
      .eq("id", me)
      .maybeSingle();
    const detected = await detectCollision(me);
    const otherId = detected?.otherId ?? null;
    const reason = detected?.reason ?? null;

    if (!otherId || !reason) return null;

    // Check prior decision.
    const { a, b } = pairKey(me, otherId);
    const { data: prior } = await admin
      .from("account_merge_decisions")
      .select("decision")
      .eq("user_a_id", a)
      .eq("user_b_id", b)
      .maybeSingle();
    if (prior) return null; // already decided; never prompt again

    const { data: otherProf } = await admin
      .from("profiles")
      .select("id,username,avatar_url,wallet_address,bio,created_at")
      .eq("id", otherId)
      .maybeSingle();

    return {
      otherUserId: otherId,
      collisionReason: reason,
      otherProfile: {
        id: otherId,
        username: (otherProf?.username as string | null) ?? null,
        avatar_url: (otherProf?.avatar_url as string | null) ?? null,
        wallet_address: (otherProf?.wallet_address as string | null) ?? null,
        bio: (otherProf?.bio as string | null) ?? null,
        created_at: (otherProf?.created_at as string | null) ?? null,
      },
      myProfile: {
        id: me,
        username: (myProf?.username as string | null) ?? null,
        avatar_url: (myProf?.avatar_url as string | null) ?? null,
        wallet_address: (myProf?.wallet_address as string | null) ?? null,
        bio: (myProf?.bio as string | null) ?? null,
        created_at: (myProf?.created_at as string | null) ?? null,
      },
    };
  });

/** Record "keep separate" decision. Idempotent. */
export const recordKeepSeparate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { otherUserId: string }) =>
    z.object({ otherUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = context.userId;
    const detected = await detectCollision(me);
    if (!detected || detected.otherId !== data.otherUserId) {
      throw new Error("No matching account collision for this pair");
    }
    const { a, b } = pairKey(me, data.otherUserId);
    const admin = await getAdmin();
    const { data: existing } = await admin
      .from("account_merge_decisions")
      .select("decision")
      .eq("user_a_id", a)
      .eq("user_b_id", b)
      .maybeSingle();
    if (existing) return { ok: true, alreadyDecided: true, decision: existing.decision as string };
    const { error } = await admin.from("account_merge_decisions").insert({
      user_a_id: a,
      user_b_id: b,
      decision: "separate",
      decided_by: me,
    });
    if (error) throw new Error(error.message);
    return { ok: true, alreadyDecided: false, decision: "separate" as const };
  });

/**
 * Merge the caller's account with `otherUserId`.
 *  - `survivor`: which uuid should remain (must be one of the two)
 *  - `keep`: which profile fields come from which side
 */
export const mergeAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      otherUserId: string;
      survivorUserId: string;
      keep: {
        username: "mine" | "other";
        avatar_url: "mine" | "other";
        bio: "mine" | "other";
      };
    }) =>
      z
        .object({
          otherUserId: z.string().uuid(),
          survivorUserId: z.string().uuid(),
          keep: z.object({
            username: z.enum(["mine", "other"]),
            avatar_url: z.enum(["mine", "other"]),
            bio: z.enum(["mine", "other"]),
          }),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = context.userId;
    const other = data.otherUserId;
    if (me === other) throw new Error("Cannot merge with self");
    if (data.survivorUserId !== me && data.survivorUserId !== other) {
      throw new Error("Survivor must be one of the two accounts");
    }
    // SECURITY: previously ANY signed-in user could pass ANY otherUserId and
    // absorb that account (roles included — e.g. super_admin) and delete it.
    // The pair must be a real, server-detected collision.
    const detected = await detectCollision(me);
    if (!detected || detected.otherId !== other) {
      throw new Error("No matching account collision for this pair");
    }
    const admin = await getAdmin();

    // Re-check no prior decision (race safety).
    const { a, b } = pairKey(me, other);
    const { data: prior } = await admin
      .from("account_merge_decisions")
      .select("decision")
      .eq("user_a_id", a)
      .eq("user_b_id", b)
      .maybeSingle();
    if (prior) throw new Error("A merge decision already exists for this pair");

    const survivor = data.survivorUserId;
    const removed = survivor === me ? other : me;

    // Load both profiles.
    const { data: profs } = await admin
      .from("profiles")
      .select("id,username,avatar_url,wallet_address,bio")
      .in("id", [me, other]);
    const myProf = profs?.find((p) => p.id === me) ?? null;
    const otherProf = profs?.find((p) => p.id === other) ?? null;
    if (!myProf || !otherProf) throw new Error("Profile missing");

    const pick = <K extends "username" | "avatar_url" | "bio">(field: K) =>
      data.keep[field] === "mine" ? myProf[field] : otherProf[field];

    // 1-5. Move every user-owned row, carry the chosen profile fields and wallet
    //      over, union roles/verifications, and record the decision + audit log —
    //      all in ONE database transaction (merge_accounts, migration
    //      20261118000006). Any failure rolls the whole merge back, and the removed
    //      account is only deleted after it commits.
    const removedWallet = (survivor === me ? otherProf : myProf).wallet_address;
    const survivorProf = survivor === me ? myProf : otherProf;
    const validWallet = removedWallet && /^0x[0-9a-fA-F]{40}$/.test(removedWallet);
    // Survivor without a wallet inherits the removed one as primary; otherwise the
    // removed wallet is kept as a VERIFIED linked wallet (it signed in with SIWE, so
    // control is proven) so signing in with it later doesn't mint a new account.
    const inheritWallet = !survivorProf.wallet_address && removedWallet ? removedWallet : null;
    const linkWallet =
      !inheritWallet && validWallet ? getAddress(removedWallet as `0x${string}`) : null;
    type MergeRpc = (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { error: mergeErr } = await (admin.rpc as unknown as MergeRpc)("merge_accounts", {
      _survivor: survivor,
      _removed: removed,
      _actor: me,
      _username: pick("username") ?? null,
      _avatar_url: pick("avatar_url") ?? null,
      _bio: pick("bio") ?? null,
      _inherit_wallet: inheritWallet,
      _link_wallet: linkWallet,
    });
    if (mergeErr) {
      const msg = mergeErr.message.replace(/^MERGE:\s*/, "");
      throw new Error(`Merge failed, nothing was changed: ${msg}`);
    }

    // 6. Hard-delete the removed account from auth (cascades profile).
    const { error: delErr } = await admin.auth.admin.deleteUser(removed);
    if (delErr) {
      // Data already lives on the survivor; the empty account can be removed later.
      console.error("[mergeAccounts] deleteUser after merge:", delErr.message);
    }

    return {
      ok: true,
      survivor,
      removed,
      callerWasRemoved: removed === me,
    };
  });

/** Super-admin only: delete a decision row to re-open the prompt. */
export const resetMergeDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userA: string; userB: string }) =>
    z.object({ userA: z.string().uuid(), userB: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isSuper = (roles ?? []).some((r) => (r.role as AppRole) === "super_admin");
    if (!isSuper) throw new Error("Forbidden: super admin only");
    const { a, b } = pairKey(data.userA, data.userB);
    const { error } = await admin
      .from("account_merge_decisions")
      .delete()
      .eq("user_a_id", a)
      .eq("user_b_id", b);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Super-admin only: list all decision rows. */
export const listMergeDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isSuper = (roles ?? []).some((r) => (r.role as AppRole) === "super_admin");
    if (!isSuper) throw new Error("Forbidden: super admin only");
    const { data } = await admin
      .from("account_merge_decisions")
      .select("user_a_id,user_b_id,decision,decided_by,decided_at")
      .order("decided_at", { ascending: false })
      .limit(500);
    return { rows: data ?? [] };
  });
