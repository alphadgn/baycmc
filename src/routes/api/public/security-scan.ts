import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * Hourly security-scan hook. Called by pg_cron via pg_net with
 * `Authorization: Bearer <SECURITY_SCAN_SECRET>`. Runs lightweight heuristic
 * checks and writes any findings to `public.security_scan_findings`.
 *
 * The publishable (anon) key is public — it ships in the browser bundle — so it
 * is not accepted as proof of the scheduler. Fails closed (503) until
 * SECURITY_SCAN_SECRET is configured.
 *
 * This runs on the Worker; use the service-role client so heuristics can
 * inspect audit_logs and other tables regardless of the caller's RLS.
 */
export const Route = createFileRoute("/api/public/security-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SECURITY_SCAN_SECRET?.trim();
        if (!secret) return new Response("Unavailable", { status: 503 });
        if (request.headers.get("authorization") !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const findings: Array<{
          severity: "low" | "medium" | "high" | "critical";
          category: string;
          message: string;
          metadata: Record<string, unknown>;
        }> = [];

        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // 1. Spike in audit events (>250 in the past hour)
        const { count: auditCount } = await admin
          .from("audit_logs")
          .select("*", { count: "exact", head: true })
          .gte("created_at", since);
        if ((auditCount ?? 0) > 250) {
          findings.push({
            severity: "medium",
            category: "activity_spike",
            message: `Unusual audit-log volume in last hour: ${auditCount}`,
            metadata: { count: auditCount, since },
          });
        }

        // 2. Role escalation events in the past hour
        const { data: roleEvents } = await admin
          .from("audit_logs")
          .select("id, actor_id, event_type, metadata, created_at")
          .gte("created_at", since)
          .ilike("event_type", "%role%")
          .order("created_at", { ascending: false })
          .limit(200);
        for (const ev of roleEvents ?? []) {
          findings.push({
            severity: "high",
            category: "role_change",
            message: `Role change event: ${ev.event_type}`,
            metadata: ev as unknown as Record<string, unknown>,
          });
        }

        // 3. New auth nonces without follow-up verification (possible probing)
        const { count: nonceCount } = await admin
          .from("auth_nonces")
          .select("*", { count: "exact", head: true })
          .gte("created_at", since);
        if ((nonceCount ?? 0) > 100) {
          findings.push({
            severity: "medium",
            category: "auth_nonce_spike",
            message: `High auth_nonces creation in last hour: ${nonceCount}`,
            metadata: { count: nonceCount },
          });
        }

        if (findings.length > 0) {
          await admin.from("security_scan_findings").insert(
            findings.map((f) => ({
              severity: f.severity,
              category: f.category,
              message: f.message,
              metadata: f.metadata,
            })),
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            findings: findings.length,
            scanned_at: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
