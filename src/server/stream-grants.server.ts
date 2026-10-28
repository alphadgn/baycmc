import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Single-use Event Stream host grants (see migration 20261028000004).
 * Server-only helpers shared by the stream functions and sign-out.
 */
export const STREAM_ROOM = "event-stream";

async function isStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"]);
  return (data ?? []).length > 0;
}

/**
 * Grant / revoke broadcasting for someone already in the Event Stream, so a
 * change takes effect without a rejoin. Best effort, never blocks > 4 s.
 */
export async function setLivePublish(userId: string, canPublish: boolean) {
  await Promise.race([inner(userId, canPublish), new Promise((r) => setTimeout(r, 4_000))]);
}
async function inner(userId: string, canPublish: boolean) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return;
  try {
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    const people = await client.listParticipants(STREAM_ROOM).catch(() => []);
    if (!people.some((p) => p.identity === userId)) return;
    await client.updateParticipant(STREAM_ROOM, userId, {
      permission: { canSubscribe: true, canPublish, canPublishData: true, canUpdateMetadata: true },
    });
  } catch (e) {
    console.warn("[event-stream] live permission update failed", e);
  }
}

/** The host started / is still streaming. False = no valid grant. */
export async function touchStreamGrant(userId: string): Promise<boolean> {
  if (await isStaff(userId)) return true;
  const { data } = await (
    supabaseAdmin.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: boolean | null }>
  )("stream_grant_touch", { _uid: userId });
  if (data !== true) await setLivePublish(userId, false);
  return data === true;
}

/** End the grant: "ended" (stream over → used) or a session end (expired). */
export async function finishStreamGrant(userId: string, reason: "ended" | "signed_out") {
  await (
    supabaseAdmin.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>
  )("stream_grant_finish", { _uid: userId, _reason: reason });
  if (!(await isStaff(userId))) await setLivePublish(userId, false);
}
