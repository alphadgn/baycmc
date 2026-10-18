import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, UserPlus, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  decideMeetingGuest,
  inviteMeetingGuests,
  listMeetingGuests,
  type MeetingGuest,
} from "@/server/room-guests.functions";

/**
 * Host / admin panel for a booked meeting in progress: who is waiting to be
 * let in (Approve / Deny), and the approved list (add by username, remove).
 * Renders nothing when no booking is running or the viewer isn't its host.
 */
export function MeetingGuestsPanel({ roomId }: { roomId: string }) {
  const list = useServerFn(listMeetingGuests);
  const decide = useServerFn(decideMeetingGuest);
  const invite = useServerFn(inviteMeetingGuests);
  const [booking, setBooking] = useState<{ id: string; title: string; endsAt: string } | null>(
    null,
  );
  const [guests, setGuests] = useState<MeetingGuest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [username, setUsername] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await list({ data: { roomId } });
      setBooking(res.booking);
      setGuests(res.guests);
    } catch {
      /* keep last state */
    }
  }, [list, roomId]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  // New requests appear instantly.
  useEffect(() => {
    if (!booking) return;
    const ch = supabase
      .channel(`meeting-guests-${booking.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_booking_guests",
          filter: `booking_id=eq.${booking.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [booking, load]);

  if (!booking) return null;

  const pending = guests.filter((g) => g.status === "pending");
  const approved = guests.filter((g) => g.status === "approved");

  async function setStatus(g: MeetingGuest, approve: boolean) {
    if (!booking) return;
    setBusy(g.userId);
    const res = await decide({ data: { bookingId: booking.id, userId: g.userId, approve } }).catch(
      (e: Error) => ({ ok: false as const, error: e.message }),
    );
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(approve ? `${g.name} can join` : `${g.name} won't be let in`);
    void load();
  }

  async function addByName() {
    if (!booking || !username.trim()) return;
    setBusy("invite");
    const res = await invite({
      data: { bookingId: booking.id, usernames: username.split(/[,\s]+/).filter(Boolean) },
    }).catch((e: Error) => ({ ok: false as const, error: e.message, missing: [] as string[] }));
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    if (res.missing.length) toast.error(`No member named: ${res.missing.join(", ")}`);
    if ("added" in res && res.added) toast.success("Added to the approved list");
    setUsername("");
    void load();
  }

  return (
    <section className="glass rounded-xl border border-gold/30 p-3 text-xs shadow-card">
      <p className="flex items-center gap-1.5 font-display text-sm text-gold">
        <Users className="h-3.5 w-3.5" /> Meeting guests
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        "{booking.title}" is in progress. Only you, admins and approved guests can enter.
      </p>

      <p className="mt-3 text-[10px] uppercase tracking-wider text-gold/70">
        Waiting to join {pending.length > 0 && `(${pending.length})`}
      </p>
      {pending.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">No one is waiting.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {pending.map((g) => (
            <li
              key={g.userId}
              className="flex items-center justify-between gap-2 rounded-md bg-gold/5 px-2 py-1"
            >
              <span className="truncate">{g.name}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busy === g.userId}
                  onClick={() => void setStatus(g, true)}
                  className="inline-flex items-center gap-0.5 rounded border border-emerald-400/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 disabled:opacity-50"
                >
                  {busy === g.userId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy === g.userId}
                  onClick={() => void setStatus(g, false)}
                  className="inline-flex items-center gap-0.5 rounded border border-destructive/50 px-1.5 py-0.5 text-[10px] font-semibold text-destructive disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> Deny
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10px] uppercase tracking-wider text-gold/70">Approved list</p>
      {approved.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">No guests approved yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {approved.map((g) => (
            <li key={g.userId} className="flex items-center justify-between gap-2 px-2">
              <span className="truncate">{g.name}</span>
              <button
                type="button"
                disabled={busy === g.userId}
                onClick={() => void setStatus(g, false)}
                className="text-[10px] text-muted-foreground underline hover:text-destructive disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-1.5">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addByName();
          }}
          placeholder="Add username(s)"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
        />
        <button
          type="button"
          disabled={busy === "invite" || !username.trim()}
          onClick={() => void addByName()}
          className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-2 py-1 text-[10px] font-semibold text-gold-foreground disabled:opacity-50"
        >
          <UserPlus className="h-3 w-3" /> Add
        </button>
      </div>
    </section>
  );
}
