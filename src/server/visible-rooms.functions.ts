import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Discovery uses the same server rule as media entry, even before the SQL review is applied. */
export const getVisibleRooms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("rooms")
      .select(
        "id,name,description,capacity,tier,livekit_room,theme,display_order,is_locked,kind,required_collection,coming_soon",
      )
      .eq("active", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("name");
    if (error) return [];
    const { roomVisibleTo } = await import("@/server/room-visibility.server");
    const rows = data ?? [];
    const allowed = await Promise.all(rows.map((room) => roomVisibleTo(context.userId, room)));
    return rows.filter((_, index) => allowed[index]);
  });
