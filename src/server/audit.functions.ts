import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only audit log query with filters.
 */
export const queryAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    eventType?: string;
    actorId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) =>
    z
      .object({
        eventType: z.string().max(100).optional(),
        actorId: z.string().uuid().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify admin
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin" || r.role === "super_admin");
    if (!isAdmin) {
      return { ok: false as const, error: "Admin only", logs: [] };
    }

    let q = supabase
      .from("audit_logs")
      .select("id,event_type,actor_id,target_id,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.eventType) q = q.eq("event_type", data.eventType);
    if (data.actorId) q = q.eq("actor_id", data.actorId);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);

    const { data: logs, error } = await q;
    if (error) return { ok: false as const, error: error.message, logs: [] };
    return { ok: true as const, logs: logs ?? [], error: null };
  });
