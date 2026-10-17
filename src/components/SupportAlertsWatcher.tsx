import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  read_at: string | null;
}

const SUPPORT_KINDS = ["support", "support_reply"];
/** Event Stream host assignment ("start streaming"). */
const STREAM_KINDS = ["stream_host"];
const ALERT_KINDS = [...SUPPORT_KINDS, ...STREAM_KINDS];

/**
 * Support + Event Stream alerts. Assigning an Event Stream host also writes
 * a "Start streaming" notification for that member.
 *
 * A database trigger writes a notification for every admin
 * and super admin when a member sends a support message, and one for the
 * member when staff reply. This shows them as toasts — live while the app is
 * open, and any unread ones on the next visit — and marks them read once the
 * matching support page is opened.
 */
export function SupportAlertsWatcher() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const shownRef = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const markRead = async (ids: string[]) => {
      if (!ids.length) return;
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
    };

    const show = (n: NotificationRow) => {
      if (shownRef.current.has(n.id)) return;
      shownRef.current.add(n.id);
      const target = n.url ?? (n.kind === "support" ? "/admin/support" : "/support");
      // Already looking at that conversation → just mark it read.
      if (router.state.location.pathname === target.split("?")[0]) {
        void markRead([n.id]);
        return;
      }
      const isStream = STREAM_KINDS.includes(n.kind);
      toast(n.title, {
        description: n.body ?? undefined,
        duration: isStream ? 30_000 : 12_000,
        action: {
          label: isStream ? "Start streaming" : "Open",
          onClick: () => {
            void markRead([n.id]);
            void router.navigate({ href: target });
          },
        },
      });
    };

    // Unread from while the member was away.
    void (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id,kind,title,body,url,read_at")
        .eq("user_id", userId)
        .in("kind", ALERT_KINDS)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled || !data?.length) return;
      const all = data as NotificationRow[];
      // Host assignments always get their own "Start streaming" alert.
      const streamRows = all.filter((r) => STREAM_KINDS.includes(r.kind));
      if (streamRows[0]) show(streamRows[0]);
      if (streamRows.length > 1) void markRead(streamRows.slice(1).map((r) => r.id));
      const rows = all.filter((r) => SUPPORT_KINDS.includes(r.kind));
      if (rows.length === 0) return;
      if (rows.length === 1) show(rows[0]!);
      else {
        rows.forEach((r) => shownRef.current.add(r.id));
        const staff = rows.some((r) => r.kind === "support");
        toast(
          staff
            ? `${rows.length} unread support requests`
            : `${rows.length} unread replies from support`,
          {
            duration: 12_000,
            action: {
              label: "Open",
              onClick: () => {
                void markRead(rows.map((r) => r.id));
                void router.navigate({ to: staff ? "/admin/support" : "/support" });
              },
            },
          },
        );
      }
    })();

    const channel = supabase
      .channel(`support-alerts-${userId}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as NotificationRow;
          if (ALERT_KINDS.includes(n.kind)) show(n);
        },
      )
      .subscribe();

    // Opening a support page clears its alerts.
    const unsub = router.subscribe("onResolved", ({ toLocation }) => {
      const path = toLocation.pathname;
      const kind =
        path === "/admin/support"
          ? "support"
          : path === "/support"
            ? "support_reply"
            : path === "/event-stream"
              ? "stream_host"
              : null;
      if (!kind) return;
      void supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("kind", kind)
        .is("read_at", null);
    });

    return () => {
      cancelled = true;
      unsub();
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
