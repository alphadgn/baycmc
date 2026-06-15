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
export const findAccountCollision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CollisionInfo | null> => {
    const me = context.userId;
    const admin = await getAdmin();

    // Pull current user's email + wallet.
    const { data: myAuth } = await admin.auth.admin.getUserById(me);
    const myEmail = myAuth?.user?.email?.toLowerCase() ?? null;
    const { data: myProf } = await admin
      .from("profiles")
      .select("id,username,avatar_url,wallet_address,bio,created_at,linked_wallets")
      .eq("id", me)
      .maybeSingle();
    const myWallets = new Set<string>();
    if (myProf?.wallet_address) myWallets.add(myProf.wallet_address.toLowerCase());
    for (const w of ((myProf?.linked_wallets as string[] | null) ?? [])) {
      if (w) myWallets.add(w.toLowerCase());
    }

    // 1. Email collision — paginate auth list, filter manually (admin API
    //    has no email-exact filter for non-primary entries).
    let otherId: string | null = null;
    let reason: "email" | "wallet" | null = null;
    if (myEmail) {
      // listUsers max 1000 per page; for our scale a single page suffices.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const dupe = list?.users.find(
        (u) => u.id !== me && (u.email ?? "").toLowerCase() === myEmail,
      );
      if (dupe) {
        otherId = dupe.id;
        reason = "email";
      }
    }

    // 2. Wallet collision — any of my linked wallets appears on another
    //    profile's primary wallet OR linked_wallets list.
    if (!otherId && myWallets.size > 0) {
      const walletArr = Array.from(myWallets);
      const { data: walletDupes } = await admin
        .from("profiles")
        .select("id,wallet_address,linked_wallets")
        .neq("id", me)
        .or(
          `wallet_address.in.(${walletArr.map((w) => `"${w}"`).join(",")}),linked_wallets.ov.{${walletArr.join(",")}}`,
        )
        .limit(1);
      if (walletDupes && walletDupes.length > 0) {
        otherId = walletDupes[0].id as string;
        reason = "wallet";
      }
    }

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

    // 1. Reassign content owned by `removed` → `survivor` across every
    //    user-keyed table. Errors here are non-fatal individually but we
    //    log them — the operation is best-effort transactional outside
    //    of a real DB transaction (Supabase admin REST doesn't expose one).
    const reassignTables: Array<{ table: string; column: string }> = [
      { table: "posts", column: "author_id" },
      { table: "post_likes", column: "user_id" },
      { table: "post_comments", column: "author_id" },
      { table: "lobby_messages", column: "user_id" },
      { table: "lobby_message_reactions", column: "user_id" },
      { table: "messages", column: "sender_id" },
      { table: "lifer_messages", column: "user_id" },
      { table: "karaoke_recordings", column: "performer_user_id" },
      { table: "ape_rides", column: "host_id" },
      { table: "ape_ride_requests", column: "user_id" },
      { table: "room_bookings", column: "user_id" },
      { table: "notifications", column: "user_id" },
    ];
    for (const { table, column } of reassignTables) {
      // Dynamic table name — typed Supabase client can't narrow this; cast.
      const { error } = await (admin.from(table as never) as unknown as {
        update: (v: Record<string, string>) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      })
        .update({ [column]: survivor })
        .eq(column, removed);
      if (error) console.warn("[mergeAccounts] reassign", table, column, error.message);
    }

    // 2. Wallet/profile carry-over → survivor. Removed profile will be
    //    deleted by the auth.users cascade, but unique constraints on
    //    `profiles.wallet_address` mean we must clear the removed wallet
    //    BEFORE writing it onto the survivor.
    const removedWallet = (survivor === me ? otherProf : myProf).wallet_address;
    if (removedWallet) {
      await admin.from("profiles").update({ wallet_address: null }).eq("id", removed);
    }
    const survivorPatch: {
      username: string | null;
      avatar_url: string | null;
      bio: string | null;
      wallet_address?: string | null;
    } = {
      username: pick("username") ?? null,
      avatar_url: pick("avatar_url") ?? null,
      bio: pick("bio") ?? null,
    };
    // If survivor has no wallet, inherit the removed one.
    const survivorProf = survivor === me ? myProf : otherProf;
    if (!survivorProf.wallet_address && removedWallet) {
      survivorPatch.wallet_address = removedWallet;
    }
    const { error: patchErr } = await admin
      .from("profiles")
      .update(survivorPatch)
      .eq("id", survivor);
    if (patchErr) throw new Error("Profile merge failed: " + patchErr.message);

    // 3. Promote any role/verification rows from removed → survivor
    //    (ignore conflicts where survivor already holds them).
    await admin.from("user_roles").update({ user_id: survivor }).eq("user_id", removed);
    // user_verifications has UNIQUE(user_id); only move if survivor lacks one.
    const { data: survVer } = await admin
      .from("user_verifications")
      .select("user_id")
      .eq("user_id", survivor)
      .maybeSingle();
    if (!survVer) {
      await admin
        .from("user_verifications")
        .update({ user_id: survivor })
        .eq("user_id", removed);
    }

    // 4. Record decision (canonical pair).
    await admin.from("account_merge_decisions").insert({
      user_a_id: a,
      user_b_id: b,
      decision: "merged",
      decided_by: me,
    });

    // 5. Audit log.
    await admin.from("audit_logs").insert({
      event_type: "account.merge",
      actor_id: me,
      target_id: removed,
      metadata: { survivor, removed, reason: "user-initiated" },
    });

    // 6. Hard-delete the removed account from auth (cascades profile).
    const { error: delErr } = await admin.auth.admin.deleteUser(removed);
    if (delErr) console.warn("[mergeAccounts] deleteUser:", delErr.message);

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
