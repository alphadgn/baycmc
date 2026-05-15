import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recomputeOwnership } from "@/server/ownership.server";

type RoomAccessResult =
  | { ok: true; room: { id: string; name: string; tier: "token_proof" | "lifer"; livekit_room: string; active: boolean } }
  | { ok: false; error: string; code: "room_unavailable" | "bayc_revoked" | "otherpage_revoked" };

async function validateRoomAccess(userId: string, roomId: string): Promise<RoomAccessResult> {
  const { data: room, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,tier,livekit_room,active")
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

  if (!ver?.bayc_verified) {
    return {
      ok: false,
      error:
        "Your BAYC/MAYC access is no longer active. Reconnect a wallet that owns or is delegated an ape to enter exclusive rooms.",
      code: "bayc_revoked",
    };
  }
  if (room.tier === "lifer" && !ver.otherpage_verified) {
    return {
      ok: false,
      error:
        "Your Otherpage access is no longer active. Reconnect a wallet with active BAYC/MAYC and Otherpage access to re-enter this room.",
      code: "otherpage_revoked",
    };
  }

  return { ok: true, room };
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

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      return { ok: false as const, error: "LiveKit not configured" };
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

    const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: "2h" });
    at.addGrant({
      room: room.livekit_room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    await supabaseAdmin.from("audit_logs").insert({
      event_type: "room.join",
      actor_id: userId,
      target_id: room.id,
      metadata: { room_name: room.name, tier: room.tier },
    });

    return { ok: true as const, token, url, roomName: room.livekit_room };
  });

export const revalidateLivekitRoomAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => validateRoomAccess(context.userId, data.roomId));
