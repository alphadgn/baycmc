/**
 * Server-only helpers for booked-meeting guests (service role). Kept out of
 * *.functions.ts so nothing here can end up in the browser bundle.
 */
export async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function isStaff(userId: string) {
  const { data } = await (await db()).from("user_roles").select("role").eq("user_id", userId);
  return !!data?.some((r) => r.role === "admin" || r.role === "super_admin");
}

/** The booking in progress for a room right now, if any. */
export async function activeBookingFor(roomId: string) {
  const nowIso = new Date().toISOString();
  const { data } = await (
    await db()
  )
    .from("room_bookings")
    .select("id,user_id,title,starts_at,ends_at,room_id")
    .eq("room_id", roomId)
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function addApproved(bookingId: string, usernames: string[], decidedBy: string) {
  const admin = await db();
  const wanted = [...new Set(usernames.map((u) => u.replace(/^@/, "").trim()).filter(Boolean))];
  const found: { id: string; username: string }[] = [];
  const missing: string[] = [];
  for (const u of wanted) {
    const { data: p } = await admin
      .from("profiles")
      .select("id,username")
      .ilike("username", u)
      .maybeSingle();
    if (p) found.push({ id: p.id as string, username: p.username as string });
    else missing.push(u);
  }
  if (found.length) {
    const { error } = await admin.from("room_booking_guests").upsert(
      found.map((p) => ({
        booking_id: bookingId,
        user_id: p.id,
        status: "approved",
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
      })),
      { onConflict: "booking_id,user_id" },
    );
    if (error) return { ok: false as const, error: error.message, missing };
  }
  return { ok: true as const, added: found.length, missing };
}
