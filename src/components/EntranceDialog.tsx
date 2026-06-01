/**
 * Entrance trigger.
 *
 * No dialog, no Tokenproof, no localStorage cache. The "VIP" / Entrance button
 * in the header opens Glyph's connect popup directly (the Glyph Global Wallet,
 * via wagmi). After the wallet connects, <GlyphBridge> (mounted at the root)
 * signs the user into Supabase by verifying on-chain BAYC/MAYC ownership via a
 * single SIWE signature.
 *
 * This file is kept as a named export `EntranceDialog` so AppHeader's existing
 * import keeps working with no further wiring. The `open` prop is the trigger:
 * when it flips to `true`, we call Glyph's `connect()` and immediately set it
 * back to `false` so re-clicks always re-open the popup.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useGlyphReady } from "@/components/GlyphAppProvider";
import { importWithRetry } from "@/lib/import-with-retry";

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
  const triggeredRef = useRef(false);

  // Lazy-load the Glyph + wagmi hooks (SSR-unsafe SDK). Only after the
  // GlyphWalletProvider has actually mounted — calling these outside it throws.
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

  if (!glyphReady || !hooks) {
    return <NoHooksTrigger open={open} onOpenChange={onOpenChange} ready={glyphReady} />;
  }
  return (
    <WithHooks open={open} onOpenChange={onOpenChange} hooks={hooks} triggeredRef={triggeredRef} />
  );
}

function NoHooksTrigger({
  open,
  onOpenChange,
  ready,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
}) {
  // Queue the intent: keep `open=true` until the hooks arrive, then <WithHooks>
  // picks it up and calls connect(). If the provider never became ready, the
  // boundary has already degraded — surface a gentle message.
  useEffect(() => {
    if (!open) return;
    if (ready) return;
    const t = window.setTimeout(() => {
      toast.error("Wallet sign-in is taking a moment to load. Please try again.");
      onOpenChange(false);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [open, ready, onOpenChange]);
  return null;
}

function WithHooks({
  open,
  onOpenChange,
  hooks,
  triggeredRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hooks: EntranceHooks;
  triggeredRef: React.MutableRefObject<boolean>;
}) {
  const { connect } = hooks.useNativeGlyphConnection();
  const { isConnected } = hooks.useAccount();

  useEffect(() => {
    if (!open) {
      triggeredRef.current = false;
      return;
    }
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    if (isConnected) {
      // Wallet already connected — the bridge handles the Supabase session.
      onOpenChange(false);
      return;
    }
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
      triggeredRef.current = false;
    } finally {
      onOpenChange(false);
    }
  }, [open, isConnected, connect, onOpenChange, triggeredRef]);

  return null;
}
