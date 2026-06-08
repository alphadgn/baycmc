/**
 * VIP Entrance modal.
 *
 * Clicking "VIP" in the header opens this branded modal (styled like the main
 * entrance — gold radial wash + glass card). Confirming hands off to Glyph's
 * own connect popup (the Glyph Global Wallet, via wagmi). After the wallet
 * connects, <GlyphBridge> (mounted at the root) signs the user into Supabase
 * by verifying on-chain BAYC/MAYC ownership via a single SIWE signature.
 *
 * Kept as a named export `EntranceDialog` so AppHeader's existing import keeps
 * working. The `open` prop drives visibility; `onOpenChange(false)` closes it.
 */
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useGlyphReady } from "@/components/GlyphAppProvider";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { importWithRetry } from "@/lib/import-with-retry";
import { useAuth } from "@/lib/auth/useAuth";
import { useGlyphAuthState } from "@/lib/auth/useGlyphBridge";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GlyphConnection = { connect: () => void; disconnect: () => void };
type UseNativeGlyphConnection = () => GlyphConnection;
type AccountValue = { isConnected: boolean };
type UseAccount = () => AccountValue;
type EntranceHooks = {
  useNativeGlyphConnection: UseNativeGlyphConnection;
  useAccount: UseAccount;
};

function isFrameAncestorBlocked(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("frame ancestor");
}

export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  const glyphReady = useGlyphReady();
  const [hooks, setHooks] = useState<EntranceHooks | null>(null);

  useEffect(() => {
    if (open) console.log("[ENTRANCE MODAL OPEN]");
  }, [open]);

  // Lazy-load the Glyph + wagmi hooks (SSR-unsafe SDK). Only after the
  // GlyphWalletProvider has mounted — calling these outside it throws.
  useEffect(() => {
    if (!glyphReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const [glyphMod, wagmiMod] = await Promise.all([
          importWithRetry(() => import("@use-glyph/sdk-react"), {
            label: "glyph-sdk-react-entrance",
          }),
          importWithRetry(() => import("wagmi"), { label: "wagmi-entrance" }),
        ]);
        if (cancelled) return;
        setHooks(() => ({
          useNativeGlyphConnection:
            glyphMod.useNativeGlyphConnection as unknown as UseNativeGlyphConnection,
          useAccount: wagmiMod.useAccount as unknown as UseAccount,
        }));
      } catch {
        /* provider boundary already renders children without Glyph */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [glyphReady]);

  if (!open) return null;
  return <EntranceModal onOpenChange={onOpenChange} hooks={hooks} ready={glyphReady} />;
}

function EntranceModal({
  onOpenChange,
  hooks,
  ready,
}: {
  onOpenChange: (open: boolean) => void;
  hooks: EntranceHooks | null;
  ready: boolean;
}) {
  // Hooks must be called unconditionally and only when present — render a
  // hookless variant until the SDK loads so ordering stays stable.
  if (!hooks) {
    return (
      <EntranceModalShell
        onOpenChange={onOpenChange}
        ready={ready}
        connect={null}
        isConnected={false}
      />
    );
  }
  return <EntranceModalWithHooks onOpenChange={onOpenChange} hooks={hooks} />;
}

function EntranceModalWithHooks({
  onOpenChange,
  hooks,
}: {
  onOpenChange: (open: boolean) => void;
  hooks: EntranceHooks;
}) {
  const { connect } = hooks.useNativeGlyphConnection();
  const { isConnected } = hooks.useAccount();
  const { isAuthenticated } = useAuth();
  const { verifying } = useGlyphAuthState();

  // Close once the Supabase session exists (sign-in complete). We intentionally
  // keep the modal open after the wallet merely connects so the user can tap
  // "Sign to enter" — the wallet signing popup can only open from that tap.
  useEffect(() => {
    if (isAuthenticated) onOpenChange(false);
  }, [isAuthenticated, onOpenChange]);

  return (
    <EntranceModalShell
      onOpenChange={onOpenChange}
      ready
      connect={connect}
      isConnected={isConnected}
      verifying={verifying}
    />
  );
}

function EntranceModalShell({
  onOpenChange,
  ready,
  connect,
  isConnected,
  verifying = false,
}: {
  onOpenChange: (open: boolean) => void;
  ready: boolean;
  connect: (() => void) | null;
  isConnected: boolean;
  verifying?: boolean;
}) {
  const [connecting, setConnecting] = useState(false);
  const canConnect = ready && !!connect && !isConnected;
  // Two phases: connect the wallet, then sign one message to enter. Once the
  // wallet is connected the modal switches to the sign step.
  const phase: "connect" | "sign" = isConnected ? "sign" : "connect";

  // Fire the SIWE signature inside this click. dispatchEvent runs the bridge's
  // listener synchronously, so signMessage is reached within the user gesture
  // and the wallet's signing popup is allowed to open.
  function handleSign() {
    window.dispatchEvent(new Event("baycmc:wallet-verify"));
  }

  // Escape closes the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  function handleConnect() {
    if (!connect) return;
    setConnecting(true);
    try {
      connect();
    } catch (e) {
      console.warn("[EntranceDialog] Glyph connect() threw:", e);
      if (isFrameAncestorBlocked(e)) {
        toast.error("Wallet sign-in is blocked inside this embedded preview.", {
          description: "Open the preview in a new tab or use the published app to continue.",
          duration: 7000,
        });
      } else {
        toast.error("Couldn't open the wallet sign-in popup.");
      }
      setConnecting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="VIP entrance"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Card — mirrors the landing hero: gold radial wash + glass. */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gold/30 bg-card/90 p-6 shadow-card backdrop-blur sm:p-8">
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
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold animate-pulse-glow" />
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
          VIP Entrance
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {phase === "sign"
            ? "Wallet connected. Tap “Sign to enter” and approve the one-tap message to verify holdings — no gas, no transaction."
            : "Connect your Glyph wallet to verify holdings for access into gated areas of the BAYCmc. No gas, no transaction."}
        </p>

        {phase === "sign" ? (
          <button
            type="button"
            disabled={verifying}
            onClick={handleSign}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {verifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing…
              </>
            ) : (
              "Sign to enter"
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canConnect || connecting}
            onClick={handleConnect}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {!ready ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading wallet…
              </>
            ) : connecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Look for the popup…
              </>
            ) : (
              "Connect wallet"
            )}
          </button>
        )}

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Powered by Glyph · ApeChain
        </p>
      </div>
    </div>
  );
}
