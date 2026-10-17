/**
 * VIP Entrance modal — "sign in your way".
 *
 *   ① Glyph  — email, social login or an existing Glyph wallet, through
 *              Glyph's FACTORY flow: Glyph's own connector on Glyph's own
 *              chain config, connected exactly like Glyph's
 *              useNativeGlyphConnection() (connect({ connector }), no chain
 *              override).
 *   ② Wallet — any installed browser wallet (MetaMask, Rabby, Coinbase,
 *              Brave… discovered via EIP-6963), or WalletConnect for mobile
 *              wallets. On phones without an injected wallet we offer
 *              "open in wallet app" deep links.
 *
 * Either path then asks for ONE gasless SIWE signature ("Sign to enter"),
 * which the server verifies against a single-use nonce and checks BAYC/MAYC
 * ownership (direct, delegate.cash, or wallets you've linked).
 *
 * Previously the header VIP button fired Glyph's connect() immediately (no
 * choice), connect() rejections were unhandled, and external wallets were
 * impossible because the connector list contained only Glyph.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Mail, Wallet as WalletIcon, X, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useConnect, useDisconnect, useSignMessage, type Connector } from "wagmi";
import { useServerFn } from "@tanstack/react-start";
import { requestLinkedWalletNonce, verifyAndLinkWallet } from "@/lib/linked-wallets.functions";
import {
  GLYPH_CONNECTOR_ID,
  WALLETCONNECT_CONNECTOR_ID,
  useGlyphReady,
  useWalletStack,
} from "@/components/GlyphAppProvider";
import { walletLabel } from "@/lib/web3/injected-target";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { useAuth } from "@/lib/auth/useAuth";
import { useGlyphAuthState } from "@/lib/auth/useGlyphBridge";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "link" reuses the exact sign-in wallet list to attach another wallet. */
  mode?: "signin" | "link";
}

function sliceAddress(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function isMobile() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function inIframe() {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}
/**
 * The user closing a wallet / Glyph sheet is not an error. Glyph's sign-in
 * sheet (Privy) rejects with an EMPTY error when it's dismissed or handed
 * off in an in-app browser — that used to surface as "Couldn't connect."
 * even though nothing went wrong. Those are now silent.
 */
function isUserCancel(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return !msg.trim() || /rejected|denied|closed|cancel|exit|abort|dismiss/i.test(msg);
}
function friendlyConnectError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/frame ancestor|popup/i.test(msg) || inIframe()) {
    return "The sign-in popup was blocked. Allow popups, or open the site in its own tab (not an embedded preview).";
  }
  if (/already pending/i.test(msg))
    return "Check your wallet — a connection request is already open.";
  return msg || "Couldn't connect.";
}

type DisconnectFn = (args: { connector: Connector }) => Promise<void>;

/** End every trace of an existing session for this connector. */
async function resetConnectorSession(c: Connector, disconnectAsync: DisconnectFn) {
  await disconnectAsync({ connector: c }).catch(() => undefined);
  if (c.id === WALLETCONNECT_CONNECTOR_ID) {
    try {
      const provider = (await c.getProvider()) as {
        session?: unknown;
        disconnect?: () => Promise<void>;
      } | null;
      if (provider?.session && provider.disconnect) await provider.disconnect();
    } catch {
      /* no session to clear */
    }
  }
}

/**
 * Ask a browser wallet to show its account picker even if this site was
 * already approved (EIP-2255). Wallets without support just skip it.
 */
async function requestAccountPicker(c: Connector) {
  try {
    const provider = (await c.getProvider()) as {
      request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    } | null;
    await provider?.request?.({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (/rejected|denied/i.test(msg)) throw e; // user closed the picker
  }
}

export function EntranceDialog({ open, onOpenChange, mode = "signin" }: EntranceDialogProps) {
  const ready = useGlyphReady();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "link" ? "Add a wallet" : "VIP entrance"}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-default bg-black/90 backdrop-blur-md"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border-2 border-gold bg-card p-6 shadow-[0_0_0_1px_var(--gold),0_0_45px_-4px_oklch(0.82_0.15_80/0.65),0_25px_60px_-10px_rgb(0_0_0/0.9)] ring-1 ring-gold/40 ring-offset-4 ring-offset-black/0 animate-in zoom-in-95 fade-in-0 duration-200 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{ background: "var(--gradient-radial-gold)" }}
        />
        <button
          type="button"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-gold sm:text-xs">
          <span className="inline-block h-1.5 w-1.5 animate-pulse-glow rounded-full bg-gold" />
          Members only · BAYC/MAYC
        </div>
        <div className="mt-4">
          <EmbroideredImage
            variant="baycmc"
            size="lg"
            alt="BAYCmc"
            clamp="clamp(1.6rem, 8vw, 2.75rem)"
          />
        </div>
        <h2 className="mt-3 font-display text-2xl font-bold text-gradient-gold sm:text-3xl">
          {mode === "link" ? "Add a wallet" : "VIP Entrance"}
        </h2>
        {ready ? (
          <EntranceBody onOpenChange={onOpenChange} linking={mode === "link"} />
        ) : (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sign-in…
          </div>
        )}
      </div>
    </div>
  );
}

function EntranceBody({
  onOpenChange,
  linking,
}: {
  onOpenChange: (open: boolean) => void;
  linking: boolean;
}) {
  const { isAuthenticated, user } = useAuth();
  const { glyphLoaded, glyphError } = useWalletStack();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect, disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const requestNonce = useServerFn(requestLinkedWalletNonce);
  const verifyLink = useServerFn(verifyAndLinkWallet);
  const { isConnected, address, connector: active } = useAccount();
  const { verifying } = useGlyphAuthState();
  const [mode, setMode] = useState<"choose" | "wallets">("choose");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isWalletSession = !!user?.email?.endsWith("@wallet.baycmc.local");

  // Close once a WALLET session exists. (An email session that merely opened
  // this dialog to add a wallet stays open — that flow lives on Profile.)
  useEffect(() => {
    if (!linking && isAuthenticated && isWalletSession) onOpenChange(false);
  }, [linking, isAuthenticated, isWalletSession, onOpenChange]);

  const glyph = connectors.find((c) => c.id === GLYPH_CONNECTOR_ID);
  const wc = connectors.find((c) => c.id === WALLETCONNECT_CONNECTOR_ID);
  const browserWallets = useMemo(() => {
    const list = connectors.filter((c) => c.type === "injected" && c.id !== GLYPH_CONNECTOR_ID);
    // Prefer EIP-6963 named wallets; keep the generic "Injected" only if alone.
    const named = list.filter((c) => c.id !== "injected");
    return named.length > 0 ? named : list;
  }, [connectors]);
  const hasInjected =
    typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

  // Link flow: same wallet list as sign-in, always starting fresh. The chosen
  // wallet signs a single-use server nonce, then its session is closed again.
  async function linkWith(c: Connector) {
    setPendingId(c.uid);
    try {
      // Start FRESH, never from an "already connected" state:
      //  • end any wagmi connection this connector has (active or not);
      //  • WalletConnect keeps its own saved session and wagmi silently reuses
      //    it (no QR / wallet list) — kill that session first;
      //  • browser wallets hand back the already-approved account without
      //    asking — request permissions again so the account picker opens.
      await resetConnectorSession(c, disconnectAsync);
      if (c.type === "injected" && c.id !== GLYPH_CONNECTOR_ID) {
        await requestAccountPicker(c);
      }
      const res = await connectAsync({ connector: c });
      const target = res.accounts[0];
      if (!target) throw new Error("No account returned from wallet");
      const { message, nonce } = await requestNonce({ data: { address: target } });
      const signature = await signMessageAsync({ message, account: target, connector: c });
      const out = await verifyLink({
        data: { address: target, nonce, signature, label: walletLabel(c.name) },
      });
      if (!out.ok) throw new Error("Verification failed");
      toast.success("Wallet linked. Refreshing ownership…");
      window.dispatchEvent(new Event("baycmc:linked-wallets-changed"));
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      onOpenChange(false);
    } catch (e) {
      if (isUserCancel(e)) console.info("[wallet] connection closed", e);
      else toast.error(friendlyConnectError(e), { duration: 7000 });
    } finally {
      await disconnectAsync({ connector: c }).catch(() => undefined);
      setPendingId(null);
    }
  }

  async function connectWith(c: Connector) {
    if (linking) return linkWith(c);
    setPendingId(c.uid);
    try {
      // Called directly from the click so popups (Glyph) / extensions open.
      // Same call as Glyph's own useNativeGlyphConnection().connect().
      await connectAsync({ connector: c });
    } catch (e) {
      if (isUserCancel(e)) console.info("[wallet] connection closed", e);
      else toast.error(friendlyConnectError(e), { duration: 7000 });
    } finally {
      setPendingId(null);
    }
  }

  // Signed in with email/password already → link instead of switching accounts.
  if (!linking && isAuthenticated && !isWalletSession) {
    return (
      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>
          You're signed in with email. To unlock BAYC / MAYC rooms, link the wallet that holds your
          ape to this account — you'll sign one message from that wallet, no gas.
        </p>
        <Link
          to="/profile"
          onClick={() => onOpenChange(false)}
          className="inline-flex w-full items-center justify-center rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold"
        >
          Link a wallet on my profile
        </Link>
      </div>
    );
  }

  // Step 2 — wallet connected, one signature to enter.
  if (!linking && isConnected && address) {
    return (
      <div className="mt-2 space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Connected {active?.name ? `with ${walletLabel(active.name)}` : ""} as{" "}
          <span className="font-mono text-foreground">{sliceAddress(address)}</span>. Tap “Sign to
          enter” and approve the message — no gas, no transaction.
        </p>
        <button
          type="button"
          disabled={verifying}
          onClick={() => window.dispatchEvent(new Event("baycmc:wallet-verify"))}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {verifying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for signature…
            </>
          ) : (
            "Sign to enter"
          )}
        </button>
        <button
          type="button"
          onClick={() => disconnect()}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Use a different wallet or Glyph account
        </button>
      </div>
    );
  }

  const optionBtn =
    "flex w-full items-center gap-3 rounded-lg border border-gold/30 bg-secondary/30 px-4 py-3 text-left transition hover:border-gold/60 hover:bg-gold/10 disabled:cursor-wait disabled:opacity-60";

  if (mode === "wallets") {
    const here = encodeURIComponent(window.location.host + window.location.pathname);
    const fullUrl = encodeURIComponent(window.location.href);
    return (
      <div className="mt-3 space-y-2">
        {browserWallets.length > 0 && hasInjected ? (
          browserWallets.map((c) => (
            <button
              key={c.uid}
              type="button"
              disabled={isPending}
              onClick={() => void connectWith(c)}
              className={optionBtn}
            >
              {c.icon ? (
                <img src={c.icon} alt="" className="h-6 w-6 rounded" />
              ) : (
                <WalletIcon className="h-6 w-6 text-gold" />
              )}
              <span className="flex-1 text-sm font-semibold">{walletLabel(c.name)}</span>
              {pendingId === c.uid && <Loader2 className="h-4 w-4 animate-spin" />}
            </button>
          ))
        ) : (
          <p className="rounded-md border border-border/60 bg-black/30 p-3 text-xs text-muted-foreground">
            No browser wallet detected
            {isMobile()
              ? ` — open this page inside your wallet app${wc ? ", or use WalletConnect" : " (buttons below)"}.`
              : `. Install MetaMask / Rabby${wc ? ", or use WalletConnect" : ""}.`}
          </p>
        )}
        {wc && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => void connectWith(wc)}
            className={optionBtn}
          >
            <Smartphone className="h-6 w-6 text-gold" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">WalletConnect</span>
              <span className="block text-[11px] text-muted-foreground">
                Ledger Live, Trust, Rainbow, Uniswap & 400+ wallets
              </span>
            </span>
            {pendingId === wc.uid && <Loader2 className="h-4 w-4 animate-spin" />}
          </button>
        )}
        {!(browserWallets.length > 0 && hasInjected) && !wc && glyph && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => void connectWith(glyph)}
            className={optionBtn}
          >
            <Mail className="h-6 w-6 text-gold" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">Continue with Glyph</span>
              <span className="block text-[11px] text-muted-foreground">
                Sign in with email, social login or any wallet through Glyph
              </span>
            </span>
            {pendingId === glyph.uid && <Loader2 className="h-4 w-4 animate-spin" />}
          </button>
        )}
        {isMobile() && !hasInjected && (
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <a
              href={`https://metamask.app.link/dapp/${here}`}
              className="rounded-md border border-border px-3 py-2 text-center hover:border-gold/60"
            >
              Open in MetaMask
            </a>
            <a
              href={`https://go.cb-w.com/dapp?cb_url=${fullUrl}`}
              className="rounded-md border border-border px-3 py-2 text-center hover:border-gold/60"
            >
              Open in Coinbase Wallet
            </a>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMode("choose")}
          className="w-full pt-1 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {linking
          ? "Pick the wallet that holds (or is delegated) your NFTs. You'll sign one message — no gas."
          : null}
      </p>
      <p className={linking ? "hidden" : "text-sm leading-relaxed text-muted-foreground"}>
        Sign in your way. Holders unlock the BAYC / MAYC rooms; everyone gets the lobby, chat and
        karaoke.
      </p>
      <button
        type="button"
        disabled={!glyph || isPending}
        onClick={() => glyph && void connectWith(glyph)}
        className={optionBtn}
      >
        <Mail className="h-6 w-6 text-gold" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">Continue with Glyph</span>
          <span className="block text-[11px] text-muted-foreground">
            Email, social login or your Glyph wallet
          </span>
        </span>
        {(glyph && pendingId === glyph.uid) || (!glyphLoaded && !glyphError) ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
      </button>
      {glyphError && (
        <p className="text-[11px] text-amber-300">{glyphError} Use a wallet instead.</p>
      )}
      <p className="px-1 text-[10px] leading-snug text-muted-foreground">
        Glyph keeps its own account login on Glyph's site. If Glyph shows someone else's wallet, tap
        the person icon on Glyph's Approve screen to sign out of Glyph or switch accounts.
      </p>
      <button type="button" onClick={() => setMode("wallets")} className={optionBtn}>
        <WalletIcon className="h-6 w-6 text-gold" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">Connect a wallet</span>
          <span className="block text-[11px] text-muted-foreground">
            MetaMask, Rabby, Coinbase, WalletConnect…
          </span>
        </span>
      </button>
      <p className={linking ? "hidden" : "pt-1 text-center text-[11px] text-muted-foreground"}>
        Prefer a password?{" "}
        <Link
          to="/login"
          onClick={() => onOpenChange(false)}
          className="font-semibold text-gold hover:underline"
        >
          Email & password
        </Link>
      </p>
      <p className="text-center text-[10px] text-muted-foreground/70">
        Your ape lives in a cold wallet? Sign in with any wallet, then link the vault on your
        profile or delegate via delegate.xyz.
      </p>
    </div>
  );
}
