import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, QrCode, RefreshCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
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
 * Flow: tap Verify → server creates Tokenproof session → user gets a deep
 * link (copyable) and an on-demand QR. We poll until approved/rejected/
 * expired. On expiry, a new session is auto-created. After approval we
 * surface a BAYC or MAYC badge based on what Tokenproof returned.
 */
export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-3xl text-gradient-gold">Entrance</DialogTitle>
          <DialogDescription>
            Verify BAYC/MAYC ownership with Tokenproof. No wallet connection
            in your browser — approve the request in the Tokenproof app.
          </DialogDescription>
        </DialogHeader>
        <EntranceBody open={open} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

type ErrorKind = "network" | "rejected" | "credentials" | "timeout" | "unknown";
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

const ERROR_COPY: Record<ErrorKind, string> = {
  network:
    "We couldn't reach Tokenproof. Check your internet connection and try again.",
  rejected:
    "You declined the verification request. Tap Start over to try again.",
  credentials:
    "Tokenproof rejected our credentials. The site admin needs to update the API key — please try again later.",
  timeout:
    "Your verification session timed out. We started a new one — scan or tap to continue.",
  unknown:
    "Something went wrong. Tap Start over to begin a fresh verification.",
};

function classifyError(message: string | undefined | null): ErrorKind {
  const m = (message ?? "").toLowerCase();
  if (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("connection") ||
    m.includes("reach tokenproof")
  ) {
    return "network";
  }
  if (m.includes("declin") || m.includes("reject")) return "rejected";
  if (m.includes("credential") || m.includes("api key") || m.includes("api_key")) {
    return "credentials";
  }
  if (m.includes("timed out") || m.includes("timeout") || m.includes("expired")) {
    return "timeout";
  }
  return "unknown";
}

function EntranceBody({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isAuthenticated } = useAuth();
  const { collection: verifiedCollection, tokenProof } =
    useVerificationStatus();
  const [phase, setPhase] = useState<Phase>("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [verifiedAs, setVerifiedAs] = useState<"BAYC" | "MAYC" | null>(null);

  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const expiresAtRef = useRef<number | null>(null);
  const transientErrorsRef = useRef(0);
  const autoRestartedRef = useRef(false);

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
    setShowQr(false);
    setErrorKind(null);
    setSecondsLeft(0);
    expiresAtRef.current = null;
    transientErrorsRef.current = 0;
    autoRestartedRef.current = false;
  }

  // Reset whenever the dialog closes so reopening gives a fresh start.
  useEffect(() => {
    if (!open) {
      resetState();
      setPhase("idle");
      setVerifiedAs(null);
    }
  }, [open]);

  useEffect(() => () => clearTimers(), []);

  const startFn = useServerFn(startTokenproofSession);
  const pollFn = useServerFn(pollTokenproofSession);

  function failWith(kind: ErrorKind, opts?: { autoRestart?: boolean }) {
    clearTimers();
    setErrorKind(kind);
    setPhase("error");
    // Auto-restart the session for timeouts so the user doesn't have to
    // tap twice — the dialog is already open and they're waiting.
    if (opts?.autoRestart && !autoRestartedRef.current) {
      autoRestartedRef.current = true;
      window.setTimeout(() => {
        void handleStart();
      }, 600);
    }
  }

  async function handleStart() {
    resetState();
    setPhase("starting");
    let started: { sessionId: string; authUrl: string; qrUrl: string; expiresAt: number };
    try {
      started = await startFn({ data: {} });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      failWith(classifyError(msg));
      return;
    }

    setAuthUrl(started.authUrl);
    setQrUrl(started.qrUrl);
    expiresAtRef.current = started.expiresAt;
    setSecondsLeft(Math.max(0, Math.round((started.expiresAt - Date.now()) / 1000)));
    setPhase("waiting");

    // Countdown tick (display only — server still owns the canonical TTL)
    tickRef.current = window.setInterval(() => {
      if (!expiresAtRef.current) return;
      const left = Math.max(0, Math.round((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        failWith("timeout", { autoRestart: true });
      }
    }, 1000);

    // Poll for completion
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await pollFn({ data: { sessionId: started.sessionId } });
        transientErrorsRef.current = 0;

        if (res.status === "pending") return;

        if (res.status === "rejected") {
          failWith("rejected");
          return;
        }
        if (res.status === "expired") {
          failWith("timeout", { autoRestart: true });
          return;
        }
        if (res.status === "credentials") {
          failWith("credentials");
          return;
        }

        if (res.status === "verified") {
          clearTimers();
          setPhase("verifying");
          const { error } = await supabase.auth.setSession({
            access_token: res.session.access_token,
            refresh_token: res.session.refresh_token,
          });
          if (error) {
            failWith(classifyError(error.message));
            return;
          }
          setVerifiedAs(res.collection);
          toast.success(`Verified — ${res.collection} ownership confirmed`);
          setPhase("done");
          // Brief delay so the user sees the badge before close.
          window.setTimeout(() => onOpenChange(false), 1500);
        }
      } catch (e) {
        transientErrorsRef.current += 1;
        if (transientErrorsRef.current >= MAX_TRANSIENT_ERRORS) {
          const msg = e instanceof Error ? e.message : "";
          failWith(classifyError(msg) === "unknown" ? "network" : classifyError(msg));
        }
        // Otherwise: silently keep polling — likely a transient network blip.
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  async function handleCopyLink() {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      toast.success("Tokenproof link copied");
    } catch {
      toast.error("Couldn't copy — long-press the link to copy manually");
    }
  }

  const showRetry = phase === "error";
  const buttonLabel =
    phase === "starting"
      ? "Preparing Tokenproof…"
      : phase === "verifying"
      ? "Signing you in…"
      : showRetry
      ? "Start over"
      : "Verify with Tokenproof";

  const badgeCollection = verifiedAs ?? (tokenProof ? verifiedCollection : null);

  return (
    <div className="space-y-4 pt-2">
      {badgeCollection && (
        <div className="flex items-center justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse-glow" />
            Verified · {badgeCollection}
          </span>
        </div>
      )}

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

        {phase === "waiting" && authUrl ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-2">
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold hover:opacity-90"
              >
                <ExternalLink className="h-4 w-4" />
                Open in Tokenproof app
              </a>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleCopyLink}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy link
                </button>
                <button
                  onClick={() => setShowQr((v) => !v)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  {showQr ? "Hide QR" : "Show QR"}
                </button>
              </div>
            </div>

            {showQr && qrUrl && (
              <div className="flex flex-col items-center gap-2 pt-1">
                <img
                  src={qrUrl}
                  alt="Scan with the Tokenproof app"
                  className="h-44 w-44 rounded-md border border-gold/30 bg-white p-2"
                />
                <p className="text-center text-[11px] text-muted-foreground">
                  Scan with the Tokenproof app on your phone
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
              <span>Waiting for approval…</span>
              <span className="font-mono">{formatTime(secondsLeft)} left</span>
            </div>
            <button
              onClick={() => failWith("unknown")}
              className="w-full rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        ) : phase === "error" && errorKind ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ERROR_COPY[errorKind]}
            </div>
            <button
              onClick={handleStart}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" />
              {buttonLabel}
            </button>
          </div>
        ) : phase === "done" ? (
          <div className="mt-4 rounded-md border border-gold/30 bg-gold/5 px-3 py-3 text-center text-sm text-gold">
            You're in. Welcome to BAYCMC.
          </div>
        ) : (
          <button
            onClick={handleStart}
            disabled={phase === "starting" || phase === "verifying"}
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
