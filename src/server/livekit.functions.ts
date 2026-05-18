import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recomputeOwnership } from "@/server/ownership.server";

type RoomRecord = {
  id: string;
  name: string;
  tier: "token_proof" | "lifer";
  livekit_room: string;
  active: boolean;
  is_locked: boolean;
};

type RoomAccessResult =
  | { ok: true; room: RoomRecord }
  | {
      ok: false;
      error: string;
      code:
        | "room_unavailable"
        | "room_locked"
        | "bayc_revoked"
        | "otherpage_revoked";
    };

async function validateRoomAccess(userId: string, roomId: string): Promise<RoomAccessResult> {
  const { data: room, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,tier,livekit_room,active,is_locked")
    .eq("id", roomId)
    .maybeSingle();
  if (error || !room || !room.active) {
    return { ok: false, error: "Room not found or inactive", code: "room_unavailable" };
  }

  // Re-run on-chain BAYC/MAYC + delegate.cash and Otherpage checks at the
  // moment access is requested or refreshed. This is the hard gate that makes
  // revoked delegations/sold tokens stop future room entry and token minting.
  const fresh = await recomputeOwnership(userId).catch((e) => {
    console.error("recomputeOwnership for room access failed", e);
    return null;
  });

  const ver = fresh
    ? {
        bayc_verified: fresh.tokenProof,
        otherpage_verified: fresh.otherpageVerified,
      }
    : (
        await supabaseAdmin
          .from("user_verifications")
          .select("bayc_verified, otherpage_verified")
          .eq("user_id", userId)
          .maybeSingle()
      ).data;

  // Role bypass:
  //   * super_admin / admin → skip BOTH the BAYC and the Lifer gate. Admins
  //     administer the clubhouse and need access to every room.
  //   * verified_user → skips the BAYC gate only (Lifer still requires
  //     real on-chain Otherpage + BAYC).
  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = !!roleRows?.some(
    (r) => r.role === "super_admin" || r.role === "admin",
  );
  const bypassesBaycGate =
    isAdmin || !!roleRows?.some((r) => r.role === "verified_user");

  if (!ver?.bayc_verified && !bypassesBaycGate) {
    return {
      ok: false,
      error:
        "Your BAYC/MAYC access is no longer active. Reconnect a wallet that owns or is delegated an ape to enter exclusive rooms.",
      code: "bayc_revoked",
    };
  }
  if (
    room.tier === "lifer" &&
    !isAdmin &&
    !(ver?.bayc_verified && ver?.otherpage_verified)
  ) {
    return {
      ok: false,
      error:
        "Lifer rooms require both a verified BAYC/MAYC holding and an Otherpage / Lifer token in your wallet.",
      code: "otherpage_revoked",
    };
  }

  // Locked rooms still admit the active host (so they can unlock); everyone
  // else gets a friendly error instead of an opaque LiveKit join failure.
  if (room.is_locked) {
    const host = await isRoomHost(userId, roomId);
    if (!host) {
      return {
        ok: false,
        error: "This room is locked by its host. Ask them to unlock it to join.",
        code: "room_locked",
      };
    }
  }

  return { ok: true, room };
}

async function isRoomHost(userId: string, roomId: string): Promise<boolean> {
  // Admin / super_admin override.
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roles?.some((r) => r.role === "admin" || r.role === "super_admin")) return true;

  // Current-slot booking owner is the host while their booking is active.
  const nowIso = new Date().toISOString();
  const { data: booking } = await supabaseAdmin
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .limit(1)
    .maybeSingle();
  return !!booking;
}

function getLivekitConfig() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return null;
  return { apiKey, apiSecret, url };
}

/**
 * Mint a LiveKit access token after enforcing tier-based access.
 * - token_proof rooms: requires bayc_verified
 * - lifer rooms: requires bayc_verified AND otherpage_verified
 * RLS on `rooms` already filters which rooms the user can see; this is a
 * second hard server-side gate before ANY token is minted.
 */
export const getLivekitToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const access = await validateRoomAccess(userId, data.roomId);
    if (!access.ok) return access;
    const { room } = access;

    const cfg = getLivekitConfig();
    if (!cfg) return { ok: false as const, error: "LiveKit not configured" };

    // Display name = wallet short
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, wallet_address")
      .eq("id", userId)
      .maybeSingle();

    const identity = userId;
    const name =
      profile?.username ||
      (profile?.wallet_address
        ? `${profile.wallet_address.slice(0, 6)}…${profile.wallet_address.slice(-4)}`
        : "Member");

    const host = await isRoomHost(userId, data.roomId);

    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity, name, ttl: "2h" });
    at.addGrant({
      room: room.livekit_room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Hosts get room-admin grants so the client SDK exposes the kick/mute
      // surface. The server-side fns still re-check is_room_host before
      // acting — the grant alone is not a permission.
      roomAdmin: host,
    });

    const token = await at.toJwt();

    await supabaseAdmin.from("audit_logs").insert({
      event_type: "room.join",
      actor_id: userId,
      target_id: room.id,
      metadata: { room_name: room.name, tier: room.tier, host },
    });

    return {
      ok: true as const,
      token,
      url: cfg.url,
      roomName: room.livekit_room,
      isHost: host,
      isLocked: room.is_locked,
    };
  });

export const revalidateLivekitRoomAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => validateRoomAccess(context.userId, data.roomId));

/**
 * Host-only: toggle the room's `is_locked` flag.
 * Locked rooms reject new joins from non-hosts via validateRoomAccess.
 */
export const setRoomLocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; locked: boolean }) =>
    z
      .object({ roomId: z.string().uuid(), locked: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!(await isRoomHost(userId, data.roomId))) {
      return { ok: false as const, error: "Host-only action" };
    }
    const { error } = await supabaseAdmin
      .from("rooms")
      .update({ is_locked: data.locked })
      .eq("id", data.roomId);
    if (error) return { ok: false as const, error: error.message };

    await supabaseAdmin.from("audit_logs").insert({
      event_type: data.locked ? "room.lock" : "room.unlock",
      actor_id: userId,
      target_id: data.roomId,
      metadata: {},
    });
    return { ok: true as const };
  });

/**
 * Host-only: remove a participant from the LiveKit room.
 */
export const kickRoomParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; identity: string }) =>
    z
      .object({ roomId: z.string().uuid(), identity: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!(await isRoomHost(userId, data.roomId))) {
      return { ok: false as const, error: "Host-only action" };
    }
    const cfg = getLivekitConfig();
    if (!cfg) return { ok: false as const, error: "LiveKit not configured" };

    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("livekit_room")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room) return { ok: false as const, error: "Room not found" };

    const client = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
    try {
      await client.removeParticipant(room.livekit_room, data.identity);
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Kick failed",
      };
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_type: "room.kick",
      actor_id: userId,
      target_id: data.roomId,
      metadata: { identity: data.identity },
    });
    return { ok: true as const };
  });

/**
 * Host-only: force-mute (or unmute) every published microphone track in the
 * room. Implemented by listing participants and muting each `microphone`
 * track via RoomServiceClient.mutePublishedTrack.
 */
export const muteAllRoomParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; muted: boolean }) =>
    z
      .object({ roomId: z.string().uuid(), muted: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!(await isRoomHost(userId, data.roomId))) {
      return { ok: false as const, error: "Host-only action" };
    }
    const cfg = getLivekitConfig();
    if (!cfg) return { ok: false as const, error: "LiveKit not configured" };

    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("livekit_room")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room) return { ok: false as const, error: "Room not found" };

    const client = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);

    let affected = 0;
    try {
      const participants = await client.listParticipants(room.livekit_room);
      for (const p of participants) {
        // Don't mute the host themselves.
        if (p.identity === userId) continue;
        for (const track of p.tracks) {
          if (track.source === TrackSource.MICROPHONE && track.muted !== data.muted) {
            await client
              .mutePublishedTrack(room.livekit_room, p.identity, track.sid, data.muted)
              .catch(() => {
                /* skip individual track errors */
              });
            affected += 1;
          }
        }
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Mute failed",
      };
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_type: data.muted ? "room.mute_all" : "room.unmute_all",
      actor_id: userId,
      target_id: data.roomId,
      metadata: { affected },
    });
    return { ok: true as const, affected };
  });
