import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { Loader2, Ticket } from "lucide-react";
import {
  confirmTicketPayment,
  getTicketPayTo,
  type StreamEvent,
} from "@/server/event-stream.functions";
import { GLYPH_CONNECTOR_ID } from "@/components/GlyphAppProvider";

/**
 * Pay-per-view entry for members whose collection isn't free (BAYC/MAYC
 * watch free). One ticket per event, paid in APE on ApeChain; the server
 * checks the payment before the stream opens. Rejoining is covered.
 */
export function TicketGate({
  events,
  currentEventId,
  myTickets,
  onTicket,
}: {
  events: StreamEvent[];
  currentEventId: string | null;
  myTickets: string[];
  onTicket: () => void;
}) {
  const payTo = useServerFn(getTicketPayTo);
  const confirm = useServerFn(confirmTicketPayment);
  const { isConnected, address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(e: StreamEvent) {
    setBusy(e.id);
    try {
      const info = await payTo({ data: { eventId: e.id } });
      if (!info.ok) throw new Error(info.error);
      if (!isConnected || !address) {
        const c = connectors.find((x) => x.id === GLYPH_CONNECTOR_ID) ?? connectors[0];
        if (!c) throw new Error("Connect a wallet to pay.");
        await connectAsync({ connector: c });
      }
      if (chainId !== info.chainId) await switchChainAsync({ chainId: info.chainId });
      const hash = await sendTransactionAsync({
        to: info.payTo as `0x${string}`,
        value: BigInt(info.amountWei),
        chainId: info.chainId,
      });
      toast.message("Payment sent — confirming on ApeChain…");
      const res = await confirm({ data: { eventId: e.id, txHash: hash } });
      if (!res.ok) throw new Error(res.error);
      toast.success("Ticket confirmed. Enjoy the show!");
      onTicket();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/rejected|denied|cancel/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="font-display text-3xl text-gradient-gold">Event Stream</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Event streams are pay-per-view for your collection. BAYC and MAYC holders watch free.
      </p>
      {events.length === 0 ? (
        <p className="mt-6 rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
          No events are scheduled right now. Check back soon.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {events.map((e) => {
            const owned = myTickets.includes(e.id);
            const isNow = e.id === currentEventId;
            return (
              <li key={e.id} className="rounded-xl border border-gold/30 bg-card/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.starts_at).toLocaleString()} –{" "}
                      {new Date(e.ends_at).toLocaleTimeString()}
                      {isNow && <span className="ml-1 text-emerald-300">· doors open</span>}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-gold">{e.price_ape} APE</span>
                </div>
                <div className="mt-3">
                  {owned ? (
                    isNow ? (
                      <button
                        type="button"
                        onClick={onTicket}
                        className="min-h-11 w-full rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground"
                      >
                        Enter the stream
                      </button>
                    ) : (
                      <p className="text-xs text-emerald-300">
                        You have a ticket. Doors open 30 minutes before the start.
                      </p>
                    )
                  ) : (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void buy(e)}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-60"
                    >
                      {busy === e.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Ticket className="h-4 w-4" />
                      )}
                      Buy ticket · {e.price_ape} APE
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-[11px] text-muted-foreground">
        Tickets are paid in APE on ApeChain from a wallet linked to your account. If an event is
        cancelled, your ticket is refunded to the wallet you paid from.
      </p>
    </main>
  );
}
