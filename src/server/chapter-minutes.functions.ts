import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Local chapter meeting minutes.
 *
 * When a meeting ends, only its host (the member who booked it) is asked to
 * archive/export the minutes: an AI-written summary of the meeting chat plus
 * the attendance list. After the host exports or dismisses, the meeting, its
 * chat messages and every reference to it are deleted (chapter_delete_meeting).
 */

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type MinutesResult =
  | {
      ok: true;
      chapter: string;
      room: string;
      startsAt: string;
      endsAt: string;
      summary: string;
      attendance: { username: string; firstJoinedAt: string; lastSeenAt: string }[];
      invited: string[];
      messageCount: number;
    }
  | { ok: false; error: string };

export const getChapterMinutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string }) =>
    z.object({ meetingId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MinutesResult> => {
    const admin = await db();
    const { data: m } = await admin
      .from("chapter_meetings")
      .select("id,chapter_id,requester_id,room_id,starts_at,ends_at,status")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!m) return { ok: false, error: "These minutes are no longer available." };
    // Host only.
    if (m.requester_id !== context.userId) {
      return { ok: false, error: "Only the member who booked this meeting can see its minutes." };
    }
    if (m.status !== "ended" && new Date(m.ends_at).getTime() > Date.now()) {
      return { ok: false, error: "The minutes are ready once the meeting has ended." };
    }

    const [{ data: chapter }, { data: room }, { data: msgs }, { data: att }, { data: inv }] =
      await Promise.all([
        admin.from("local_chapters").select("name").eq("id", m.chapter_id).maybeSingle(),
        admin.from("rooms").select("name").eq("id", m.room_id).maybeSingle(),
        admin
          .from("lobby_messages")
          .select("user_id,body,created_at")
          .eq("channel", `meeting:${m.id}`)
          .order("created_at", { ascending: true })
          .limit(1500),
        admin
          .from("chapter_meeting_attendance")
          .select("user_id,first_joined_at,last_seen_at")
          .eq("meeting_id", m.id)
          .order("first_joined_at"),
        admin.from("chapter_meeting_attendees").select("user_id").eq("meeting_id", m.id),
      ]);

    const ids = new Set<string>([m.requester_id]);
    for (const r of msgs ?? []) ids.add(r.user_id);
    for (const r of att ?? []) ids.add(r.user_id);
    for (const r of inv ?? []) ids.add(r.user_id);
    const { data: profs } = await admin
      .from("profiles")
      .select("id,username")
      .in("id", [...ids]);
    const nameOf = (id: string) => profs?.find((p) => p.id === id)?.username || "member";

    const attendance = (att ?? []).map((a) => ({
      username: nameOf(a.user_id),
      firstJoinedAt: a.first_joined_at,
      lastSeenAt: a.last_seen_at,
    }));
    const invited = [m.requester_id, ...(inv ?? []).map((i) => i.user_id)].map(nameOf);
    const lines = (msgs ?? [])
      .filter((r) => r.body && r.body.trim())
      .map((r) => `[${r.created_at.slice(11, 16)}] ${nameOf(r.user_id)}: ${r.body!.trim()}`);

    let summary = "";
    if (lines.length === 0) {
      summary = "No chat messages were posted during this meeting.";
    } else {
      const key = process.env.LOVABLE_API_KEY;
      if (!key) {
        summary = "AI summary unavailable right now. The attendance list is below.";
      } else {
        try {
          const { generateText } = await import("ai");
          const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
          const gateway = createLovableAiGatewayProvider(key);
          const transcript = lines.join("\n").slice(-60_000);
          const res = await generateText({
            model: gateway("openai/gpt-5.5"),
            system:
              "You write concise, neutral meeting minutes for a members' club chapter meeting. " +
              "Use only what is in the chat transcript. Sections: Summary (2-4 sentences), " +
              "Topics discussed (bullets), Decisions (bullets, or 'None recorded'), " +
              "Action items (bullets with the member's username, or 'None recorded'). " +
              "Plain text with simple '-' bullets. No wallet addresses. Do not invent facts.",
            prompt: `Chapter: ${chapter?.name ?? "Local chapter"}\nRoom: ${room?.name ?? ""}\nTranscript (UTC times):\n${transcript}`,
          });
          summary = res.text.trim() || "No summary could be written.";
        } catch (e) {
          console.error("chapter minutes AI failed", e);
          summary = "AI summary unavailable right now. The attendance list is below.";
        }
      }
    }

    return {
      ok: true,
      chapter: chapter?.name ?? "Local chapter",
      room: room?.name ?? "",
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      summary,
      attendance,
      invited,
      messageCount: lines.length,
    };
  });

/** Host: after exporting or dismissing — delete the meeting and its chat. */
export const closeChapterMinutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string }) =>
    z.object({ meetingId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("chapter_delete_meeting", {
      _meeting: data.meetingId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
