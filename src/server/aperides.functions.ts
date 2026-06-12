import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isInsideWynwood } from "@/lib/baycmc/wynwood";

/**
 * Host starts a new Ape Ride. Server re-validates the GPS coordinate is
 * inside the Wynwood geofence — never trust the client claim alone.
 */
export const startApeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lat: number; lng: number; title?: string }) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        title: z.string().min(1).max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (!isInsideWynwood({ lat: data.lat, lng: data.lng })) {
      return {
        ok: false as const,
        error: "You must be physically inside the Wynwood clubhouse to host an Ape Ride.",
      };
    }

    const { data: ver } = await supabase
      .from("user_verifications")
      .select("bayc_verified")
      .eq("user_id", userId)
      .maybeSingle();
    if (!ver?.bayc_verified) {
      return { ok: false as const, error: "Verified BAYC/MAYC holder access required." };
    }

    // End any prior live ride from the same host
    await supabase
      .from("ape_rides")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("host_id", userId)
      .eq("status", "live");

    const livekitRoom = `ape-ride-${userId.slice(0, 8)}-${Date.now()}`;
    const { data: ride, error } = await supabase
      .from("ape_rides")
      .insert({
        host_id: userId,
        title: data.title ?? "Ape Ride",
        livekit_room: livekitRoom,
      })
      .select()
      .single();
    if (error || !ride) {
      return { ok: false as const, error: error?.message ?? "Failed to start ride" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Store precise GPS in private locations table (server-only writes).
    await supabaseAdmin.from("ape_ride_locations").insert({
      ride_id: ride.id,
      host_id: userId,
      lat: data.lat,
      lng: data.lng,
    });

    await supabaseAdmin.from("audit_logs").insert({
      event_type: "ape_ride.start",
      actor_id: userId,
      target_id: ride.id,
      metadata: { lat: data.lat, lng: data.lng },
    });

    return { ok: true as const, ride };
  });

export const endApeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string }) =>
    z.object({ rideId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("ape_rides")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.rideId)
      .eq("host_id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const requestApeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string; message?: string }) =>
    z
      .object({
        rideId: z.string().uuid(),
        message: z.string().max(280).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ver } = await supabase
      .from("user_verifications")
      .select("bayc_verified")
      .eq("user_id", userId)
      .maybeSingle();
    if (!ver?.bayc_verified) {
      return { ok: false as const, error: "Verified BAYC/MAYC holder access required." };
    }

    const { data: ride } = await supabase
      .from("ape_rides")
      .select("id,status")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride || ride.status !== "live") {
      return { ok: false as const, error: "This ride is no longer live." };
    }

    const { data: req, error } = await supabase
      .from("ape_ride_requests")
      .upsert(
        {
          ride_id: data.rideId,
          viewer_id: userId,
          message: data.message ?? null,
          status: "pending",
        },
        { onConflict: "ride_id,viewer_id" },
      )
      .select()
      .single();

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, request: req };
  });

export const respondApeRideRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string; accept: boolean }) =>
    z.object({ requestId: z.string().uuid(), accept: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Host must still be Token-Proof verified to accept/decline.
    const { data: ver } = await supabase
      .from("user_verifications")
      .select("bayc_verified")
      .eq("user_id", userId)
      .maybeSingle();
    if (!ver?.bayc_verified) {
      return { ok: false as const, error: "Verified BAYC/MAYC holder access required." };
    }

    // Verify caller is the host of the ride
    const { data: req } = await supabase
      .from("ape_ride_requests")
      .select("id, ride_id, ape_rides!inner(host_id)")
      .eq("id", data.requestId)
      .maybeSingle();
    const joined = req as { ape_rides?: { host_id: string } | { host_id: string }[] } | null;
    const hostId = Array.isArray(joined?.ape_rides)
      ? joined?.ape_rides[0]?.host_id
      : joined?.ape_rides?.host_id;
    if (!req || hostId !== userId) {
      return { ok: false as const, error: "Not authorized" };
    }

    const { error } = await supabase
      .from("ape_ride_requests")
      .update({ status: data.accept ? "accepted" : "declined" })
      .eq("id", data.requestId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/**
 * Mint a LiveKit token for an Ape Ride.
 * - Host gets publish rights.
 * - Viewer must have an `accepted` request and gets subscribe-only.
 */
export const getApeRideToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideId: string }) =>
    z.object({ rideId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Re-verify Token Proof on every token mint. is_lifer is intentionally
    // NOT required here — Ape Rides are not lifer-gated, only BAYC-gated.
    const { data: ver } = await supabase
      .from("user_verifications")
      .select("bayc_verified")
      .eq("user_id", userId)
      .maybeSingle();
    if (!ver?.bayc_verified) {
      return { ok: false as const, error: "Verified BAYC/MAYC holder access required." };
    }

    const { data: ride } = await supabase
      .from("ape_rides")
      .select("id, host_id, livekit_room, status")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride) return { ok: false as const, error: "Ride not found" };
    if (ride.status !== "live") {
      return { ok: false as const, error: "Ride has ended" };
    }

    const isHost = ride.host_id === userId;
    let canPublish = false;

    if (isHost) {
      canPublish = true;
    } else {
      const { data: req } = await supabase
        .from("ape_ride_requests")
        .select("status")
        .eq("ride_id", data.rideId)
        .eq("viewer_id", userId)
        .maybeSingle();
      if (!req || req.status !== "accepted") {
        return { ok: false as const, error: "Pairing not yet accepted by the host" };
      }
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      return { ok: false as const, error: "LiveKit not configured" };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, wallet_address")
      .eq("id", userId)
      .maybeSingle();
    const name =
      profile?.username ||
      (profile?.wallet_address
        ? `${profile.wallet_address.slice(0, 6)}…${profile.wallet_address.slice(-4)}`
        : "Member");

    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name,
      ttl: "2h",
    });
    at.addGrant({
      room: ride.livekit_room,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    return {
      ok: true as const,
      token,
      url,
      roomName: ride.livekit_room,
      isHost,
    };
  });
