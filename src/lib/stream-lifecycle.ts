import { z } from "zod";

export const STREAM_RECONNECT_MS = 5 * 60_000;
export const streamAttemptSchema = z.object({
  broadcastId: z.string().uuid(),
  participantSid: z.string().min(1),
});
export function streamSessionId(claims: Record<string, unknown>): string {
  const parsed = z.string().uuid().safeParse(claims.session_id);
  if (!parsed.success) throw new Error("Sign in again before streaming.");
  return parsed.data;
}
export type BroadcastLease = {
  id: string;
  user_id: string;
  session_id: string;
  status: string;
  last_live_at: string;
  disconnected_at: string | null;
};
export function leaseCanResume(lease: BroadcastLease, sessionId: string, now: number) {
  return (
    lease.status === "live" &&
    lease.session_id === sessionId &&
    now < Date.parse(lease.disconnected_at ?? lease.last_live_at) + STREAM_RECONNECT_MS
  );
}
