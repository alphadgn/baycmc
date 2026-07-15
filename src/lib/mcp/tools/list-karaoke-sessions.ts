import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_karaoke_sessions",
  title: "List active karaoke sessions",
  description: "Show current karaoke sessions across karaoke rooms, including who is performing and what video is queued.",
  inputSchema: {
    room_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ room_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("karaoke_sessions")
      .select("room_id,performer_user_id,video_id,search_query,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 50);
    if (room_id) q = q.eq("room_id", room_id);
    const { data, error } = await q;
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
