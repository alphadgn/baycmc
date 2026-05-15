/**
 * Entrance trigger.
 *
 * No dialog, no Tokenproof, no localStorage cache. The "Entrance" button
 * in the header opens Privy's own modal directly. After Privy login,
 * `PrivyBridge` (mounted at the root) signs the user into Supabase by
 * verifying on-chain BAYC/MAYC ownership.
 *
 * This file is kept as a named export `EntranceDialog` so AppHeader's
 * existing import keeps working with no further wiring. The `open` prop
 * is the trigger: when it flips to `true`, we call Privy's `login()` and
 * immediately set it back to `false` so re-clicks always re-open the modal.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPrivyPublicConfig } from "@/server/privy.functions";
import { usePrivyReady } from "@/components/PrivyAppProvider";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PrivyHooks = {
  usePrivy: () => {
    ready: boolean;
    authenticated: boolean;
    login: () => void;
  };
};

export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  const privyReady = usePrivyReady();
  const [hooks, setHooks] = useState<PrivyHooks | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const fetchConfig = useServerFn(getPrivyPublicConfig);
  const triggeredRef = useRef(false);

  // Lazy-load Privy hooks (SSR-unsafe SDK). Only after the PrivyProvider
  // has actually mounted — calling usePrivy outside it throws.
  useEffect(() => {
    if (!privyReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;
        const id = (cfg.appId ?? "").trim();
        const valid =
          cfg.configured && id.length >= 20 && id.length <= 40 && /^[a-z0-9]+$/i.test(id);
        setConfigured(valid);
        if (!valid) return;
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setHooks({ usePrivy: mod.usePrivy });
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig, privyReady]);

  return (
    <PrivyLoginTrigger
      open={open}
      onOpenChange={onOpenChange}
      hooks={privyReady ? hooks : null}
      configured={configured}
      triggeredRef={triggeredRef}
    />
  );
}

function PrivyLoginTrigger({
  open,
  onOpenChange,
  hooks,
  configured,
  triggeredRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hooks: PrivyHooks | null;
  configured: boolean | null;
  triggeredRef: React.MutableRefObject<boolean>;
}) {
  // Render-time hooks call requires unconditional ordering — gate the
  // wrapped component instead of the hook itself.
  if (!hooks) {
    return (
      <NoHooksTrigger
        open={open}
        onOpenChange={onOpenChange}
        configured={configured}
      />
    );
  }
  return (
    <WithHooks
      open={open}
      onOpenChange={onOpenChange}
      hooks={hooks}
      triggeredRef={triggeredRef}
    />
  );
}

function NoHooksTrigger({
  open,
  onOpenChange,
  configured,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configured: boolean | null;
}) {
  // Queue the intent: keep `open=true` until Privy hooks arrive, then
  // <WithHooks> will pick it up and call login(). Only close early if we
  // know wallet sign-in is permanently unavailable.
  useEffect(() => {
    if (!open) return;
    if (configured === false) {
      toast.error("Wallet sign-in is being set up. Please try again in a moment.");
      onOpenChange(false);
    }
  }, [open, configured, onOpenChange]);
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
  hooks: PrivyHooks;
  triggeredRef: React.MutableRefObject<boolean>;
}) {
  const { ready, authenticated, login } = hooks.usePrivy();

  useEffect(() => {
    if (!open) {
      triggeredRef.current = false;
      return;
    }
    if (triggeredRef.current) return;
    if (!ready) return;
    triggeredRef.current = true;
    if (authenticated) {
      // Already signed in to Privy — bridge handles Supabase session.
      onOpenChange(false);
      return;
    }
    try {
      login();
    } catch (e) {
      console.warn("[EntranceDialog] Privy login() threw:", e);
      toast.error("Couldn't open the wallet sign-in modal.");
    } finally {
      onOpenChange(false);
    }
  }, [open, ready, authenticated, login, onOpenChange, triggeredRef]);

  return null;
}
