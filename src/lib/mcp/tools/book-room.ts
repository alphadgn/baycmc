import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "book_room",
  title: "Book a clubhouse room",
  description:
    "Reserve a BAYCMC clubhouse room (conference/karaoke) for a time window. The booking is created as the signed-in user; RLS and the overlap trigger reject conflicts.",
  inputSchema: {
    room_id: z.string().uuid().describe("The room to book."),
    starts_at: z.string().describe("Booking start (ISO 8601 timestamp)."),
    ends_at: z.string().describe("Booking end (ISO 8601 timestamp)."),
    title: z.string().min(1).max(200).describe("Short title for the booking."),
    notes: z.string().max(2000).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ room_id, starts_at, ends_at, title, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    if (new Date(ends_at) <= new Date(starts_at)) {
      return {
        content: [{ type: "text", text: "ends_at must be after starts_at." }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("room_bookings")
      .insert({
        room_id,
        user_id: ctx.getUserId()!,
        starts_at,
        ends_at,
        title,
        notes: notes ?? null,
      })
      .select()
      .single();
    if (error) return dbError(error.message);
    return jsonResult(data);
  },
});
