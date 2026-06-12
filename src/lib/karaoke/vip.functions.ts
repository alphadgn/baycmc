import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Resolve which of the given user IDs are verified BAYC/MAYC holders
 * ("VIP"). Uses the service-role client server-side because the
 * user_verifications RLS only lets each user read their own row — we need
 * to surface VIP badges in karaoke rooms for everyone in the audience.
 *
 * Returns only the IDs whose `bayc_verified` flag is true; callers should
 * treat absence as "not VIP". No PII is leaked — just the boolean fact.
 */
export const fetchVipUserIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userIds: z.array(z.string().uuid()).min(0).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.userIds.length === 0) return { vipUserIds: [] as string[] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("user_verifications")
      .select("user_id,bayc_verified")
      .in("user_id", data.userIds)
      .eq("bayc_verified", true);
    if (error) throw new Error(error.message);
    return {
      vipUserIds: (rows ?? []).map((r) => r.user_id as string),
    };
  });
