/**
 * Karaoke room administration (in-room admin panel + /admin/karaoke).
 *
 * Authority model:
 *   - The database decides WHO may do WHAT: every write goes through a
 *     SECURITY DEFINER RPC called with the caller's own Supabase client
 *     (karaoke_set_sanction, karaoke_update_settings, karaoke_admin_*), which
 *     re-checks admin / booking-host status server-side.
 *   - This file only adds the side effects the DB can't do: LiveKit
 *     permission changes / kicks / room teardown and storage cleanup.
 *
 * Moderators = admin / super_admin, or the holder of the room's active
 * whole-room booking. Bans, rules, room create/delete = admins only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function livekitConfig() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return null;
  return { apiKey, apiSecret, url };
}

async function roomService() {
  const cfg = livekitConfig();
  if (!cfg) return null;
  const { RoomServiceClient } = await import("livekit-server-sdk");
  return new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
}

async function livekitRoomName(roomId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("rooms")
    .select("livekit_room,kind")
    .eq("id", roomId)
    .maybeSingle();
  if (!data || data.kind !== "karaoke") return null;
  return data.livekit_room as string;
}

/** Apply (or lift) a LiveKit publish block for one member. Best effort. */
async function setLivekitPublish(roomId: string, identity: string, canPublish: boolean) {
  const svc = await roomService();
  const lk = await livekitRoomName(roomId);
  if (!svc || !lk) return;
  try {
    await svc.updateParticipant(lk, identity, {
      // Permissions are replaced atomically — list every flag we want.
      permission: {
        canPublish,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: true,
      },
    });
    if (!canPublish) {
      const p = await svc.getParticipant(lk, identity);
      for (const t of p.tracks) {
        if (!t.muted)
          await svc.mutePublishedTrack(lk, identity, t.sid, true).catch(() => undefined);
      }
    }
  } catch {
    /* participant not currently connected — the token check covers rejoin */
  }
}

const ModerateSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.enum(["mute", "unmute", "kick", "ban", "unban"]),
  minutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .optional(),
  reason: z.string().trim().max(300).optional(),
});

export const karaokeModerateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ModerateSchema>) => ModerateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.userId === userId)
      return { ok: false as const, error: "You can't moderate yourself." };

    const { data: isMod } = await supabase.rpc("karaoke_is_moderator", {
      _room: data.roomId,
      _uid: userId,
    });
    if (!isMod) return { ok: false as const, error: "Moderator only" };

    if (
      data.action === "mute" ||
      data.action === "unmute" ||
      data.action === "ban" ||
      data.action === "unban"
    ) {
      const kind = data.action === "mute" || data.action === "unmute" ? "mute" : "ban";
      const active = data.action === "mute" || data.action === "ban";
      const { error } = await supabase.rpc("karaoke_set_sanction", {
        _room: data.roomId,
        _user: data.userId,
        _kind: kind,
        _active: active,
        _minutes: data.minutes ?? undefined,
        _reason: data.reason ?? undefined,
      });
      if (error) return { ok: false as const, error: error.message };
    }

    if (data.action === "mute") await setLivekitPublish(data.roomId, data.userId, false);
    if (data.action === "unmute" || data.action === "unban") {
      await setLivekitPublish(data.roomId, data.userId, true);
    }
    if (data.action === "kick" || data.action === "ban") {
      const svc = await roomService();
      const lk = await livekitRoomName(data.roomId);
      if (svc && lk) await svc.removeParticipant(lk, data.userId).catch(() => undefined);
      if (data.action === "kick") {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("audit_logs").insert({
          event_type: "karaoke.kick",
          actor_id: userId,
          target_id: data.roomId,
          metadata: { user_id: data.userId, reason: data.reason ?? null },
        });
      }
    }
    return { ok: true as const };
  });

export const listKaraokeSanctions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS returns rows only to moderators (and each member's own rows).
    const { data: rows, error } = await supabase
      .from("karaoke_room_sanctions")
      .select("id,user_id,kind,reason,created_at,expires_at")
      .eq("room_id", data.roomId)
      .is("lifted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (rows ?? []).filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now);
  });

const SettingsSchema = z.object({
  roomId: z.string().uuid(),
  patch: z
    .object({
      rules: z.string().max(4000),
      max_song_seconds: z.number().int().min(0).max(1800),
      max_slot_minutes: z.number().int().min(5).max(60),
      max_future_bookings: z.number().int().min(0).max(20),
      booking_window_days: z.number().int().min(1).max(90),
      require_booking: z.boolean(),
      holders_priority: z.boolean(),
      allow_youtube: z.boolean(),
      allow_uploads: z.boolean(),
      recording_enabled: z.boolean(),
    })
    .partial(),
});

export const karaokeUpdateRoomSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof SettingsSchema>) => SettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("karaoke_update_settings", {
      _room: data.roomId,
      _patch: data.patch,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, settings: row };
  });

export const karaokeClearQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("karaoke_admin_clear_queue", {
      _room: data.roomId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const karaokeCreateRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; description?: string; capacity?: number }) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(500).optional(),
        capacity: z.number().int().min(2).max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("karaoke_admin_create_room", {
      _name: data.name,
      _description: data.description ?? undefined,
      _capacity: data.capacity ?? 20,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, roomId: id as string };
  });

/**
 * Permanently delete a karaoke room: recording files → DB rows (cascade) →
 * LiveKit room (disconnects everyone still inside).
 */
export const karaokeDeleteRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; confirmName: string }) =>
    z.object({ roomId: z.string().uuid(), confirmName: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("karaoke_is_admin", { _uid: userId });
    if (!isAdmin) return { ok: false as const, error: "Admin only" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("name,kind")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room || room.kind !== "karaoke")
      return { ok: false as const, error: "Karaoke room not found" };
    if (room.name.trim() !== data.confirmName.trim()) {
      return { ok: false as const, error: "Type the room name exactly to confirm." };
    }

    const { data: recs } = await supabaseAdmin
      .from("karaoke_recordings")
      .select("storage_path")
      .eq("room_id", data.roomId);
    const paths = (recs ?? []).map((r) => r.storage_path as string).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      await supabaseAdmin.storage.from("karaoke-recordings").remove(paths.slice(i, i + 100));
    }

    const { data: lk, error } = await supabase.rpc("karaoke_admin_delete_room", {
      _room: data.roomId,
    });
    if (error) return { ok: false as const, error: error.message };

    const svc = await roomService();
    if (svc && lk) await svc.deleteRoom(lk as string).catch(() => undefined);
    return { ok: true as const };
  });
