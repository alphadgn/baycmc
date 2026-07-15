import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_karaoke_queue",
  title: "Get karaoke queue for a room",
  description: "Return the current karaoke queue (users waiting to sing) for a specific karaoke room, ordered by join time.",
  inputSchema: {
    room_id: z.string().uuid().describe("Karaoke room UUID."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ room_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("karaoke_queue")
      .select("id,room_id,user_id,joined_at")
      .eq("room_id", room_id)
      .order("joined_at", { ascending: true });
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
