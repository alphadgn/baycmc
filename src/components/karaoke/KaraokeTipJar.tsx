/**
 * Floating $APE tip jar for the karaoke audience.
 *
 * Shown ONLY while someone is performing AND that performer is eligible:
 * their account holds BAYC, MAYC, CryptoPunks, Ugly Duck Labs, Orca Business
 * or Temp Agency (decided server-side by getKaraokeTipTarget). The performer
 * never sees the jar for themselves.
 *
 * Tips are native APE on ApeChain, sent wallet → performer's wallet directly
 * (the app never holds funds). The server then verifies the transaction
 * on-chain before recording it and notifying the performer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Smartphone, Wallet as WalletIcon, X } from "lucide-react";
import { toast } from "sonner";
import { formatEther, parseEther } from "viem";
import { useServerFn } from "@tanstack/react-start";
import { useAccount, useConnect, useSendTransaction, useSwitchChain, type Connector } from "wagmi";
import { getKaraokeTipTarget, recordKaraokeTip } from "@/server/karaoke-tips.functions";
import { GLYPH_CONNECTOR_ID, WALLETCONNECT_CONNECTOR_ID } from "@/components/GlyphAppProvider";
import { useAuth } from "@/lib/auth/useAuth";
import { useKaraokeStage } from "@/lib/karaoke/stageStore";
import { supabase } from "@/integrations/supabase/client";
import { TIP_CHAIN_ID, TIP_MAX_APE, TIP_STEP_APE } from "@/lib/web3/constants";

type Target = Awaited<ReturnType<typeof getKaraokeTipTarget>>;

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/rejected|denied|cancel/i.test(msg)) return "Tip cancelled.";
  if (/insufficient funds|exceeds balance/i.test(msg))
    return "Not enough APE (plus gas) in this wallet.";
  return msg.split("\n")[0] || "Couldn't send the tip.";
}

export function KaraokeTipJar({ roomId }: { roomId: string }) {
  const { user } = useAuth();
  const stage = useKaraokeStage();
  const performerId = stage.session?.performer_user_id ?? null;
  const getTarget = useServerFn(getKaraokeTipTarget);
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);

  // Re-check eligibility whenever the stage changes hands (and every 2 min).
  useEffect(() => {
    setTarget(null);
    setOpen(false);
    if (!user || !performerId || stage.isMyTurn) return;
    let cancelled = false;
    const load = () =>
      getTarget({ data: { roomId } })
        .then((t) => {
          if (!cancelled) setTarget(t);
        })
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [user, performerId, stage.isMyTurn, roomId, getTarget]);

  const visible =
    !!user &&
    !!performerId &&
    !stage.isMyTurn &&
    !!target?.eligible &&
    !!target.wallet &&
    target.performerId === performerId;
  if (!visible || !target?.wallet) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`Tip ${target.performerName ?? "the singer"} in APE`}
        onClick={() => setOpen((v) => !v)}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 14rem)" }}
        className="group fixed left-4 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/60 bg-background/85 shadow-gold backdrop-blur transition hover:scale-105"
      >
        <TipJarIcon className="h-7 w-7" />
        <span className="absolute -right-1 -top-1 rounded-full bg-gradient-gold px-1 text-[8px] font-bold text-gold-foreground">
          APE
        </span>
      </button>
      {open && (
        <TipPanel
          roomId={roomId}
          target={target as Target & { wallet: string; performerId: string }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TipPanel({
  roomId,
  target,
  onClose,
}: {
  roomId: string;
  target: Target & { wallet: string; performerId: string };
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [phase, setPhase] = useState<
    "idle" | "connecting" | "switching" | "sending" | "confirming"
  >("idle");
  const { isConnected, address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const record = useServerFn(recordKaraokeTip);
  const busy = phase !== "idle";

  const walletOptions = useMemo(() => {
    const glyph = connectors.find((c) => c.id === GLYPH_CONNECTOR_ID);
    const wc = connectors.find((c) => c.id === WALLETCONNECT_CONNECTOR_ID);
    const injected = connectors.filter(
      (c) => c.type === "injected" && c.id !== GLYPH_CONNECTOR_ID && c.id !== "injected",
    );
    return [glyph, ...injected, wc].filter((c): c is Connector => !!c);
  }, [connectors]);

  const connect = useCallback(
    async (c: Connector) => {
      setPhase("connecting");
      try {
        await connectAsync({ connector: c, chainId: TIP_CHAIN_ID });
      } catch (e) {
        toast.error(friendly(e));
      } finally {
        setPhase("idle");
      }
    },
    [connectAsync],
  );

  async function send() {
    if (amount <= 0 || !address) return;
    try {
      if (chainId !== TIP_CHAIN_ID) {
        setPhase("switching");
        await switchChainAsync({ chainId: TIP_CHAIN_ID });
      }
      setPhase("sending");
      const hash = await sendTransactionAsync({
        to: target.wallet as `0x${string}`,
        value: parseEther(String(amount)),
        chainId: TIP_CHAIN_ID,
      });
      setPhase("confirming");
      const res = await record({
        data: {
          roomId,
          recipientId: target.performerId,
          txHash: hash,
          generation: target.generation,
        },
      });
      if (res.ok) {
        toast.success(`Tipped ${formatEther(BigInt(res.amountWei))} APE`, {
          description: `Sent to ${target.performerName ?? "the singer"} on ApeChain.`,
        });
        setAmount(0);
        onClose();
      } else {
        toast.warning("Tip sent — confirmation pending", {
          description: `${res.error} Tx ${short(hash)}`,
          duration: 10_000,
        });
      }
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setPhase("idle");
    }
  }

  const step = (d: number) =>
    setAmount((a) => Math.min(TIP_MAX_APE, Math.max(0, Math.round((a + d) * 100) / 100)));

  return (
    <div
      role="dialog"
      aria-label="Tip the singer"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 17.75rem)" }}
      className="fixed left-4 z-50 w-[min(88vw,17rem)] rounded-xl border border-gold/40 bg-[#0a0a0a]/95 p-3 text-xs shadow-gold backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <TipJarIcon className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-gold">Tip jar</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {target.performerName ?? "Singer"} · {target.collection} holder
          </p>
        </div>
        <button
          type="button"
          aria-label="Close tip jar"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Less APE"
          disabled={busy || amount <= 0}
          onClick={() => step(-TIP_STEP_APE)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 text-gold transition hover:bg-gold/10 disabled:opacity-30"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="font-display text-2xl tabular-nums text-foreground">{amount}</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gold">$APE</div>
        </div>
        <button
          type="button"
          aria-label="More APE"
          disabled={busy || amount >= TIP_MAX_APE}
          onClick={() => step(TIP_STEP_APE)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 text-gold transition hover:bg-gold/10 disabled:opacity-30"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {isConnected && address ? (
        <>
          <button
            type="button"
            disabled={busy || amount <= 0}
            onClick={() => void send()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-xs font-bold uppercase tracking-wider text-gold-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {phase === "switching"
              ? "Switching to ApeChain…"
              : phase === "sending"
                ? "Confirm in wallet…"
                : phase === "confirming"
                  ? "Confirming…"
                  : amount > 0
                    ? `Send ${amount} APE`
                    : "Choose an amount"}
          </button>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            From {short(address)} → {short(target.wallet)} on ApeChain. Goes straight to the
            singer's wallet; tips can't be refunded.
          </p>
        </>
      ) : (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] text-muted-foreground">Connect a wallet to tip:</p>
          {walletOptions.map((c) => (
            <button
              key={c.uid}
              type="button"
              disabled={busy}
              onClick={() => void connect(c)}
              className="flex w-full items-center gap-2 rounded-md border border-gold/30 bg-secondary/30 px-2.5 py-1.5 text-left text-[11px] font-semibold transition hover:border-gold/60 disabled:opacity-50"
            >
              {c.id === WALLETCONNECT_CONNECTOR_ID ? (
                <Smartphone className="h-4 w-4 text-gold" />
              ) : c.icon ? (
                <img src={c.icon} alt="" className="h-4 w-4 rounded" />
              ) : (
                <WalletIcon className="h-4 w-4 text-gold" />
              )}
              {c.id === GLYPH_CONNECTOR_ID ? "Glyph" : c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Performer side: live "you got tipped" notices. */
export function KaraokeTipNotifier() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`karaoke-tips:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "karaoke_tips",
          filter: `recipient_id=eq.${userId}`,
        },
        async (payload) => {
          const row = payload.new as { amount_wei: number | string; tipper_id: string };
          let who = "Someone";
          try {
            const { data } = await supabase
              .rpc("member_profiles")
              .select("username")
              .eq("id", row.tipper_id)
              .maybeSingle();
            if (data?.username) who = data.username;
          } catch {
            /* name optional */
          }
          let amt = "";
          try {
            amt = formatEther(BigInt(String(row.amount_wei).split(".")[0] ?? "0"));
          } catch {
            amt = "";
          }
          toast.success(`🎉 ${who} tipped you ${amt} APE`, { duration: 6000 });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [userId]);
  return null;
}

/** Miniature tip jar glyph. */
function TipJarIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect
        x="9"
        y="3"
        width="14"
        height="4"
        rx="1.5"
        fill="hsl(var(--gold, 43 74% 49%))"
        opacity="0.9"
      />
      <path
        d="M10 7h12v2.5c3 1.4 4.5 4 4.5 7.5v8.5A3.5 3.5 0 0 1 23 29H9a3.5 3.5 0 0 1-3.5-3.5V17c0-3.5 1.5-6.1 4.5-7.5V7z"
        fill="rgba(212,175,55,0.15)"
        stroke="rgb(212,175,55)"
        strokeWidth="1.5"
      />
      <circle cx="13" cy="22" r="3" fill="rgb(212,175,55)" />
      <circle cx="19.5" cy="19.5" r="2.5" fill="rgb(212,175,55)" opacity="0.8" />
      <text x="13" y="23.4" textAnchor="middle" fontSize="4" fontWeight="700" fill="#0a0a0a">
        A
      </text>
    </svg>
  );
}
