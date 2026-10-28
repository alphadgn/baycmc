/**
 * In-room karaoke admin panel.
 *
 *   Rules & settings — admins (song length cap, slot length, booking-only,
 *                      holder priority, YouTube / uploads / recording on-off,
 *                      house rules shown to everyone)
 *   Members          — moderators (admins + active booking host): mute
 *                      (10 min / 1 h / until lifted), unmute, kick; admins
 *                      can also ban
 *   Stage            — skip performer, clear the line, lock room
 *   Danger zone      — admins: delete the room permanently
 *
 * Every action is re-authorised server-side (SECURITY DEFINER RPCs +
 * server functions); hiding buttons here is UX only.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  Loader2,
  Lock,
  MicOff,
  Shield,
  SkipForward,
  Trash2,
  UserX,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import {
  karaokeClearQueue,
  karaokeDeleteRoom,
  karaokeModerateMember,
  karaokeUpdateRoomSettings,
  listKaraokeSanctions,
} from "@/server/karaoke-admin.functions";
import { setRoomLocked } from "@/server/livekit.functions";
import type { KaraokeRoomSettings } from "@/lib/karaoke/stageStore";

interface Present {
  user_id: string;
  last_seen_at: string;
}
interface Sanction {
  id: string;
  user_id: string;
  kind: string;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
}

export function KaraokeAdminPanel({
  roomId,
  roomName,
  settings,
  isAdmin,
}: {
  roomId: string;
  roomName: string;
  settings: KaraokeRoomSettings;
  isAdmin: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const moderate = useServerFn(karaokeModerateMember);
  const listSanctions = useServerFn(listKaraokeSanctions);
  const saveSettings = useServerFn(karaokeUpdateRoomSettings);
  const clearQueue = useServerFn(karaokeClearQueue);
  const deleteRoom = useServerFn(karaokeDeleteRoom);
  const lockRoom = useServerFn(setRoomLocked);

  const [draft, setDraft] = useState<KaraokeRoomSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const [saving, setSaving] = useState(false);
  const [present, setPresent] = useState<Present[]>([]);
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [locked, setLocked] = useState<boolean | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const [{ data: pres }, sanc, { data: room }] = await Promise.all([
      supabase
        .from("karaoke_presence")
        .select("user_id,last_seen_at")
        .eq("room_id", roomId)
        .gt("last_seen_at", since),
      listSanctions({ data: { roomId } }).catch(() => [] as Sanction[]),
      supabase.from("rooms").select("is_locked").eq("id", roomId).maybeSingle(),
    ]);
    const p = (pres ?? []) as Present[];
    setPresent(p);
    setSanctions(sanc as Sanction[]);
    setLocked(!!room?.is_locked);
    const ids = Array.from(
      new Set([...p.map((x) => x.user_id), ...(sanc as Sanction[]).map((s) => s.user_id)]),
    );
    if (ids.length) {
      const { data } = await supabase.rpc("member_profiles").select("id,username").in("id", ids);
      const map: Record<string, string> = {};
      for (const id of ids) map[id] = `Member ${id.slice(0, 4)}`;
      for (const r of (data ?? []) as { id: string; username: string | null }[])
        if (r.username) map[r.id] = r.username;
      setNames(map);
    }
  }, [roomId, listSanctions]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function act(
    userId: string,
    action: "mute" | "unmute" | "kick" | "ban" | "unban",
    minutes?: number,
  ) {
    const res = await moderate({
      data: { roomId, userId, action, minutes, reason: reason.trim() || undefined },
    });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success(`${names[userId] ?? "Member"}: ${action}${minutes ? ` (${minutes} min)` : ""}`);
      void load();
    }
  }

  async function save() {
    setSaving(true);
    const res = await saveSettings({ data: { roomId, patch: draft } });
    setSaving(false);
    if (!res.ok) toast.error(res.error);
    else toast.success("Room rules saved");
  }

  async function skip() {
    const { data: s } = await supabase
      .from("karaoke_sessions")
      .select("generation")
      .eq("room_id", roomId)
      .maybeSingle();
    const { error } = await supabase.rpc("karaoke_end_turn", {
      _room: roomId,
      _expected_generation: (s?.generation as number | undefined) ?? undefined,
    });
    if (error) toast.error(error.message);
    else toast.success("Performer skipped");
  }

  const mutedIds = new Set(sanctions.filter((s) => s.kind === "mute").map((s) => s.user_id));
  const bannedIds = new Set(sanctions.filter((s) => s.kind === "ban").map((s) => s.user_id));
  const card = "space-y-3 rounded-lg border border-gold/20 bg-black/30 p-3";
  const h = "flex items-center gap-2 font-display text-sm uppercase tracking-[0.25em] text-gold";
  const small = "rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-40";

  function Toggle({ k, label }: { k: keyof KaraokeRoomSettings; label: string }) {
    return (
      <label className="flex items-center justify-between gap-2 text-xs text-foreground">
        {label}
        <input
          type="checkbox"
          disabled={!isAdmin}
          checked={Boolean(draft[k])}
          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.checked }))}
        />
      </label>
    );
  }
  function Num({
    k,
    label,
    min,
    max,
    step = 1,
  }: {
    k: keyof KaraokeRoomSettings;
    label: string;
    min: number;
    max: number;
    step?: number;
  }) {
    return (
      <label className="flex items-center justify-between gap-2 text-xs text-foreground">
        {label}
        <input
          type="number"
          disabled={!isAdmin}
          min={min}
          max={max}
          step={step}
          value={Number(draft[k])}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)),
            }))
          }
          className="w-20 rounded-md border border-border bg-secondary/30 px-2 py-1 text-right"
        />
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className={h}>
          <Shield className="h-4 w-4" /> Rules & settings
        </h3>
        <textarea
          value={draft.rules}
          disabled={!isAdmin}
          onChange={(e) => setDraft((d) => ({ ...d, rules: e.target.value }))}
          rows={4}
          maxLength={4000}
          placeholder="House rules shown to everyone in the room (one per line)…"
          className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-sm"
        />
        <Num
          k="max_song_seconds"
          label="Max song length (seconds, 0 = none)"
          min={0}
          max={1800}
          step={30}
        />
        <Num k="max_slot_minutes" label="Max booking slot (minutes)" min={5} max={60} step={5} />
        <Num k="max_future_bookings" label="Upcoming bookings per member" min={0} max={20} />
        <Num k="booking_window_days" label="Booking window (days)" min={1} max={90} />
        <Toggle k="require_booking" label="Booking-only (no open-mic line)" />
        <Toggle k="holders_priority" label="BAYC/MAYC holders go first in line" />
        <Toggle k="allow_youtube" label="Allow YouTube tracks" />
        <Toggle k="allow_uploads" label="Allow uploaded backing tracks" />
        <Toggle k="recording_enabled" label="Record performances" />
        {isAdmin ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
          </button>
        ) : (
          <p className="text-[11px] text-muted-foreground">Only admins can change room rules.</p>
        )}
      </section>

      <section className={card}>
        <h3 className={h}>
          <SkipForward className="h-4 w-4" /> Stage
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void skip()}
            className={`${small} border-amber-400/50 text-amber-200`}
          >
            Skip performer
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await clearQueue({ data: { roomId } });
              if (!r.ok) toast.error(r.error);
              else toast.success("Line cleared");
            }}
            className={`${small} border-rose-400/50 text-rose-300`}
          >
            Clear the line
          </button>
          {locked !== null && (
            <button
              type="button"
              onClick={async () => {
                const r = await lockRoom({ data: { roomId, locked: !locked } });
                if (!r.ok) toast.error(r.error);
                else setLocked(!locked);
              }}
              className={`${small} border-gold/50 text-gold`}
            >
              <Lock className="mr-1 inline h-3 w-3" />
              {locked ? "Unlock room" : "Lock room"}
            </button>
          )}
        </div>
      </section>

      <section className={card}>
        <h3 className={h}>
          <MicOff className="h-4 w-4" /> Members in the room
        </h3>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, logged)"
          maxLength={300}
          className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs"
        />
        {present.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody else is here right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {present
              .filter((p) => p.user_id !== user?.id)
              .map((p) => {
                const muted = mutedIds.has(p.user_id);
                return (
                  <li
                    key={p.user_id}
                    className="space-y-1 rounded-md border border-border/60 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{names[p.user_id] ?? "Member"}</span>
                      {muted && <span className="text-[10px] uppercase text-rose-300">muted</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {muted ? (
                        <button
                          type="button"
                          onClick={() => void act(p.user_id, "unmute")}
                          className={`${small} border-emerald-400/50 text-emerald-300`}
                        >
                          <Volume2 className="mr-1 inline h-3 w-3" />
                          Unmute
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void act(p.user_id, "mute", 10)}
                            className={`${small} border-gold/40 text-gold`}
                          >
                            Mute 10m
                          </button>
                          <button
                            type="button"
                            onClick={() => void act(p.user_id, "mute", 60)}
                            className={`${small} border-gold/40 text-gold`}
                          >
                            1h
                          </button>
                          <button
                            type="button"
                            onClick={() => void act(p.user_id, "mute")}
                            className={`${small} border-gold/40 text-gold`}
                          >
                            Until lifted
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => void act(p.user_id, "kick")}
                        className={`${small} border-amber-400/50 text-amber-200`}
                      >
                        <UserX className="mr-1 inline h-3 w-3" />
                        Kick
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void act(p.user_id, "ban")}
                          className={`${small} border-rose-400/60 text-rose-300`}
                        >
                          <Ban className="mr-1 inline h-3 w-3" />
                          Ban
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
        {sanctions.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Active mutes & bans
            </p>
            {sanctions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md bg-secondary/20 px-2 py-1 text-xs"
              >
                <span>
                  {names[s.user_id] ?? "Member"} · {s.kind}
                  {s.expires_at
                    ? ` until ${new Date(s.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : ""}
                  {s.reason ? ` — ${s.reason}` : ""}
                </span>
                {(s.kind === "mute" || isAdmin) && (
                  <button
                    type="button"
                    onClick={() => void act(s.user_id, s.kind === "ban" ? "unban" : "unmute")}
                    className="text-[11px] text-gold hover:underline"
                  >
                    Lift
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {bannedIds.size > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Banned members can't re-enter this room.
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <h3 className="flex items-center gap-2 font-display text-sm uppercase tracking-[0.25em] text-destructive">
            <Trash2 className="h-4 w-4" /> Delete room
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Permanently deletes this room, its queue, bookings, rules and every recorded take, and
            disconnects everyone. Type{" "}
            <span className="font-semibold text-foreground">{roomName}</span> to confirm.
          </p>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={confirmName.trim() !== roomName.trim()}
            onClick={async () => {
              const r = await deleteRoom({ data: { roomId, confirmName } });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Room deleted");
              void navigate({ to: "/lobby" });
            }}
            className="w-full rounded-md border border-destructive/60 bg-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:opacity-40"
          >
            Delete permanently
          </button>
        </section>
      )}
    </div>
  );
}
