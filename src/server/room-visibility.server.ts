import { streamVisible } from "@/lib/baycmc/stream-visibility";

/** Mirrors the reviewed room_visible SQL without inventing client-side ownership. */
export async function roomVisibleTo(
  userId: string,
  room: {
    id: string;
    kind: string;
    tier: string;
    required_collection?: string | null;
  },
): Promise<boolean> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const existing = await db.rpc("room_visible", { _uid: userId, _room: room.id });
  if (existing.error || existing.data !== true) return false;
  // These have their own authoritative entry rules, unchanged here.
  if (room.kind === "chapter" || room.kind === "mudwater") return true;
  if (room.kind === "stream") {
    const [area, free, ticket] = await Promise.all([
      db.rpc("can_access_area", { _uid: userId, _item: "event_stream" }),
      db.rpc("stream_viewer_free", { _uid: userId }),
      db.rpc("stream_has_ticket", { _uid: userId }),
    ]);
    return (
      area.data === true &&
      streamVisible({ free: free.data === true, hasTicket: ticket.data === true })
    );
  }
  const staff = await db.rpc("is_staff", { _uid: userId });
  if (staff.data === true) return true;
  if (room.kind === "karaoke" || room.kind === "game" || room.tier === "public") return true;
  if (room.tier === "lifer") {
    const lifer = await db.rpc("is_lifer", { _user_id: userId });
    return lifer.data === true;
  }
  const area = room.required_collection === "PUNKS" ? "punks_brunch" : "conference_rooms";
  if (!room.required_collection) {
    return (await db.rpc("can_access_area", { _uid: userId, _item: area })).data === true;
  }
  const matrix = await db
    .from("collection_menu_items")
    .select("collection_label")
    .eq("item_key", area)
    .eq("enabled", true)
    .in(
      "collection_label",
      room.required_collection
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    );
  if (matrix.error || !matrix.data?.length) return false;
  const held = await db.rpc("holds_any_collection", {
    _uid: userId,
    _labels: matrix.data.map((row) => row.collection_label).join(","),
  });
  return !held.error && held.data === true;
}
