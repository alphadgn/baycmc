/**
 * Entrance trigger.
 *
 * No dialog, no Tokenproof, no localStorage cache. The "VIP" / Entrance button
 * in the header opens Glyph's own login modal directly. After Glyph login,
 * <GlyphBridge> (mounted at the root) signs the user into Supabase by
 * verifying on-chain BAYC/MAYC ownership via a SIWE signature.
 *
 * This file is kept as a named export `EntranceDialog` so AppHeader's existing
 * import keeps working with no further wiring. The `open` prop is the trigger:
 * when it flips to `true`, we call Glyph's `login()` and immediately set it
 * back to `false` so re-clicks always re-open the modal.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useGlyphReady } from "@/components/GlyphAppProvider";
import { importWithRetry } from "@/lib/import-with-retry";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GlyphHookValue = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
};
type UseGlyph = () => GlyphHookValue;

function isFrameAncestorBlocked(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("frame ancestor");
}

export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  const glyphReady = useGlyphReady();
  const [useGlyph, setUseGlyph] = useState<UseGlyph | null>(null);
  const triggeredRef = useRef(false);

  // Lazy-load the useGlyph hook (SSR-unsafe SDK). Only after the GlyphProvider
  // has actually mounted — calling useGlyph outside it throws.
  useEffect(() => {
    if (!glyphReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await importWithRetry(() => import("@use-glyph/sdk-react"), {
          label: "glyph-sdk-react-entrance",
        });
        if (cancelled) return;
        setUseGlyph(() => mod.useGlyph as unknown as UseGlyph);
      } catch {
        /* provider boundary already renders children without Glyph */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [glyphReady]);

  if (!glyphReady || !useGlyph) {
    return <NoHooksTrigger open={open} onOpenChange={onOpenChange} ready={glyphReady} />;
  }
  return (
    <WithHooks
      open={open}
      onOpenChange={onOpenChange}
      useGlyph={useGlyph}
      triggeredRef={triggeredRef}
    />
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
  // Queue the intent: keep `open=true` until the hook arrives, then
  // <WithHooks> picks it up and calls login(). If the provider never became
  // ready, the boundary has already degraded — surface a gentle message.
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
  useGlyph,
  triggeredRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  useGlyph: UseGlyph;
  triggeredRef: React.MutableRefObject<boolean>;
}) {
  const { ready, authenticated, login } = useGlyph();

  useEffect(() => {
    if (!open) {
      triggeredRef.current = false;
      return;
    }
    if (triggeredRef.current) return;
    if (!ready) return;
    triggeredRef.current = true;
    if (authenticated) {
      // Already connected to Glyph — the bridge handles the Supabase session.
      onOpenChange(false);
      return;
    }
    try {
      login();
    } catch (e) {
      console.warn("[EntranceDialog] Glyph login() threw:", e);
      if (isFrameAncestorBlocked(e)) {
        toast.error("Wallet sign-in is blocked inside this embedded preview.", {
          description: "Open the preview in a new tab or use the published app to continue.",
          duration: 7000,
        });
      } else {
        toast.error("Couldn't open the wallet sign-in modal.");
      }
      triggeredRef.current = false;
    } finally {
      onOpenChange(false);
    }
  }, [open, ready, authenticated, login, onOpenChange, triggeredRef]);

  return null;
}
