import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Create a room booking. Server-side conflict prevention via DB trigger.
 * Admins can override conflicts by setting override=true.
 */
export const createBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    roomId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    notes?: string;
    override?: boolean;
  }) =>
    z
      .object({
        roomId: z.string().uuid(),
        title: z.string().min(1).max(120),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        notes: z.string().max(2000).optional(),
        override: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Re-check tier gating server-side. RLS already enforces this on insert,
    // but we want a clean error message instead of an opaque RLS denial.
    const { data: room } = await supabase
      .from("rooms")
      .select("tier, active")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room || !room.active) {
      return { ok: false as const, error: "Room not found or inactive" };
    }
    const { data: ver } = await supabase
      .from("user_verifications")
      .select("bayc_verified, otherpage_verified")
      .eq("user_id", userId)
      .maybeSingle();
    // Role bypass: super_admin / admin / verified_user skip the BAYC
    // ownership check, but the Otherpage / lifer gate is never bypassed —
    // those rooms always require an actual on-chain Otherpage token AND a
    // verified BAYC/MAYC holding.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const hasBypassRole = !!roleRows?.some(
      (r) => r.role === "super_admin" || r.role === "admin" || r.role === "verified_user",
    );
    if (!ver?.bayc_verified && !hasBypassRole) {
      return { ok: false as const, error: "Verified BAYC/MAYC holder access required to book." };
    }
    if (room.tier === "lifer" && !(ver?.bayc_verified && ver?.otherpage_verified)) {
      return {
        ok: false as const,
        error: "Lifer access requires a verified BAYC/MAYC holding AND an Otherpage / Lifer token in your wallet.",
      };
    }

    let overrideBy: string | null = null;
    if (data.override) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const isAdmin = roles?.some((r) => r.role === "admin" || r.role === "super_admin");
      if (!isAdmin) {
        return { ok: false as const, error: "Only admins can override conflicts" };
      }
      overrideBy = userId;
    }

    const { data: booking, error } = await supabase
      .from("room_bookings")
      .insert({
        room_id: data.roomId,
        user_id: userId,
        title: data.title,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        notes: data.notes ?? null,
        override_by: overrideBy,
      })
      .select("id, room_id, starts_at, ends_at, title")
      .single();

    if (error) {
      return { ok: false as const, error: error.message };
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_type: "booking.create",
      actor_id: userId,
      target_id: booking.id,
      metadata: {
        room_id: booking.room_id,
        title: booking.title,
        override: !!overrideBy,
      },
    });

    // Notify owner (and any future invitees)
    await supabase.from("notifications").insert({
      user_id: userId,
      kind: "booking.created",
      title: "Room booked",
      body: `${booking.title} · ${new Date(booking.starts_at).toLocaleString()}`,
      url: `/bookings`,
    });

    return { ok: true as const, booking };
  });

export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) =>
    z.object({ bookingId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("room_bookings").delete().eq("id", data.bookingId);
    if (error) return { ok: false as const, error: error.message };
    await supabaseAdmin.from("audit_logs").insert({
      event_type: "booking.cancel",
      actor_id: userId,
      target_id: data.bookingId,
      metadata: {},
    });
    return { ok: true as const };
  });
