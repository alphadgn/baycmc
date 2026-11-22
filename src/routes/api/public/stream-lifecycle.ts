import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Scheduled enforcement for connected publishers, independent of client cooperation. */
export const Route = createFileRoute("/api/public/stream-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { reconcileStreamPublishers } = await import("@/server/stream-grants.server");
          await reconcileStreamPublishers();
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
