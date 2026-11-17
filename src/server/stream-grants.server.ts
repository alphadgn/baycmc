import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { leaseCanResume, type BroadcastLease } from "@/lib/stream-lifecycle";

/**
 * Single-use Event Stream host grants (see migration 20261028000004).
 * Server-only helpers shared by the stream functions and sign-out.
 */
export const STREAM_ROOM = "event-stream";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
async function rpc(name: string, args: Record<string, unknown>) {
  const result = await (supabaseAdmin.rpc as unknown as Rpc)(name, args);
  if (result.error) throw new Error("Streaming authorization unavailable. Please try again later.");
  return result.data;
}

/**
 * Grant / revoke broadcasting for someone already in the Event Stream, so a
 * change takes effect without a rejoin. Best effort, never blocks > 4 s.
 */
export function streamMediaClient() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) throw new Error("Live streaming is not configured.");
  return import("livekit-server-sdk").then(({ RoomServiceClient }) => new RoomServiceClient(url, apiKey, apiSecret));
}

export async function setLivePublish(userId: string, canPublish: false) {
  const client = await streamMediaClient();
  const people = await client.listParticipants(STREAM_ROOM);
  if (!people.some((p) => p.identity === userId)) return;
  try {
    await client.updateParticipant(STREAM_ROOM, userId, {
      permission: { canSubscribe: true, canPublish, canPublishData: false, canUpdateMetadata: false },
    });
  } catch (e) {
    // Never silently keep a revoked publisher connected.
    await client.removeParticipant(STREAM_ROOM, userId);
    console.warn("[event-stream] removed publisher after permission update failed", e);
  }
}

function binding(metadata: string) {
  try { return JSON.parse(metadata) as { streamSession?: string; broadcastId?: string }; }
  catch { return {}; }
}

/** Session comes only from verified auth claims, never from input. */
export async function authorizeBroadcast(userId: string, sessionId: string, broadcastId: string, participantSid: string, start: boolean) {
  const client = await streamMediaClient();
  const participant = await client.getParticipant(STREAM_ROOM, userId);
  if (participant.sid !== participantSid || binding(participant.metadata).streamSession !== sessionId) return false;
  const args = { _uid: userId, _session: sessionId, _id: broadcastId };
  const allowed = await rpc(start ? "stream_broadcast_claim" : "stream_broadcast_touch", args);
  if (allowed !== true) {
    // An unrelated tab cannot demote the valid owner of a competing broadcast.
    if (binding(participant.metadata).broadcastId === broadcastId) await setLivePublish(userId, false);
    return false;
  }
  try {
    const current = await client.getParticipant(STREAM_ROOM, userId);
    if (current.sid !== participantSid) return false;
    await client.updateParticipant(STREAM_ROOM, userId, {
      metadata: JSON.stringify({ streamSession: sessionId, broadcastId }),
      permission: { canSubscribe: true, canPublish: true, canPublishData: false, canUpdateMetadata: false },
    });
    // Revocation/End may have raced the media call; check again AFTER enabling.
    if (await rpc("stream_broadcast_valid", args) !== true) {
      await setLivePublish(userId, false);
      return false;
    }
    return true;
  } catch (error) {
    await setLivePublish(userId, false);
    throw error;
  }
}

export async function finishBroadcast(userId: string, sessionId: string, broadcastId: string) {
  await rpc("stream_broadcast_finish", { _uid: userId, _session: sessionId, _id: broadcastId, _reason: "ended" });
  await reconcileStreamPublishers();
}

export async function finishStreamGrant(userId: string, sessionId: string) {
  await rpc("stream_session_close", { _uid: userId, _session: sessionId });
  await setLivePublish(userId, false);
}

/** Run from the authenticated scheduler and signed LiveKit webhook, not only client heartbeats. */
export async function reconcileStreamPublishers() {
  await rpc("stream_grant_sweep", {});
  const client = await streamMediaClient();
  const people = await client.listParticipants(STREAM_ROOM);
  for (const participant of people) {
    if (!participant.permission?.canPublish) continue;
    const meta = binding(participant.metadata);
    const args = { _uid: participant.identity, _session: meta.streamSession, _id: meta.broadcastId };
    const valid = meta.streamSession && meta.broadcastId && await rpc("stream_broadcast_valid", args) === true;
    if (!valid) await setLivePublish(participant.identity, false);
  }
}

export async function resumeBroadcast(userId: string, sessionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("stream_broadcasts" as never).select("*")
    .eq("user_id", userId).eq("session_id", sessionId).eq("status", "live").maybeSingle();
  if (error) return null; // Unapplied schema must fail closed: viewers may still enter.
  const lease = data as unknown as BroadcastLease | null;
  if (!lease || !leaseCanResume(lease, sessionId, Date.now())) return null;
  return await rpc("stream_broadcast_valid", { _uid: userId, _session: sessionId, _id: lease.id }) === true ? lease.id : null;
}

export async function markBroadcastDisconnected(userId: string, sessionId: string, broadcastId: string) {
  await rpc("stream_broadcast_disconnect", { _uid: userId, _session: sessionId, _id: broadcastId });
}
