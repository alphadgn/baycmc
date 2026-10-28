import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

export type ChapterMeeting = {
  id: string;
  chapter_id: string;
  requester_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
  expected_capacity: number;
  notes: string | null;
  status: "pending" | "approved" | "declined" | "cancelled" | "ended";
  leader_labels: string[];
  review_note: string | null;
  created_at: string;
};

export type ChapterRoom = {
  id: string;
  name: string;
  theme: string | null;
  capacity: number;
  number: number;
};

export const MEETING_COLUMNS =
  "id,chapter_id,requester_id,room_id,starts_at,ends_at,expected_capacity,notes,status,leader_labels,review_note,created_at";

/** Is this member allowed into Local Chapters (BAYC/MAYC/CryptoPunks + staff)? */
export function useChapterViewer(): boolean | null {
  const { user } = useAuth();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) {
      setOk(null);
      return;
    }
    let cancelled = false;
    void supabase.rpc("chapter_viewer", { _uid: user.id }).then(({ data }) => {
      if (!cancelled) setOk(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);
  return ok;
}

/** The 20 Club Rooms with their numbers. Staff see them; others get them via the booking list. */
export function roomNumber(name: string): number {
  const m = /(\d+)\s*$/.exec(name);
  return m ? Number(m[1]) : 0;
}

export function formatMeetingTime(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const day = s.toLocaleDateString(undefined, {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(s)} – ${t(e)}`;
}

export function durationLabel(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** Room open for this meeting now (10 minutes before the start until the end)? */
export function meetingOpen(m: Pick<ChapterMeeting, "starts_at" | "ends_at" | "status">): boolean {
  const now = Date.now();
  return (
    m.status === "approved" &&
    now >= new Date(m.starts_at).getTime() - 10 * 60_000 &&
    now <= new Date(m.ends_at).getTime()
  );
}

export const STATUS_LABEL: Record<ChapterMeeting["status"], string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  ended: "Ended",
};

/** The 20 Club Rooms (booking catalogue), numbered. */
export function useChapterRooms(): ChapterRoom[] | null {
  const [rooms, setRooms] = useState<ChapterRoom[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("chapter_room_catalog").then(({ data }) => {
      if (cancelled) return;
      setRooms((data ?? []).map((r) => ({ ...r, number: roomNumber(r.name) })));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return rooms;
}

export type LocalChapter = { id: string; name: string; display_order: number; active: boolean };

export function useLocalChapters(includeInactive = false): LocalChapter[] | null {
  const [rows, setRows] = useState<LocalChapter[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      let q = supabase
        .from("local_chapters")
        .select("id,name,display_order,active")
        .order("display_order")
        .order("name");
      if (!includeInactive) q = q.eq("active", true);
      void q.then(({ data }) => {
        if (!cancelled) setRows(data ?? []);
      });
    };
    load();
    window.addEventListener("baycmc:chapters-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("baycmc:chapters-changed", load);
    };
  }, [includeInactive]);
  return rows;
}
