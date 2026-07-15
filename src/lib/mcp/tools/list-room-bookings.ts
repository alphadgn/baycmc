import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_room_bookings",
  title: "List conference room bookings",
  description:
    "List upcoming and currently-active bookings across the signed-in user's visible rooms. Useful for finding scheduled Zoom-style conferences and karaoke sessions.",
  inputSchema: {
    room_id: z.string().uuid().optional().describe("Optional room UUID to filter to."),
    mine_only: z.boolean().optional().describe("If true, only return bookings hosted by the caller."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ room_id, mine_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("room_bookings")
      .select("id,room_id,user_id,title,starts_at,ends_at,notes,created_at")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit ?? 50);
    if (room_id) q = q.eq("room_id", room_id);
    if (mine_only) q = q.eq("user_id", ctx.getUserId()!);
    const { data, error } = await q;
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
