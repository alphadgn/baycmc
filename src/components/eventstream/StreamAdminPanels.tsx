import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { formatEther } from "viem";
import { toast } from "sonner";
import { Loader2, Send, UserMinus } from "lucide-react";
import {
  cancelStreamEvent,
  createStreamEvent,
  getStreamAdmin,
  grantStream,
  recordTicketRefund,
  revokeStream,
  setPayeeWallet,
  type StreamStats,
} from "@/server/event-stream.functions";
import { MemberSearchBox } from "@/components/members/MemberUi";
import { GLYPH_CONNECTOR_ID } from "@/components/GlyphAppProvider";

/** Single-use host grants: admins and the super admin grant one stream. */
export function StreamGrantsPanel({
  stats,
  onChange,
}: {
  stats: StreamStats | null;
  onChange: () => void;
}) {
  const grant = useServerFn(grantStream);
  const revoke = useServerFn(revokeStream);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section className="glass mt-6 rounded-2xl p-5 shadow-card">
      <h2 className="font-display text-xl">Streaming grants</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Each grant covers <strong>one</strong> stream. It's used up when that stream ends (a dropped
        connection can rejoin within 5 minutes). Signing out or timing out cancels it. Admins and
        the super admin can stream without a grant.
      </p>
      <div className="mt-3">
        <MemberSearchBox
          placeholder="Grant one stream — find a member by username"
          onSelect={async (m) => {
            setBusy(m.id);
            const res = await grant({ data: { userId: m.id } });
            setBusy(null);
            if (!res.ok) toast.error(res.error);
            else toast.success(`${m.username} can host one stream.`);
            onChange();
          }}
        />
      </div>
      <ul className="mt-3 divide-y divide-border/50">
        {(stats?.assignedHosts ?? []).map((h) => (
          <li key={h.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {h.name}{" "}
              <span className="text-xs text-muted-foreground">
                · {h.status === "in_use" ? "streaming now" : "unused"} · granted{" "}
                {new Date(h.grantedAt).toLocaleString()}
              </span>
            </span>
            <button
              type="button"
              disabled={busy === h.userId}
              onClick={async () => {
                setBusy(h.userId);
                const res = await revoke({ data: { userId: h.userId } });
                setBusy(null);
                if (!res.ok) toast.error(res.error);
                else toast.success(`Grant cancelled for ${h.name}.`);
                onChange();
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive disabled:opacity-60"
            >
              <UserMinus className="h-3.5 w-3.5" /> Cancel
            </button>
          </li>
        ))}
        {stats && stats.assignedHosts.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">No open grants.</li>
        )}
      </ul>
    </section>
  );
}

type AdminData = Awaited<ReturnType<typeof getStreamAdmin>>;

/** Pay-per-view: payee wallet, events, tickets and refunds. */
export function StreamPayPerViewPanel() {
  const fetchAdmin = useServerFn(getStreamAdmin);
  const savePayee = useServerFn(setPayeeWallet);
  const create = useServerFn(createStreamEvent);
  const cancel = useServerFn(cancelStreamEvent);
  const recordRefund = useServerFn(recordTicketRefund);
  const { isConnected, address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const [data, setData] = useState<AdminData | null>(null);
  const [payee, setPayee] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [price, setPrice] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetchAdmin();
    setData(d);
    setPayee((p) => p || d.payeeWallet || "");
  }, [fetchAdmin]);
  useEffect(() => {
    void load();
  }, [load]);

  async function ensureWallet(chain: number) {
    if (!isConnected || !address) {
      const c = connectors.find((x) => x.id === GLYPH_CONNECTOR_ID) ?? connectors[0];
      if (!c) throw new Error("Connect a wallet to send refunds.");
      await connectAsync({ connector: c });
    }
    if (chainId !== chain) await switchChainAsync({ chainId: chain });
  }

  async function refund(t: AdminData["tickets"][number]) {
    if (!data) return false;
    setBusy(t.id);
    try {
      await ensureWallet(data.chainId);
      const hash = await sendTransactionAsync({
        to: t.from_address as `0x${string}`,
        value: BigInt(t.amount_wei),
        chainId: data.chainId,
      });
      toast.message(`Refund sent to ${t.username} — confirming on ApeChain…`);
      const res = await recordRefund({ data: { ticketId: t.id, txHash: hash } });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Refunded ${t.username}.`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/rejected|denied|cancel/i.test(msg)) toast.error(msg);
      return false;
    } finally {
      setBusy(null);
      void load();
    }
  }

  const due = (data?.tickets ?? []).filter((t) => t.refund_status === "due");

  return (
    <section className="glass mt-6 space-y-5 rounded-2xl p-5 shadow-card">
      <div>
        <h2 className="font-display text-xl">Pay-per-view</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          BAYC/MAYC holders watch free. Other collections buy a ticket per event, in APE on
          ApeChain, paid to the wallet below.
        </p>
      </div>

      <div>
        <label htmlFor="payee" className="text-xs font-semibold">
          Payee wallet (receives ticket payments)
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="payee"
            value={payee}
            onChange={(e) => setPayee(e.target.value.trim())}
            placeholder="0x…"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy === "payee"}
            onClick={async () => {
              setBusy("payee");
              const res = await savePayee({ data: { wallet: payee } }).catch((e: Error) => ({
                ok: false as const,
                error: e.message,
              }));
              setBusy(null);
              if (!res.ok) toast.error("error" in res ? res.error : "Couldn't save");
              else toast.success("Payee wallet saved.");
              void load();
            }}
            className="rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground"
          >
            Save
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Schedule an event</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs sm:col-span-2">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Starts
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Ends
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Ticket price (APE)
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={busy === "create" || !title || !start || !end}
              onClick={async () => {
                setBusy("create");
                const res = await create({
                  data: {
                    title,
                    startsAt: new Date(start).toISOString(),
                    endsAt: new Date(end).toISOString(),
                    priceApe: Number(price) || 0,
                  },
                }).catch((e: Error) => ({ ok: false as const, error: e.message }));
                setBusy(null);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success("Event scheduled.");
                  setTitle("");
                }
                void load();
              }}
              className="w-full rounded-md bg-gradient-gold px-3 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-50"
            >
              Schedule
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Events</h3>
        {!data ? (
          <Loader2 className="mt-2 h-4 w-4 animate-spin" />
        ) : data.events.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/50">
            {data.events.map((e) => {
              const sold = data.tickets.filter((t) => t.event_id === e.id).length;
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{e.title}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      · {new Date(e.starts_at).toLocaleString()} · {e.price_ape} APE · {sold}{" "}
                      ticket(s)
                      {e.status === "cancelled" && " · cancelled"}
                    </span>
                  </span>
                  {e.status === "scheduled" && Date.parse(e.ends_at) > Date.now() && (
                    <button
                      type="button"
                      disabled={busy === e.id}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Cancel "${e.title}"? Ticket holders will be due refunds.`,
                          )
                        )
                          return;
                        setBusy(e.id);
                        await cancel({ data: { eventId: e.id } });
                        setBusy(null);
                        toast.success("Event cancelled. Send the refunds below.");
                        void load();
                      }}
                      className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"
                    >
                      Cancel event
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Refunds due ({due.length})</h3>
          {due.length > 1 && (
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                for (const t of due) {
                  const ok = await refund(t);
                  if (!ok) break;
                }
              }}
              className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground"
            >
              <Send className="h-3.5 w-3.5" /> Refund all from my wallet
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Refunds are sent from your own connected wallet on ApeChain; each is checked and recorded.
        </p>
        {due.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nothing due.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/50">
            {due.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {t.username}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.from_address.slice(0, 6)}…{t.from_address.slice(-4)} ·{" "}
                    {formatEther(BigInt(t.amount_wei))} APE
                  </span>
                </span>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void refund(t)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gold/40 px-2 py-1 text-xs text-gold disabled:opacity-60"
                >
                  {busy === t.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Refund
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
