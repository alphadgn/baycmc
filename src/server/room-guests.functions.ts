import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { activeBookingFor, addApproved, db, isStaff } from "@/server/room-guests.server";

/**
 * Conference rooms: live attendance and booked-meeting guest approval.
 *
 * - Attendance comes straight from LiveKit (who is in each room right now).
 * - While a booking is in progress, only its host, admins and approved
 *   guests may enter (enforced in the LiveKit token gate); everyone else
 *   waits until the host or an admin approves them here.
 */

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Live headcount per room (keyed by room id), straight from LiveKit. */
export const getRoomsOccupancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ counts: Record<string, number>; checkedAt: string }> => {
    const checkedAt = new Date().toISOString();
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return { counts: {}, checkedAt };
    const { data: rooms } = await (
      await db()
    )
      .from("rooms")
      .select("id,livekit_room")
      .eq("active", true);
    const byName = new Map((rooms ?? []).map((r) => [r.livekit_room as string, r.id as string]));
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    const live = await withTimeout(
      client.listRooms().catch(() => []),
      5_000,
    );
    const counts: Record<string, number> = {};
    for (const r of live ?? []) {
      const id = byName.get(r.name);
      if (id) counts[id] = r.numParticipants ?? 0;
    }
    return { counts, checkedAt };
  });

export interface MeetingGuest {
  userId: string;
  name: string;
  status: "approved" | "pending" | "denied";
  requestedAt: string;
}

/** Host / admin view of the meeting in progress: guests and requests. */
export const listMeetingGuests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const booking = await activeBookingFor(data.roomId);
    if (!booking) return { booking: null, guests: [] as MeetingGuest[] };
    if (booking.user_id !== context.userId && !(await isStaff(context.userId))) {
      return { booking: null, guests: [] as MeetingGuest[] };
    }
    const admin = await db();
    const { data: rows } = await admin
      .from("room_booking_guests")
      .select("user_id,status,requested_at")
      .eq("booking_id", booking.id)
      .order("requested_at", { ascending: true });
    const ids = (rows ?? []).map((r) => r.user_id as string);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await admin.from("profiles").select("id,username").in("id", ids);
      for (const p of profs ?? []) names.set(p.id as string, (p.username as string) || "Member");
    }
    return {
      booking: {
        id: booking.id as string,
        title: booking.title as string,
        endsAt: booking.ends_at as string,
      },
      guests: (rows ?? []).map((r) => ({
        userId: r.user_id as string,
        name: names.get(r.user_id as string) ?? "Member",
        status: r.status as MeetingGuest["status"],
        requestedAt: r.requested_at as string,
      })),
    };
  });

async function requireBookingHost(bookingId: string, userId: string) {
  const { data: booking } = await (
    await db()
  )
    .from("room_bookings")
    .select("id,user_id,room_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw new Error("Booking not found");
  if (booking.user_id !== userId && !(await isStaff(userId))) {
    throw new Error("Only the meeting host or an admin can do that");
  }
  return booking;
}

/** Approve or deny someone for a booked meeting. */
export const decideMeetingGuest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; userId: string; approve: boolean }) =>
    z
      .object({ bookingId: z.string().uuid(), userId: z.string().uuid(), approve: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await requireBookingHost(data.bookingId, context.userId);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Forbidden" };
    }
    const { error } = await (await db()).from("room_booking_guests").upsert(
      {
        booking_id: data.bookingId,
        user_id: data.userId,
        status: data.approve ? "approved" : "denied",
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "booking_id,user_id" },
    );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/** Pre-approve members (by username) for a booking — the approved list. */
export const inviteMeetingGuests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; usernames: string[] }) =>
    z
      .object({
        bookingId: z.string().uuid(),
        usernames: z.array(z.string().trim().min(1).max(64)).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await requireBookingHost(data.bookingId, context.userId);
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Forbidden",
        missing: [],
      };
    }
    return addApproved(data.bookingId, data.usernames, context.userId);
  });
