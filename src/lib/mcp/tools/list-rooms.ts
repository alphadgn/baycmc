import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_rooms",
  title: "List clubhouse rooms",
  description:
    "List active BAYCmc clubhouse rooms (conference/Zoom-style rooms, karaoke rooms, and other tiered rooms) the signed-in user can see.",
  inputSchema: {
    kind: z
      .string()
      .optional()
      .describe("Optional filter on room kind, e.g. 'conference' or 'karaoke'."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max rooms to return (default 50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ kind, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("rooms")
      .select(
        "id,name,description,capacity,tier,kind,theme,active,is_locked,display_order,required_collection",
      )
      .eq("active", true)
      .order("display_order", { ascending: true })
      .limit(limit ?? 50);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (error) return dbError(error.message);
    const { data: identity, error: identityError } = await supabase.auth.getUser();
    if (identityError || !identity.user) return unauthenticated();
    const { roomVisibleTo } = await import("@/server/room-visibility.server");
    const rows = data ?? [];
    const allowed = await Promise.all(rows.map((room) => roomVisibleTo(identity.user.id, room)));
    return jsonResult(rows.filter((_, index) => allowed[index]));
  },
});
