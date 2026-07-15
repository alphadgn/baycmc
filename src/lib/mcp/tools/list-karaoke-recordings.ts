import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_karaoke_recordings",
  title: "List karaoke recordings",
  description: "List recent karaoke performance recordings visible to the signed-in user, newest first.",
  inputSchema: {
    performer_id: z.string().uuid().optional().describe("Filter to a specific performer."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ performer_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("karaoke_recordings")
      .select(
        "id,room_id,performer_id,song_title,song_artist,youtube_id,public_url,duration_ms,has_instrumental,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (performer_id) q = q.eq("performer_id", performer_id);
    const { data, error } = await q;
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
