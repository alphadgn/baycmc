import { defineTool } from "@lovable.dev/mcp-js";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_linked_wallets",
  title: "List my linked wallets",
  description: "List wallets the signed-in user has linked to their BAYCMC account, with verification and last-checked timestamps.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("linked_wallets")
      .select("id,address,label,verified_at,last_checked_at,created_at")
      .eq("user_id", ctx.getUserId()!)
      .order("created_at", { ascending: false });
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
