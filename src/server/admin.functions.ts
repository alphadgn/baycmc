import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AppRole = "super_admin" | "admin" | "verified_user" | "chapter_leader";

async function getRoles(userId: string): Promise<AppRole[]> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data?.map((r) => r.role) ?? []) as AppRole[];
}

async function requireAdmin(userId: string) {
  const roles = await getRoles(userId);
  const ok = roles.includes("super_admin") || roles.includes("admin");
  if (!ok) throw new Error("Forbidden: admin only");
  return { roles, isSuperAdmin: roles.includes("super_admin") };
}

async function requireSuperAdmin(userId: string) {
  const roles = await getRoles(userId);
  if (!roles.includes("super_admin")) throw new Error("Forbidden: super admin only");
}

/** List users with profile, roles, and verification status. */
export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search?: string; limit?: number }) =>
    z
      .object({
        search: z.string().max(255).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    let q = supabaseAdmin
      .from("profiles")
      .select("id, wallet_address, username, avatar_url, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.search && data.search.trim()) {
      const s = data.search.trim();
      q = q.or(`wallet_address.ilike.%${s}%,username.ilike.%${s}%`);
    }

    const { data: profiles, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length === 0) return { users: [] };

    const [{ data: roles }, { data: verifs }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin
        .from("user_verifications")
        .select("user_id, bayc_verified, otherpage_verified, delegation_verified, lumina_verified, verified_at")
        .in("user_id", ids),
    ]);

    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id, arr);
    }
    const vByUser = new Map(verifs?.map((v) => [v.user_id, v]) ?? []);

    return {
      users: (profiles ?? []).map((p) => ({
        ...p,
        roles: rolesByUser.get(p.id) ?? [],
        verification: vByUser.get(p.id) ?? null,
      })),
    };
  });

/** Super admin only: grant or revoke a role on a target user. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string; role: AppRole; action: "grant" | "revoke" }) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        role: z.enum(["super_admin", "admin", "verified_user", "chapter_leader"]),
        action: z.enum(["grant", "revoke"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);

    if (data.targetUserId === context.userId && data.role === "super_admin" && data.action === "revoke") {
      throw new Error("You cannot revoke your own super_admin role");
    }

    if (data.action === "grant") {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.targetUserId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.rpc("log_audit_event", {
      _event_type: "role.change",
      _target_id: data.targetUserId,
      _metadata: { role: data.role, action: data.action, by: context.userId },
    });

    return { ok: true };
  });

/** Admin+ override of a user's verification flags (allow/deny access). */
export const overrideVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    targetUserId: string;
    bayc_verified?: boolean;
    otherpage_verified?: boolean;
  }) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        bayc_verified: z.boolean().optional(),
        otherpage_verified: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const patch: {
      user_id: string;
      bayc_verified?: boolean;
      otherpage_verified?: boolean;
      verified_at?: string;
    } = { user_id: data.targetUserId };
    if (typeof data.bayc_verified === "boolean") patch.bayc_verified = data.bayc_verified;
    if (typeof data.otherpage_verified === "boolean") patch.otherpage_verified = data.otherpage_verified;
    if (data.bayc_verified) patch.verified_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("user_verifications")
      .upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_audit_event", {
      _event_type: "verification.override",
      _target_id: data.targetUserId,
      _metadata: { by: context.userId, ...patch },
    });

    return { ok: true };
  });

/** Super admin only: hard delete a user (profile + roles + auth account). */
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string }) =>
    z.object({ targetUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    if (data.targetUserId === context.userId) {
      throw new Error("You cannot delete your own account");
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.targetUserId);
    await supabaseAdmin.from("user_verifications").delete().eq("user_id", data.targetUserId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.targetUserId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.targetUserId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_audit_event", {
      _event_type: "user.delete",
      _target_id: data.targetUserId,
      _metadata: { by: context.userId },
    });

    return { ok: true };
  });

/** Returns the caller's role flags so the UI can decide what to show. */
export const getMyAdminContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await getRoles(context.userId);
    return {
      isAdmin: roles.includes("admin") || roles.includes("super_admin"),
      isSuperAdmin: roles.includes("super_admin"),
      roles,
    };
  });

/** List chapter submissions (admin+). */
export const listChapterSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: "pending" | "approved" | "rejected" | "all" }) =>
    z.object({ status: z.enum(["pending", "approved", "rejected", "all"]).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    let q = supabaseAdmin
      .from("chapter_submissions")
      .select("id, user_id, chapter_name, city, region, pitch, status, reviewer_id, review_notes, reviewed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const profiles = ids.length
      ? (await supabaseAdmin.from("profiles").select("id, username, wallet_address").in("id", ids)).data ?? []
      : [];
    const pmap = new Map(profiles.map((p) => [p.id, p]));
    return {
      submissions: (rows ?? []).map((r) => ({
        ...r,
        applicant: pmap.get(r.user_id) ?? null,
      })),
    };
  });

/** Review (approve / reject) a chapter submission with optional notes. */
export const reviewChapterSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    submissionId: string;
    decision: "approved" | "rejected";
    notes?: string;
  }) =>
    z
      .object({
        submissionId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: sub, error: fetchErr } = await supabaseAdmin
      .from("chapter_submissions")
      .select("id, user_id, status")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!sub) throw new Error("Submission not found");

    const { error } = await supabaseAdmin
      .from("chapter_submissions")
      .update({
        status: data.decision,
        review_notes: data.notes ?? null,
        reviewer_id: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.submissionId);
    if (error) throw new Error(error.message);

    if (data.decision === "approved") {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: sub.user_id, role: "chapter_leader" }, { onConflict: "user_id,role" });
    }

    await supabaseAdmin.rpc("log_audit_event", {
      _event_type: "chapter.review",
      _target_id: data.submissionId,
      _metadata: { decision: data.decision, notes: data.notes ?? null, by: context.userId },
    });

    return { ok: true };
  });
