import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Event Stream: admin statistics (live / viewers / hosted by) and super
 * admin host assignment. LiveKit is the source of truth for who is in the
 * room right now; the database only stores which accounts may broadcast.
 */
const STREAM_ROOM = "event-stream";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function roles(userId: string) {
  const { data } = await (await db()).from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}
async function requireAdmin(userId: string) {
  const r = await roles(userId);
  if (!r.includes("admin") && !r.includes("super_admin")) throw new Error("Forbidden: admin only");
  return r.includes("super_admin");
}
async function requireSuperAdmin(userId: string) {
  if (!(await roles(userId)).includes("super_admin")) {
    throw new Error("Forbidden: super admin only");
  }
}

export interface StreamStats {
  configured: boolean;
  live: boolean;
  viewers: number;
  capacity: number;
  hostedBy: { userId: string; name: string }[];
  assignedHosts: { userId: string; name: string }[];
  roomId: string | null;
  checkedAt: string;
}

export const getEventStreamStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StreamStats> => {
    await requireAdmin(context.userId);
    const admin = await db();
    const [{ data: room }, { data: hostRows }] = await Promise.all([
      admin.from("rooms").select("id,capacity").eq("livekit_room", STREAM_ROOM).maybeSingle(),
      admin.from("event_stream_hosts").select("user_id"),
    ]);
    const hostIds = (hostRows ?? []).map((h) => h.user_id as string);
    const names = new Map<string, string>();
    if (hostIds.length) {
      const { data: profs } = await admin.from("profiles").select("id,username").in("id", hostIds);
      for (const p of profs ?? [])
        names.set(p.id as string, (p.username as string | null) ?? "Member");
    }
    const base: StreamStats = {
      configured: false,
      live: false,
      viewers: 0,
      capacity: (room?.capacity as number | undefined) ?? 250,
      hostedBy: [],
      assignedHosts: hostIds.map((id) => ({ userId: id, name: names.get(id) ?? "Member" })),
      roomId: (room?.id as string | undefined) ?? null,
      checkedAt: new Date().toISOString(),
    };
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return base;

    const { RoomServiceClient } = await import("livekit-server-sdk");
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    let participants: Awaited<ReturnType<typeof client.listParticipants>> = [];
    try {
      participants = await client.listParticipants(STREAM_ROOM);
    } catch {
      // Room not created yet = nobody has joined; that's "not live".
      return { ...base, configured: true };
    }
    // Broadcasting = publishing at least one track (camera / screen / mic).
    const broadcasters = participants.filter((p) => (p.tracks ?? []).length > 0);
    return {
      ...base,
      configured: true,
      live: broadcasters.length > 0,
      viewers: participants.length - broadcasters.length,
      hostedBy: broadcasters.map((p) => ({ userId: p.identity, name: p.name || "Host" })),
    };
  });

/** Super admin: assign a broadcaster by username. */
export const addEventStreamHost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { username: string }) =>
    z.object({ username: z.string().trim().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    const { data: prof } = await admin
      .from("profiles")
      .select("id,username")
      .ilike("username", data.username.replace(/^@/, ""))
      .maybeSingle();
    if (!prof) return { ok: false as const, error: "No member with that username." };
    const { error } = await admin
      .from("event_stream_hosts")
      .upsert({ user_id: prof.id, assigned_by: context.userId }, { onConflict: "user_id" });
    if (error) return { ok: false as const, error: error.message };
    await admin.from("audit_logs").insert({
      event_type: "event_stream.host_add",
      actor_id: context.userId,
      target_id: prof.id,
    });
    return { ok: true as const };
  });

export const removeEventStreamHost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const admin = await db();
    await admin.from("event_stream_hosts").delete().eq("user_id", data.userId);
    await admin.from("audit_logs").insert({
      event_type: "event_stream.host_remove",
      actor_id: context.userId,
      target_id: data.userId,
    });
    return { ok: true as const };
  });
