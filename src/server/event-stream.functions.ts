import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAddress, isAddress, parseEther } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TIP_CHAIN_ID } from "@/lib/web3/constants";

/**
 * Event Stream.
 *  - Admin statistics (live / viewers / hosted by).
 *  - Single-use host grants: admins and the super admin grant one stream at
 *    a time; it is used up when that stream ends; sign-out cancels it.
 *    Admins and the super admin stream without a grant.
 *  - Pay-per-view: events with a price in APE, tickets paid on ApeChain to
 *    the payee wallet set by admins and checked here; BAYC/MAYC watch free.
 *    Refunds for cancelled events are sent by an admin from their own wallet
 *    and recorded here after the transaction is checked.
 */
const STREAM_ROOM = "event-stream";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function roles(userId: string) {
  const { data } = await (await db()).from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}
async function isAdmin(userId: string) {
  const r = await roles(userId);
  return r.includes("admin") || r.includes("super_admin");
}
async function requireAdmin(userId: string) {
  if (!(await isAdmin(userId))) throw new Error("Forbidden: admin only");
}
async function audit(actor: string, event: string, target: string | null, meta?: object) {
  await (await db()).from("audit_logs").insert({
    event_type: event,
    actor_id: actor,
    target_id: target,
    metadata: meta ?? null,
  } as never);
}
type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// ── Stats ───────────────────────────────────────────────────────────────────

export interface StreamStats {
  configured: boolean;
  live: boolean;
  viewers: number;
  capacity: number;
  hostedBy: { userId: string; name: string }[];
  assignedHosts: { userId: string; name: string; status: string; grantedAt: string }[];
  roomId: string | null;
  checkedAt: string;
}

export const getEventStreamStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StreamStats> => {
    await requireAdmin(context.userId);
    const admin = await db();
    const [{ data: room }, { data: grants }] = await Promise.all([
      admin.from("rooms").select("id,capacity").eq("livekit_room", STREAM_ROOM).maybeSingle(),
      admin
        .from("stream_grants" as never)
        .select("user_id,status,created_at")
        .in("status", ["active", "in_use"])
        .order("created_at", { ascending: false }),
    ]);
    const open = (grants ?? []) as unknown as {
      user_id: string;
      status: string;
      created_at: string;
    }[];
    const ids = open.map((g) => g.user_id);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await admin.from("profiles").select("id,username").in("id", ids);
      for (const p of profs ?? [])
        names.set(p.id as string, (p.username as string | null) ?? "Member");
    }
    const base: StreamStats = {
      configured: false,
      live: false,
      viewers: 0,
      capacity: (room?.capacity as number | undefined) ?? 250,
      hostedBy: [],
      assignedHosts: open.map((g) => ({
        userId: g.user_id,
        name: names.get(g.user_id) ?? "Member",
        status: g.status,
        grantedAt: g.created_at,
      })),
      roomId: (room?.id as string | undefined) ?? null,
      checkedAt: new Date().toISOString(),
    };
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return base;
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    let participants: Awaited<ReturnType<typeof client.listParticipants>> = [];
    try {
      participants = await client.listParticipants(STREAM_ROOM);
    } catch {
      return { ...base, configured: true };
    }
    const broadcasters = participants.filter((p) => (p.tracks ?? []).length > 0);
    return {
      ...base,
      configured: true,
      live: broadcasters.length > 0,
      viewers: participants.length - broadcasters.length,
      hostedBy: broadcasters.map((p) => ({ userId: p.identity, name: p.name || "Host" })),
    };
  });

// ── Single-use host grants ──────────────────────────────────────────────────

/** Admin / super admin: grant one stream to a member (by user id). */
export const grantStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.rpc as unknown as Rpc)("stream_grant_issue", {
      _uid: data.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    const { setLivePublish } = await import("@/server/stream-grants.server");
    await setLivePublish(data.userId, true);
    return { ok: true as const };
  });

/** Admin / super admin: cancel a member's open grant. */
export const revokeStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.rpc as unknown as Rpc)("stream_grant_revoke", {
      _uid: data.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    const { setLivePublish } = await import("@/server/stream-grants.server");
    await setLivePublish(data.userId, false);
    return { ok: true as const };
  });

/** Host: starting / still streaming (called on Start and every minute). */
export const streamHostCheckIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { touchStreamGrant } = await import("@/server/stream-grants.server");
    const ok = await touchStreamGrant(context.userId);
    return ok
      ? { ok: true as const }
      : {
          ok: false as const,
          error: "Your streaming grant has been used. Ask an admin for a new one.",
        };
  });

/** Host: End broadcast — the grant is used up. */
export const streamHostEnd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { finishStreamGrant } = await import("@/server/stream-grants.server");
    await finishStreamGrant(context.userId, "ended");
    return { ok: true as const };
  });

// ── Pay-per-view ────────────────────────────────────────────────────────────

export interface StreamEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  price_ape: number;
  status: string;
}

/** What this member may do in the Event Stream right now. */
export const getStreamAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await db();
    const rpc = admin.rpc as unknown as Rpc;
    const [free, canHost, current, ticket] = await Promise.all([
      rpc("stream_viewer_free", { _uid: context.userId }),
      rpc("stream_can_host", { _uid: context.userId }),
      rpc("stream_current_event"),
      rpc("stream_has_ticket", { _uid: context.userId }),
    ]);
    const { data: events } = await admin
      .from("stream_events" as never)
      .select("id,title,starts_at,ends_at,price_ape,status")
      .eq("status", "scheduled")
      .gt("ends_at", new Date(Date.now() - 30 * 60_000).toISOString())
      .order("starts_at")
      .limit(10);
    const { data: mine } = await admin
      .from("stream_tickets" as never)
      .select("event_id,refund_status")
      .eq("user_id", context.userId);
    return {
      free: free.data === true,
      canHost: canHost.data === true,
      currentEventId: (current.data as string | null) ?? null,
      hasTicket: ticket.data === true,
      events: ((events ?? []) as unknown as StreamEvent[]).map((e) => ({
        ...e,
        price_ape: Number(e.price_ape),
      })),
      myTickets: ((mine ?? []) as unknown as { event_id: string; refund_status: string }[])
        .filter((t) => t.refund_status === "none")
        .map((t) => t.event_id),
    };
  });

/** Where and how much to pay for an event ticket. */
export const getTicketPayTo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const admin = await db();
    const [{ data: ev }, { data: st }] = await Promise.all([
      admin
        .from("stream_events" as never)
        .select("id,status,price_ape,ends_at")
        .eq("id", data.eventId)
        .maybeSingle(),
      admin
        .from("stream_settings" as never)
        .select("payee_wallet")
        .eq("id", 1)
        .maybeSingle(),
    ]);
    const e = ev as unknown as { status: string; price_ape: number; ends_at: string } | null;
    const payee = (st as unknown as { payee_wallet: string | null } | null)?.payee_wallet;
    if (!e || e.status !== "scheduled" || Date.parse(e.ends_at) < Date.now()) {
      return { ok: false as const, error: "This event isn't on sale." };
    }
    if (!payee || !isAddress(payee)) {
      return { ok: false as const, error: "Ticket sales aren't set up yet. Please try later." };
    }
    return {
      ok: true as const,
      payTo: getAddress(payee),
      amountWei: parseEther(String(e.price_ape)).toString(),
      chainId: TIP_CHAIN_ID,
    };
  });

/** Check a ticket payment on ApeChain and issue the ticket. */
export const confirmTicketPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string; txHash: string }) =>
    z
      .object({ eventId: z.string().uuid(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const admin = await db();
    const [{ data: ev }, { data: st }] = await Promise.all([
      admin
        .from("stream_events" as never)
        .select("id,status,price_ape,created_at")
        .eq("id", data.eventId)
        .maybeSingle(),
      admin
        .from("stream_settings" as never)
        .select("payee_wallet")
        .eq("id", 1)
        .maybeSingle(),
    ]);
    const e = ev as unknown as { id: string; status: string; price_ape: number } | null;
    const payee = (st as unknown as { payee_wallet: string | null } | null)?.payee_wallet;
    if (!e || e.status !== "scheduled")
      return { ok: false as const, error: "This event isn't on sale." };
    if (!payee || !isAddress(payee))
      return { ok: false as const, error: "Ticket sales aren't set up." };

    const { accountWallets } = await import("@/server/account-wallets.server");
    const payer = await accountWallets(uid);
    const { publicClientFor } = await import("@/server/ownership/chains");
    const client = publicClientFor(TIP_CHAIN_ID);
    const hash = data.txHash as `0x${string}`;
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000, confirmations: 1 });
    } catch {
      return {
        ok: false as const,
        error: "Couldn't find that transaction on ApeChain yet. Try again in a moment.",
      };
    }
    if (receipt.status !== "success") {
      return { ok: false as const, error: "The payment transaction failed on-chain." };
    }
    const tx = await client.getTransaction({ hash });
    if (!tx.to) return { ok: false as const, error: "That transaction isn't an APE transfer." };
    const to = getAddress(tx.to);
    const from = getAddress(tx.from);
    if (to !== getAddress(payee)) {
      return { ok: false as const, error: "That transaction didn't pay the Event Stream wallet." };
    }
    if (!payer.wallets.some((w) => getAddress(w) === from)) {
      return {
        ok: false as const,
        error: "Pay from a wallet connected or linked to your account.",
      };
    }
    if (tx.value < parseEther(String(e.price_ape))) {
      return { ok: false as const, error: "The amount sent is less than the ticket price." };
    }
    const { error } = await admin.from("stream_tickets" as never).insert({
      event_id: e.id,
      user_id: uid,
      chain_id: TIP_CHAIN_ID,
      tx_hash: hash.toLowerCase(),
      from_address: from,
      to_address: to,
      amount_wei: tx.value.toString(),
    } as never);
    if (error) {
      if (/tx_hash/i.test(error.message)) {
        return { ok: false as const, error: "That transaction was already used for a ticket." };
      }
      if (/duplicate key/i.test(error.message)) {
        return { ok: true as const, duplicate: true };
      }
      return { ok: false as const, error: error.message };
    }
    await audit(uid, "event_stream.ticket", e.id, { tx: hash.toLowerCase() });
    return { ok: true as const, duplicate: false };
  });

// ── Admin: payee wallet, events, refunds ────────────────────────────────────

export const getStreamAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const admin = await db();
    const [{ data: st }, { data: events }, { data: tickets }] = await Promise.all([
      admin
        .from("stream_settings" as never)
        .select("payee_wallet")
        .eq("id", 1)
        .maybeSingle(),
      admin
        .from("stream_events" as never)
        .select("id,title,starts_at,ends_at,price_ape,status")
        .order("starts_at", { ascending: false })
        .limit(50),
      admin
        .from("stream_tickets" as never)
        .select(
          "id,event_id,user_id,from_address,amount_wei,refund_status,refund_tx_hash,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const t = (tickets ?? []) as unknown as {
      id: string;
      event_id: string;
      user_id: string;
      from_address: string;
      amount_wei: string;
      refund_status: string;
      refund_tx_hash: string | null;
      created_at: string;
    }[];
    const ids = [...new Set(t.map((x) => x.user_id))];
    const { data: profs } = ids.length
      ? await admin.from("profiles").select("id,username").in("id", ids)
      : { data: [] as { id: string; username: string | null }[] };
    return {
      payeeWallet: (st as unknown as { payee_wallet: string | null } | null)?.payee_wallet ?? null,
      chainId: TIP_CHAIN_ID,
      events: ((events ?? []) as unknown as StreamEvent[]).map((e) => ({
        ...e,
        price_ape: Number(e.price_ape),
      })),
      tickets: t.map((x) => ({
        ...x,
        amount_wei: String(x.amount_wei),
        username: profs?.find((p) => p.id === x.user_id)?.username ?? "Member",
      })),
    };
  });

export const setPayeeWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const wallet = getAddress(data.wallet);
    await (
      await db()
    )
      .from("stream_settings" as never)
      .update({
        payee_wallet: wallet,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", 1);
    await audit(context.userId, "event_stream.payee", null, { wallet });
    return { ok: true as const };
  });

export const createStreamEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; startsAt: string; endsAt: string; priceApe: number }) =>
    z
      .object({
        title: z.string().trim().min(1).max(120),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        priceApe: z.number().min(0).max(1_000_000),
      })
      .refine(
        (v) => Date.parse(v.endsAt) > Date.parse(v.startsAt),
        "The end must be after the start.",
      )
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: row, error } = await (
      await db()
    )
      .from("stream_events" as never)
      .insert({
        title: data.title,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        price_ape: data.priceApe,
        created_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    await audit(context.userId, "event_stream.event_create", (row as { id: string }).id);
    return { ok: true as const };
  });

/** Cancel an event: its tickets become "refund due". */
export const cancelStreamEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const admin = await db();
    await admin
      .from("stream_events" as never)
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() } as never)
      .eq("id", data.eventId);
    await admin
      .from("stream_tickets" as never)
      .update({ refund_status: "due" } as never)
      .eq("event_id", data.eventId)
      .eq("refund_status", "none");
    await audit(context.userId, "event_stream.event_cancel", data.eventId);
    return { ok: true as const };
  });

/** Record a refund the admin sent from their wallet (checked on-chain). */
export const recordTicketRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ticketId: string; txHash: string }) =>
    z
      .object({ ticketId: z.string().uuid(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const admin = await db();
    const { data: row } = await admin
      .from("stream_tickets" as never)
      .select("id,from_address,amount_wei,refund_status")
      .eq("id", data.ticketId)
      .maybeSingle();
    const t = row as unknown as {
      id: string;
      from_address: string;
      amount_wei: string;
      refund_status: string;
    } | null;
    if (!t) return { ok: false as const, error: "Ticket not found." };
    if (t.refund_status === "refunded") return { ok: true as const, duplicate: true };
    if (t.refund_status !== "due")
      return { ok: false as const, error: "This ticket isn't due a refund." };
    const { publicClientFor } = await import("@/server/ownership/chains");
    const client = publicClientFor(TIP_CHAIN_ID);
    const hash = data.txHash as `0x${string}`;
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 60_000,
        confirmations: 1,
      });
      if (receipt.status !== "success")
        return { ok: false as const, error: "The refund transaction failed." };
    } catch {
      return {
        ok: false as const,
        error: "Couldn't find the refund on ApeChain yet. Try again shortly.",
      };
    }
    const tx = await client.getTransaction({ hash });
    if (!tx.to || getAddress(tx.to) !== getAddress(t.from_address)) {
      return { ok: false as const, error: "That refund didn't go to the ticket buyer's wallet." };
    }
    if (tx.value < BigInt(t.amount_wei)) {
      return { ok: false as const, error: "The refund is less than the ticket price." };
    }
    const { error } = await admin
      .from("stream_tickets" as never)
      .update({
        refund_status: "refunded",
        refund_tx_hash: hash.toLowerCase(),
        refunded_at: new Date().toISOString(),
        refunded_by: context.userId,
      } as never)
      .eq("id", t.id);
    if (error) {
      return {
        ok: false as const,
        error: /refund_tx_hash/i.test(error.message)
          ? "That transaction was already used for another refund."
          : error.message,
      };
    }
    await audit(context.userId, "event_stream.refund", t.id, { tx: hash.toLowerCase() });
    return { ok: true as const, duplicate: false };
  });
