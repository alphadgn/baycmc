import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recomputeOwnership } from "@/server/ownership.server";

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

    const { data: room, error } = await supabase
      .from("rooms")
      .select("id,name,tier,livekit_room,active")
      .eq("id", data.roomId)
      .maybeSingle();
    if (error || !room) {
      return { ok: false as const, error: "Room not found or access denied" };
    }
    if (!room.active) {
      return { ok: false as const, error: "Room is inactive" };
    }

    // Real-time access validation: re-run on-chain BAYC/MAYC + delegate.cash
    // lookup at the moment of room entry so revoked delegations or sold
    // tokens immediately lock the user out.
    const fresh = await recomputeOwnership(userId).catch((e) => {
      console.error("recomputeOwnership at room entry failed", e);
      return null;
    });

    const ver = fresh
      ? {
          bayc_verified: fresh.tokenProof,
          otherpage_verified: fresh.otherpageVerified,
        }
      : (
          await supabase
            .from("user_verifications")
            .select("bayc_verified, otherpage_verified")
            .eq("user_id", userId)
            .maybeSingle()
        ).data;

    if (!ver?.bayc_verified) {
      return { ok: false as const, error: "BAYC/MAYC ownership required (or revoked)" };
    }
    if (room.tier === "lifer" && !ver.otherpage_verified) {
      return { ok: false as const, error: "Lifer badge required" };
    }

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
