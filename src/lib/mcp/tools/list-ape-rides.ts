import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_ape_rides",
  title: "List Ape Rides streams",
  description: "List Ape Rides live/scheduled streaming sessions visible to the signed-in user.",
  inputSchema: {
    status: z.enum(["live", "ended"]).optional().describe("Filter by status."),
    host_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ status, host_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("ape_rides")
      .select("id,host_id,title,livekit_room,status,started_at,ended_at,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (status) q = q.eq("status", status);
    if (host_id) q = q.eq("host_id", host_id);
    const { data, error } = await q;
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
