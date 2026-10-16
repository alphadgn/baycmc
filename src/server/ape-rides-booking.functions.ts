import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAddress, parseEther } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TIP_CHAIN_ID } from "@/lib/web3/constants";

/**
 * Ape Rides bookings: reservations and APE payments (ApeChain), plus the
 * super admin's override tools (grant / cancel rides, schedule, price,
 * location). Every write runs here with the service role after checks; the
 * browser can only READ its own reservations / payments (RLS).
 */
const NOT_ELIGIBLE =
  "Ape Rides is for verified holders of the clubhouse collections your account unlocks.";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function isSuperAdmin(userId: string) {
  const { data } = await (await db()).from("user_roles").select("role").eq("user_id", userId);
  return !!data?.some((r) => r.role === "super_admin");
}
async function requireSuperAdmin(userId: string) {
  if (!(await isSuperAdmin(userId))) throw new Error("Forbidden: super admin only");
}
async function canUseRides(userId: string) {
  const { data } = await (await db()).rpc("can_use_ape_rides", { _uid: userId });
  return !!data;
}
async function audit(actor: string, event: string, target: string | null, metadata: object) {
  await (await db()).from("audit_logs").insert({
    event_type: event,
    actor_id: actor,
    target_id: target,
    metadata: metadata as never,
  });
}

// ───────────────────────── Members ─────────────────────────

export const reserveApeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string }) =>
    z.object({ rideId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    if (!(await canUseRides(uid))) return { ok: false as const, error: NOT_ELIGIBLE };
    const admin = await db();
    const { data: ride } = await admin
      .from("ape_rides")
      .select("id,host_id,status,price_ape,capacity")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride || (ride.status !== "scheduled" && ride.status !== "live")) {
      return { ok: false as const, error: "This ride isn't open for reservations." };
    }
    if (ride.host_id === uid) return { ok: false as const, error: "You're hosting this ride." };
    const { count } = await admin
      .from("ape_ride_reservations")
      .select("id", { count: "exact", head: true })
      .eq("ride_id", ride.id)
      .neq("status", "cancelled");
    if ((count ?? 0) >= (ride.capacity ?? 1)) {
      return { ok: false as const, error: "This ride is fully booked." };
    }
    const { data: row, error } = await admin
      .from("ape_ride_reservations")
      .insert({ ride_id: ride.id, viewer_id: uid, price_ape: ride.price_ape ?? 0 })
      .select("id,status,price_ape")
      .single();
    if (error) {
      if (/duplicate key/i.test(error.message)) {
        return { ok: false as const, error: "You already have a reservation for this ride." };
      }
      return { ok: false as const, error: error.message };
    }
    await audit(uid, "ape_ride.reserve", ride.id, { reservation: row.id });
    return { ok: true as const, reservation: row };
  });

export const cancelMyReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reservationId: string }) =>
    z.object({ reservationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await db();
    const { data: r } = await admin
      .from("ape_ride_reservations")
      .select("id,viewer_id,status")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (!r || r.viewer_id !== context.userId) return { ok: false as const, error: "Not found" };
    if (r.status === "paid") {
      return {
        ok: false as const,
        error: "Paid reservations can only be cancelled by the super admin.",
      };
    }
    await admin
      .from("ape_ride_reservations")
      .update({
        status: "cancelled",
        cancelled_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    return { ok: true as const };
  });

/** Where to send APE for a reservation (the host's wallet) — payer only. */
export const getReservationPayTo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reservationId: string }) =>
    z.object({ reservationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await db();
    const { data: r } = await admin
      .from("ape_ride_reservations")
      .select("id,viewer_id,status,price_ape,ride_id")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (!r || r.viewer_id !== context.userId) return { ok: false as const, error: "Not found" };
    if (r.status !== "reserved") return { ok: false as const, error: "Nothing to pay." };
    if (!(Number(r.price_ape) > 0)) return { ok: false as const, error: "This ride is free." };
    const { data: ride } = await admin
      .from("ape_rides")
      .select("host_id")
      .eq("id", r.ride_id)
      .maybeSingle();
    if (!ride) return { ok: false as const, error: "Ride not found" };
    const { accountWallets } = await import("@/server/account-wallets.server");
    const host = await accountWallets(ride.host_id);
    const payTo = host.primary ?? host.wallets[0] ?? null;
    if (!payTo) return { ok: false as const, error: "The host has no wallet to receive APE yet." };
    return {
      ok: true as const,
      payTo,
      chainId: TIP_CHAIN_ID,
      amountApe: String(r.price_ape),
      amountWei: parseEther(String(r.price_ape)).toString(),
    };
  });

/**
 * Verify an APE payment on ApeChain and mark the reservation paid.
 * The tx must: succeed, pay one of the HOST's wallets, carry at least the
 * reserved price, come FROM one of the PAYER's wallets, and not have been
 * used before (unique tx_hash).
 */
export const confirmRidePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reservationId: string; txHash: string }) =>
    z
      .object({
        reservationId: z.string().uuid(),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const admin = await db();
    const { data: r } = await admin
      .from("ape_ride_reservations")
      .select("id,viewer_id,status,price_ape,ride_id")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (!r || r.viewer_id !== uid) return { ok: false as const, error: "Not found" };
    if (r.status === "paid") return { ok: true as const, duplicate: true };
    if (r.status !== "reserved")
      return { ok: false as const, error: "This reservation was cancelled." };
    const { data: ride } = await admin
      .from("ape_rides")
      .select("id,host_id")
      .eq("id", r.ride_id)
      .maybeSingle();
    if (!ride) return { ok: false as const, error: "Ride not found" };

    const { accountWallets } = await import("@/server/account-wallets.server");
    const [host, payer] = await Promise.all([accountWallets(ride.host_id), accountWallets(uid)]);
    const { publicClientFor } = await import("@/server/ownership/chains");
    const client = publicClientFor(TIP_CHAIN_ID);
    const hash = data.txHash as `0x${string}`;
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000, confirmations: 1 });
    } catch {
      return {
        ok: false as const,
        error: "Couldn't find that transaction on ApeChain yet. Try again in a moment.",
      };
    }
    if (receipt.status !== "success")
      return { ok: false as const, error: "The payment transaction failed on-chain." };
    const tx = await client.getTransaction({ hash });
    if (!tx.to) return { ok: false as const, error: "That transaction isn't an APE transfer." };
    const to = getAddress(tx.to);
    const from = getAddress(tx.from);
    if (!host.wallets.some((w) => getAddress(w) === to)) {
      return { ok: false as const, error: "That transaction didn't pay this ride's host." };
    }
    if (!payer.wallets.some((w) => getAddress(w) === from)) {
      return {
        ok: false as const,
        error: "Pay from a wallet connected or linked to your account.",
      };
    }
    const due = parseEther(String(r.price_ape));
    if (tx.value < due)
      return { ok: false as const, error: "The amount sent is less than the ride price." };

    const { error } = await admin.from("ape_ride_payments").insert({
      reservation_id: r.id,
      ride_id: ride.id,
      payer_id: uid,
      host_id: ride.host_id,
      chain_id: TIP_CHAIN_ID,
      tx_hash: hash.toLowerCase(),
      from_address: from,
      to_address: to,
      amount_wei: tx.value.toString() as unknown as number,
    });
    if (error) {
      if (/duplicate key/i.test(error.message)) {
        return { ok: false as const, error: "That transaction was already used for a payment." };
      }
      return { ok: false as const, error: error.message };
    }
    await admin
      .from("ape_ride_reservations")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", r.id);
    await audit(uid, "ape_ride.payment", ride.id, { reservation: r.id, tx: hash.toLowerCase() });
    return { ok: true as const, duplicate: false };
  });

/** Host: start a ride the super admin granted (scheduled → live). */
export const startGrantedRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string; lat?: number; lng?: number }) =>
    z
      .object({
        rideId: z.string().uuid(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const admin = await db();
    const { data: ride } = await admin
      .from("ape_rides")
      .select("id,host_id,status,admin_override,venue_slug")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride || ride.host_id !== uid) return { ok: false as const, error: "Not your ride." };
    if (ride.status !== "scheduled")
      return { ok: false as const, error: "This ride isn't scheduled." };
    if (!ride.admin_override) {
      if (data.lat == null || data.lng == null) {
        return { ok: false as const, error: "Check your location first." };
      }
      const { data: venue } = await admin
        .from("ape_ride_venues")
        .select("lat,lng,radius_m,name")
        .eq("slug", ride.venue_slug ?? "wynwood")
        .maybeSingle();
      const { haversineMeters } = await import("@/lib/baycmc/wynwood");
      if (!venue || haversineMeters({ lat: data.lat, lng: data.lng }, venue) > venue.radius_m) {
        return {
          ok: false as const,
          error: `You must be inside the ${venue?.name ?? "venue"} area.`,
        };
      }
    }
    await admin
      .from("ape_rides")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", ride.id);
    await audit(uid, "ape_ride.start_granted", ride.id, {});
    return { ok: true as const };
  });

// ───────────────────────── Super admin ─────────────────────────

export const adminListRides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const [{ data: rides }, { data: reservations }, { data: payments }, { data: venues }] =
      await Promise.all([
        admin.from("ape_rides").select("*").order("created_at", { ascending: false }).limit(100),
        admin
          .from("ape_ride_reservations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("ape_ride_payments")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        admin.from("ape_ride_venues").select("slug,name").order("display_order"),
      ]);
    const ids = new Set<string>();
    for (const r of rides ?? []) ids.add(r.host_id);
    for (const r of reservations ?? []) ids.add(r.viewer_id);
    const { data: profs } = ids.size
      ? await admin
          .from("profiles")
          .select("id,username")
          .in("id", [...ids])
      : { data: [] };
    const names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.username ?? "Member"]));
    return {
      rides: rides ?? [],
      reservations: reservations ?? [],
      payments: payments ?? [],
      venues: venues ?? [],
      names,
    };
  });

const rideFields = z.object({
  title: z.string().trim().min(1).max(80),
  venue: z.string().regex(/^[a-z0-9-]{1,40}$/),
  priceApe: z.number().min(0).max(1_000_000),
  scheduledStart: z.string().datetime().nullable(),
  scheduledEnd: z.string().datetime().nullable(),
  capacity: z.number().int().min(1).max(50),
  overrideLocation: z.boolean(),
});

export const adminGrantRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    rideFields.extend({ hostUsername: z.string().trim().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const { data: host } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", data.hostUsername.replace(/^@/, ""))
      .maybeSingle();
    if (!host) return { ok: false as const, error: "No member with that username." };
    const { data: ride, error } = await admin
      .from("ape_rides")
      .insert({
        host_id: host.id,
        title: data.title,
        livekit_room: `ape-ride-${host.id.slice(0, 8)}-${Date.now()}`,
        status: "scheduled",
        venue_slug: data.venue,
        price_ape: data.priceApe,
        scheduled_start: data.scheduledStart,
        scheduled_end: data.scheduledEnd,
        capacity: data.capacity,
        admin_override: data.overrideLocation,
        granted_by: context.userId,
      })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    await audit(context.userId, "ape_ride.grant", ride.id, { host: host.id });
    return { ok: true as const, rideId: ride.id };
  });

export const adminUpdateRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rideFields.extend({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const { error } = await admin
      .from("ape_rides")
      .update({
        title: data.title,
        venue_slug: data.venue,
        price_ape: data.priceApe,
        scheduled_start: data.scheduledStart,
        scheduled_end: data.scheduledEnd,
        capacity: data.capacity,
        admin_override: data.overrideLocation,
      })
      .eq("id", data.rideId);
    if (error) return { ok: false as const, error: error.message };
    await audit(context.userId, "ape_ride.update", data.rideId, {
      price: data.priceApe,
      venue: data.venue,
    });
    return { ok: true as const };
  });

export const adminCancelRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string; reason?: string }) =>
    z.object({ rideId: z.string().uuid(), reason: z.string().max(200).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("ape_rides")
      .update({
        status: "cancelled",
        ended_at: now,
        cancelled_by: context.userId,
        cancel_reason: data.reason ?? null,
      })
      .eq("id", data.rideId);
    if (error) return { ok: false as const, error: error.message };
    await admin
      .from("ape_ride_reservations")
      .update({ status: "cancelled", cancelled_by: context.userId, updated_at: now })
      .eq("ride_id", data.rideId)
      .eq("status", "reserved");
    await audit(context.userId, "ape_ride.cancel", data.rideId, { reason: data.reason ?? null });
    return { ok: true as const };
  });

export const adminSetReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reservationId: string; status: "reserved" | "paid" | "cancelled" }) =>
    z
      .object({
        reservationId: z.string().uuid(),
        status: z.enum(["reserved", "paid", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const { error } = await admin
      .from("ape_ride_reservations")
      .update({
        status: data.status,
        cancelled_by: data.status === "cancelled" ? context.userId : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.reservationId);
    if (error) return { ok: false as const, error: error.message };
    await audit(context.userId, "ape_ride.reservation_override", data.reservationId, {
      status: data.status,
    });
    return { ok: true as const };
  });
