import { createFileRoute } from "@tanstack/react-router";

/** LiveKit signs the raw body. Never accept browser-reported room events. */
export const Route = createFileRoute("/api/public/livekit-stream")({
  server: { handlers: { POST: async ({ request }) => {
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!key || !secret) return new Response("Unavailable", { status: 503 });
    const { WebhookReceiver } = await import("livekit-server-sdk");
    let event: Awaited<ReturnType<InstanceType<typeof WebhookReceiver>["receive"]>>;
    try {
      event = await new WebhookReceiver(key, secret).receive(await request.text(), request.headers.get("authorization") ?? undefined);
    } catch { return new Response("Unauthorized", { status: 401 }); }
    if (event.room?.name !== "event-stream") return Response.json({ ok: true });
    try {
      const { markBroadcastDisconnected, reconcileStreamPublishers, streamMediaClient, STREAM_ROOM } = await import("@/server/stream-grants.server");
      const participant = event.participant;
      if (event.event === "participant_left" && participant) {
        // Ignore delayed leave events from the old connection after reconnect.
        const current = await (await streamMediaClient()).getParticipant(STREAM_ROOM, participant.identity).catch(() => null);
        const meta = JSON.parse(participant.metadata || "{}") as { streamSession?: string; broadcastId?: string };
        if (!current && meta.streamSession && meta.broadcastId) {
          await markBroadcastDisconnected(participant.identity, meta.streamSession, meta.broadcastId);
        }
      }
      await reconcileStreamPublishers();
      return Response.json({ ok: true });
    } catch { return Response.json({ ok: false }, { status: 503 }); }
  } } },
});