import { defineTool } from "@lovable.dev/mcp-js";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_my_verification_status",
  title: "Get my verification status",
  description:
    "Return the signed-in user's BAYCMC verification state (BAYC / OtherPage / delegation / Lumina) and role summary.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const uid = ctx.getUserId()!;
    const [ver, roles] = await Promise.all([
      supabase.from("user_verifications").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    if (ver.error) return dbError(ver.error.message);
    if (roles.error) return dbError(roles.error.message);
    return jsonResult({
      user_id: uid,
      verification: ver.data ?? null,
      roles: (roles.data ?? []).map((r) => r.role),
    });
  },
});
