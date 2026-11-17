import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { karaokeMicLocked, canJoinKaraokeQueue } from "@/lib/room-workflow";
import { leaseCanResume, streamSessionId } from "@/lib/stream-lifecycle";

// Explicit isolated test socket only. NEVER accepts the app's connection string.
const isolated = process.env.BAYCMC_ISOLATED_DB === "1";
const sql = postgres({ host: "/tmp/baycmc-workflow-db", port: 55439, username: "lovable", database: "postgres", max: 5 });
const uid = "00000000-0000-4000-8000-000000000001";
const sid = "00000000-0000-4000-8000-000000000002";
const otherSession = "00000000-0000-4000-8000-000000000003";
const attempt = "00000000-0000-4000-8000-000000000004";
const attempt2 = "00000000-0000-4000-8000-000000000005";
const room = "00000000-0000-4000-8000-000000000006";
const singer2 = "00000000-0000-4000-8000-000000000007";

describe("room workflow boundaries", () => {
  it("regular conference rooms never inherit performer mic locks", () => {
    expect(karaokeMicLocked("conference", uid, false)).toBe(false);
    expect(karaokeMicLocked("karaoke", uid, false)).toBe(true);
  });
  it("queue invitation stops when queued or performing", () => {
    const input = { signedIn: true, queued: false, performing: false, bookingOnly: false, reserved: false, sanctioned: false };
    expect(canJoinKaraokeQueue(input)).toBe(true);
    expect(canJoinKaraokeQueue({ ...input, queued: true })).toBe(false);
    expect(canJoinKaraokeQueue({ ...input, performing: true })).toBe(false);
    expect(canJoinKaraokeQueue({ ...input, sanctioned: true })).toBe(false);
  });
  it("reconnection has an exact five-minute cutoff and the same session", () => {
    const lease = { id: attempt, user_id: uid, session_id: sid, status: "live", last_live_at: new Date(0).toISOString(), disconnected_at: null };
    expect(leaseCanResume(lease, sid, 299999)).toBe(true);
    expect(leaseCanResume(lease, sid, 300000)).toBe(false);
    expect(leaseCanResume(lease, otherSession, 1)).toBe(false);
    expect(() => streamSessionId({ session_id: "browser-chosen" })).toThrow();
  });
});

describe.skipIf(!isolated)("isolated PostgreSQL: actual staged lifecycle functions", () => {
  beforeAll(async () => {
    await sql.unsafe(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
      CREATE TYPE public.app_role AS ENUM('admin','super_admin','verified_user');
      CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
      CREATE FUNCTION public.has_role(_uid uuid,_role public.app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role=_role) $$;
      CREATE TABLE public.audit_logs(event_type text,actor_id uuid,target_id uuid);
      CREATE TABLE public.stream_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,granted_by uuid,status text DEFAULT 'active',created_at timestamptz DEFAULT now(),started_at timestamptz,last_live_at timestamptz,ended_at timestamptz,end_reason text);
      CREATE UNIQUE INDEX one_grant ON public.stream_grants(user_id) WHERE status IN ('active','in_use');
      INSERT INTO auth.sessions VALUES('${sid}','${uid}',NULL),('${otherSession}','${uid}',NULL);
    `);
    await sql.unsafe(readFileSync("docs/review/20261117_stream_session_lifecycle.sql", "utf8"));
  });
  it("member cannot start without a grant", async () => {
    const [r] = await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${attempt}) AS ok`;
    expect(r.ok).toBe(false);
  });
  it("atomic competing starts consume one grant once; identical retry succeeds", async () => {
    await sql`INSERT INTO public.stream_grants(user_id) VALUES(${uid})`;
    const results = await Promise.all([
      sql`SELECT public.stream_broadcast_claim(${uid},${sid},${attempt}) AS ok`,
      sql`SELECT public.stream_broadcast_claim(${uid},${otherSession},${attempt2}) AS ok`,
    ]);
    expect(results.map(([r]) => r.ok).filter(Boolean)).toHaveLength(1);
    const [b] = await sql`SELECT * FROM public.stream_broadcasts WHERE status='live'`;
    const [retry] = await sql`SELECT public.stream_broadcast_claim(${uid},${b.session_id},${b.id}) AS ok`;
    expect(retry.ok).toBe(true);
    const [g] = await sql`SELECT status FROM public.stream_grants WHERE user_id=${uid}`;
    expect(g.status).toBe("in_use");
  });
  it("same broadcast reconnects within five minutes, cannot reconnect after", async () => {
    const [b] = await sql`SELECT * FROM public.stream_broadcasts WHERE status='live'`;
    await sql`UPDATE public.stream_broadcasts SET disconnected_at=now()-interval '4 minutes' WHERE id=${b.id}`;
    expect((await sql`SELECT public.stream_broadcast_touch(${uid},${b.session_id},${b.id}) AS ok`)[0].ok).toBe(true);
    await sql`UPDATE public.stream_broadcasts SET disconnected_at=now()-interval '5 minutes' WHERE id=${b.id}`;
    expect((await sql`SELECT public.stream_broadcast_touch(${uid},${b.session_id},${b.id}) AS ok`)[0].ok).toBe(false);
    expect((await sql`SELECT status FROM public.stream_grants WHERE user_id=${uid}`)[0].status).toBe("expired");
  });
  it("admin and super admin start without grants; End consumes the broadcast", async () => {
    for (const role of ["admin", "super_admin"]) {
      await sql`DELETE FROM public.user_roles`;
      await sql`INSERT INTO public.user_roles VALUES(${uid},${role})`;
      const id = crypto.randomUUID();
      expect((await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${id}) AS ok`)[0].ok).toBe(true);
      await sql`SELECT public.stream_broadcast_finish(${uid},${sid},${id},'ended')`;
      expect((await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${id}) AS ok`)[0].ok).toBe(false);
    }
    await sql`DELETE FROM public.user_roles`;
  });
  it("member End consumes grant; a fresh broadcast needs a fresh grant", async () => {
    const id = crypto.randomUUID();
    await sql`INSERT INTO public.stream_grants(user_id) VALUES(${uid})`;
    expect((await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${id}) AS ok`)[0].ok).toBe(true);
    await sql`SELECT public.stream_broadcast_finish(${uid},${sid},${id},'ended')`;
    expect((await sql`SELECT status FROM public.stream_grants WHERE user_id=${uid} ORDER BY created_at DESC LIMIT 1`)[0].status).toBe("used");
    expect((await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${crypto.randomUUID()}) AS ok`)[0].ok).toBe(false);
  });
  it("revocation invalidates connected broadcast authorization", async () => {
    const id = crypto.randomUUID();
    await sql`INSERT INTO public.stream_grants(user_id) VALUES(${uid})`;
    await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${id})`;
    await sql`INSERT INTO public.user_roles VALUES(${uid},'admin')`;
    await sql.begin(async (tx) => { await tx`SELECT set_config('test.uid',${uid},true)`; await tx`SELECT public.stream_grant_revoke(${uid})`; });
    expect((await sql`SELECT public.stream_broadcast_valid(${uid},${sid},${id}) AS ok`)[0].ok).toBe(false);
    await sql`DELETE FROM public.user_roles`;
  });
  it("sign-out/inactivity closes session and expires unused grants", async () => {
    await sql`INSERT INTO public.stream_grants(user_id) VALUES(${uid})`;
    await sql`SELECT public.stream_session_close(${uid},${sid})`;
    expect((await sql`SELECT public.stream_session_valid(${uid},${sid}) AS ok`)[0].ok).toBe(false);
    expect((await sql`SELECT status FROM public.stream_grants WHERE user_id=${uid} ORDER BY created_at DESC LIMIT 1`)[0].status).toBe("expired");
    await sql`INSERT INTO public.stream_grants(user_id) VALUES(${uid})`;
    expect((await sql`SELECT public.stream_broadcast_claim(${uid},${sid},${crypto.randomUUID()}) AS ok`)[0].ok).toBe(false);
  });
});