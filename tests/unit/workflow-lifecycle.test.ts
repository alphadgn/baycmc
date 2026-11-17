import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
      DROP SCHEMA IF EXISTS auth CASCADE;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
    await sql.reserve().then(async (reserved) => {
      try { await reserved.unsafe(readFileSync("docs/review/20261117_stream_session_lifecycle.sql", "utf8")); }
      finally { reserved.release(); }
    });
  });
  afterAll(async () => { await sql.end(); });
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
  it("real karaoke end-turn advances two singers in signup order exactly once", async () => {
    const source = readFileSync("supabase/migrations/20261013000001_karaoke_v2_authoritative_stage.sql", "utf8");
    const section = (name: string) => {
      const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      return source.slice(start, source.indexOf("END $$;", start) + "END $$;".length);
    };
    await sql.unsafe(`
      CREATE TABLE public.karaoke_sessions(room_id uuid PRIMARY KEY,performer_user_id uuid,video_id text,search_query text,backing_track_id uuid,song_title text,song_artist text,
        playback_status text DEFAULT 'idle',position_ms integer DEFAULT 0,position_at timestamptz DEFAULT now(),stage_source text DEFAULT 'open',reservation_id uuid,
        generation integer DEFAULT 0,revision bigint DEFAULT 0,performer_heartbeat_at timestamptz,updated_at timestamptz DEFAULT now());
      CREATE TABLE public.karaoke_room_settings(room_id uuid,require_booking boolean DEFAULT false,holders_priority boolean DEFAULT true);
      CREATE TABLE public.karaoke_queue(id uuid DEFAULT gen_random_uuid(),room_id uuid,user_id uuid,joined_at timestamptz DEFAULT now(),last_seen_at timestamptz DEFAULT now());
      CREATE TABLE public.karaoke_reservations(id uuid,status text);
      CREATE TABLE public.test_entitlement(performer uuid,source text,reservation uuid);
      CREATE FUNCTION public.karaoke_entitled_performer(_room uuid,OUT performer uuid,OUT source text,OUT reservation uuid) LANGUAGE sql AS $$ SELECT * FROM public.test_entitlement $$;
      CREATE FUNCTION public.karaoke_settings(_room uuid) RETURNS public.karaoke_room_settings LANGUAGE sql AS $$ SELECT * FROM public.karaoke_room_settings WHERE room_id=_room $$;
      CREATE FUNCTION public.karaoke_is_sanctioned(_room uuid,_uid uuid,_kind text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.karaoke_is_admin(_uid uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.karaoke_is_moderator(_room uuid,_uid uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.karaoke_assert_room(_room uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      INSERT INTO public.test_entitlement VALUES(NULL,'open',NULL);
      INSERT INTO public.karaoke_room_settings(room_id) VALUES('${room}');
      INSERT INTO public.karaoke_sessions(room_id) VALUES('${room}');
      INSERT INTO public.karaoke_queue(room_id,user_id,joined_at) VALUES('${room}','${uid}',now()-interval '2 minutes'),('${room}','${singer2}',now()-interval '1 minute');
    `);
    await sql.unsafe(section("karaoke_lock_session"));
    await sql.unsafe(section("karaoke_end_turn"));
    const reserved = await sql.reserve();
    try { await reserved.unsafe(readFileSync("docs/review/20261117_karaoke_fifo.sql", "utf8")); }
    finally { reserved.release(); }
    expect((await sql`SELECT public.karaoke_promote_next(${room}) AS singer`)[0].singer).toBe(uid);
    const generation = (await sql`SELECT generation FROM public.karaoke_sessions WHERE room_id=${room}`)[0].generation;
    const end = () => sql.begin(async tx => {
      await tx`SELECT set_config('test.uid',${uid},true)`;
      return tx`SELECT (public.karaoke_end_turn(${room},${generation})).performer_user_id AS singer`;
    });
    const outcomes = await Promise.allSettled([end(), end()]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await sql`SELECT performer_user_id FROM public.karaoke_sessions WHERE room_id=${room}`)[0].performer_user_id).toBe(singer2);
    expect((await sql`SELECT count(*)::int AS count FROM public.karaoke_queue WHERE room_id=${room}`)[0].count).toBe(0);
  });
  it("karaoke reservation takes precedence over the open queue", async () => {
    await sql`UPDATE public.test_entitlement SET performer=${uid},source='reservation',reservation=${attempt}`;
    await sql`INSERT INTO public.karaoke_queue(room_id,user_id) VALUES(${room},${singer2})`;
    expect((await sql`SELECT public.karaoke_promote_next(${room}) AS singer`)[0].singer).toBe(uid);
    expect((await sql`SELECT stage_source FROM public.karaoke_sessions WHERE room_id=${room}`)[0].stage_source).toBe("reservation");
    expect((await sql`SELECT count(*)::int AS count FROM public.karaoke_queue WHERE room_id=${room}`)[0].count).toBe(1);
  });
});