import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import {
  startTokenproofSession,
  pollTokenproofSession,
} from "@/server/tokenproof.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Entrance modal — Tokenproof verification only.
 *
 * No wallet connect, no SIWE in-browser. The user authenticates via
 * tokenproof.xyz on their phone (scanning a QR), and Tokenproof attests
 * their BAYC/MAYC ownership. Our server polls Tokenproof and creates a
 * Supabase session on success.
 */
export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-3xl text-gradient-gold">Entrance</DialogTitle>
          <DialogDescription>
            Verify BAYC/MAYC ownership with Tokenproof. No wallet connection
            in your browser — scan a QR with the Tokenproof app to enter.
          </DialogDescription>
        </DialogHeader>
        <EntranceBody open={open} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

type Phase =
  | "idle"
  | "starting"
  | "waiting"
  | "verifying"
  | "done"
  | "error";

const SESSION_TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const MAX_TRANSIENT_ERRORS = 4;

function EntranceBody({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isAuthenticated } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const expiresAtRef = useRef<number | null>(null);
  const transientErrorsRef = useRef(0);

  function clearTimers() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function resetState() {
    clearTimers();
    setAuthUrl(null);
    setQrUrl(null);
    setErrorMsg(null);
    setSecondsLeft(0);
    expiresAtRef.current = null;
    transientErrorsRef.current = 0;
  }

  // Reset whenever the dialog closes so reopening gives a fresh start.
  useEffect(() => {
    if (!open) {
      resetState();
      setPhase("idle");
    }
  }, [open]);

  useEffect(() => () => clearTimers(), []);

  const startFn = useServerFn(startTokenproofSession);
  const pollFn = useServerFn(pollTokenproofSession);

  function failWith(message: string) {
    clearTimers();
    setErrorMsg(message);
    setPhase("error");
  }

  async function handleStart() {
    resetState();
    setPhase("starting");
    let started: { sessionId: string; authUrl: string; qrUrl: string; expiresAt: number };
    try {
      started = await startFn({ data: {} });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't start Tokenproof.";
      failWith(msg);
      return;
    }

    setAuthUrl(started.authUrl);
    setQrUrl(started.qrUrl);
    expiresAtRef.current = started.expiresAt;
    setSecondsLeft(Math.max(0, Math.round((started.expiresAt - Date.now()) / 1000)));
    setPhase("waiting");

    // Open hosted page on small screens — most people scan from a different
    // device, but on mobile it's faster to deep-link.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.open(started.authUrl, "_blank", "noopener,noreferrer");
    }

    // Countdown tick (display only — server still owns the canonical TTL)
    tickRef.current = window.setInterval(() => {
      if (!expiresAtRef.current) return;
      const left = Math.max(0, Math.round((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        failWith("Session timed out. Tap Try again to start a new one.");
      }
    }, 1000);

    // Poll for completion
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await pollFn({ data: { sessionId: started.sessionId } });
        transientErrorsRef.current = 0;

        if (res.status === "pending") return;

        if (res.status === "rejected" || res.status === "expired") {
          failWith(res.reason ?? `Tokenproof ${res.status}.`);
          return;
        }

        // verified
        clearTimers();
        setPhase("verifying");
        const { error } = await supabase.auth.setSession({
          access_token: res.session.access_token,
          refresh_token: res.session.refresh_token,
        });
        if (error) {
          failWith(error.message);
          return;
        }
        toast.success("Verified — BAYC/MAYC ownership confirmed");
        setPhase("done");
        onOpenChange(false);
      } catch (e) {
        transientErrorsRef.current += 1;
        if (transientErrorsRef.current >= MAX_TRANSIENT_ERRORS) {
          const msg =
            e instanceof Error
              ? e.message
              : "Lost connection to Tokenproof. Try again.";
          failWith(msg);
        }
        // Otherwise: silently keep polling — likely a transient network blip.
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  const showRetry = phase === "error";
  const buttonLabel =
    phase === "starting"
      ? "Preparing Tokenproof…"
      : phase === "verifying"
      ? "Signing you in…"
      : showRetry
      ? "Try again"
      : "Verify with Tokenproof";

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-gold/10 via-transparent to-accent/5 p-5">
        <div className="text-2xl font-bold text-gradient-gold">Tokenproof</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Required to enter every area of BAYCMC. Verifies BAYC/MAYC ownership
          via{" "}
          <a
            href="https://tokenproof.xyz"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-gold"
          >
            tokenproof.xyz
          </a>
          .
        </p>

        {phase === "waiting" && qrUrl ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <img
              src={qrUrl}
              alt="Scan with the Tokenproof app"
              className="h-48 w-48 rounded-md border border-gold/30 bg-white p-2"
            />
            <p className="text-center text-xs text-muted-foreground">
              Scan with the Tokenproof app, or{" "}
              <a
                href={authUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-gold"
              >
                open it directly
              </a>
              .
            </p>
            <p className="text-center text-[11px] text-muted-foreground">
              Waiting for approval — {formatTime(secondsLeft)} remaining
            </p>
            <button
              onClick={() => failWith("Cancelled. Tap Try again to restart.")}
              className="mt-1 rounded-md border border-border bg-secondary/30 px-3 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        ) : phase === "error" ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMsg ?? "Something went wrong."}
            </div>
            <button
              onClick={handleStart}
              className="w-full rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold hover:opacity-90"
            >
              {buttonLabel}
            </button>
          </div>
        ) : (
          <button
            onClick={handleStart}
            disabled={
              phase === "starting" || phase === "verifying" || phase === "done"
            }
            className="mt-4 w-full rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold transition disabled:opacity-50 hover:opacity-90"
          >
            {buttonLabel}
          </button>
        )}
      </div>

      {isAuthenticated && (
        <button
          onClick={handleSignOut}
          className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
