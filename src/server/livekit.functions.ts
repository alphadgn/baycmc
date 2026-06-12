import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RoomRecord = {
  id: string;
  name: string;
  tier: "token_proof" | "lifer" | "public";
  kind: string;
  livekit_room: string;
  capacity: number;
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
        | "room_booked"
        | "room_full"
        | "bayc_revoked"
        | "otherpage_revoked";
    };

async function validateRoomAccess(userId: string, roomId: string): Promise<RoomAccessResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: room, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,tier,kind,livekit_room,capacity,active,is_locked")
    .eq("id", roomId)
    .maybeSingle();
  if (error || !room || !room.active) {
    return { ok: false, error: "Room not found or inactive", code: "room_unavailable" };
  }

  const isKaraoke = room.kind === "karaoke";
  const isPublicRoom = room.tier === "public";

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

  // Karaoke is open for drop-in participation except during an active booking;
  // the booking owner/admin is treated as host and may still enter.
  if (isKaraoke && (await hasActiveBooking(roomId)) && !(await isRoomHost(userId, roomId))) {
    return {
      ok: false,
      error:
        "This karaoke room is currently reserved for a booked session. Try again after the booking ends.",
      code: "room_booked",
    };
  }

  // Public rooms (including Karaoke) must not run BAYC/Lumina/Otherpage gates.
  if (isPublicRoom || isKaraoke) {
    return { ok: true, room };
  }

  // Re-run on-chain BAYC/MAYC + delegate.cash and Otherpage checks at the
  // moment access is requested or refreshed. This is the hard gate that makes
  // revoked delegations/sold tokens stop future room entry and token minting.
  const { recomputeOwnership } = await import("@/server/ownership.server");
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
  const isAdmin = !!roleRows?.some((r) => r.role === "super_admin" || r.role === "admin");
  const bypassesBaycGate = isAdmin || !!roleRows?.some((r) => r.role === "verified_user");

  if (!ver?.bayc_verified && !bypassesBaycGate) {
    return {
      ok: false,
      error:
        "Your BAYC/MAYC access is no longer active. Reconnect a wallet that owns or is delegated an ape to enter exclusive rooms.",
      code: "bayc_revoked",
    };
  }
  if (room.tier === "lifer" && !isAdmin && !(ver?.bayc_verified && ver?.otherpage_verified)) {
    return {
      ok: false,
      error:
        "Lifer rooms require both a verified BAYC/MAYC holding and an Otherpage / Lifer token in your wallet.",
      code: "otherpage_revoked",
    };
  }

  return { ok: true, room };
}

async function hasActiveBooking(roomId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function isRoomHost(userId: string, roomId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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

    const activeParticipants = await listActiveParticipants(cfg, room.livekit_room);
    if (activeParticipants !== null && activeParticipants >= room.capacity) {
      return {
        ok: false as const,
        error: "This room is at capacity. Please wait for someone to leave before joining.",
        code: "room_full" as const,
      };
    }

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

async function listActiveParticipants(
  cfg: { apiKey: string; apiSecret: string; url: string },
  livekitRoom: string,
): Promise<number | null> {
  const client = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
  try {
    const participants = await client.listParticipants(livekitRoom);
    return participants.length;
  } catch (e) {
    console.warn("LiveKit participant count failed", e);
    return null;
  }
}

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
    z.object({ roomId: z.string().uuid(), locked: z.boolean() }).parse(input),
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
    z.object({ roomId: z.string().uuid(), identity: z.string().min(1) }).parse(input),
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
    z.object({ roomId: z.string().uuid(), muted: z.boolean() }).parse(input),
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

    // Muting force-mutes every live mic; un-muting only LIFTS the lock (via
    // the metadata flag below) and lets each member choose to speak again —
    // we deliberately don't force every mic back on, so anyone who muted
    // themselves voluntarily stays muted.
    let affected = 0;
    if (data.muted) {
      try {
        const participants = await client.listParticipants(room.livekit_room);
        for (const p of participants) {
          // Don't mute the host themselves.
          if (p.identity === userId) continue;
          for (const track of p.tracks) {
            if (track.source === TrackSource.MICROPHONE && !track.muted) {
              await client
                .mutePublishedTrack(room.livekit_room, p.identity, track.sid, true)
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
    }

    // Broadcast a room-wide mic lock via room metadata. While `micLock` is
    // true every client disables its un-mute control, so a muted member
    // can't simply turn their mic back on until the host lifts it. We merge
    // into any existing metadata so unrelated keys survive.
    try {
      let meta: Record<string, unknown> = {};
      const [existing] = await client.listRooms([room.livekit_room]).catch(() => []);
      if (existing?.metadata) {
        try {
          meta = JSON.parse(existing.metadata) as Record<string, unknown>;
        } catch {
          /* corrupt metadata — overwrite */
        }
      }
      meta.micLock = data.muted;
      await client.updateRoomMetadata(room.livekit_room, JSON.stringify(meta));
    } catch (e) {
      console.warn("updateRoomMetadata micLock failed", e);
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_type: data.muted ? "room.mute_all" : "room.unmute_all",
      actor_id: userId,
      target_id: data.roomId,
      metadata: { affected },
    });
    return { ok: true as const, affected };
  });
