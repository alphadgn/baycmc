import { createFileRoute } from "@tanstack/react-router";

/** Scheduled enforcement for connected publishers, independent of client cooperation. */
export const Route = createFileRoute("/api/public/stream-lifecycle")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = process.env.STREAM_LIFECYCLE_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const { reconcileStreamPublishers } = await import("@/server/stream-grants.server");
      await reconcileStreamPublishers();
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false }, { status: 503 });
    }
  } } },
});