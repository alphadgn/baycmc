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
 * No wallet connect, no SIWE signature in-browser. The user authenticates
 * via tokenproof.xyz on their phone (scanning a QR), and Tokenproof attests
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
            Verify BAYC or MAYC ownership with Tokenproof. No wallet connection
            in your browser — scan a QR with the Tokenproof app to enter.
          </DialogDescription>
        </DialogHeader>
        <EntranceBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

type Phase = "idle" | "starting" | "waiting" | "done";

function EntranceBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { isAuthenticated } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const startFn = useServerFn(startTokenproofSession);
  const pollFn = useServerFn(pollTokenproofSession);

  async function handleStart() {
    try {
      setPhase("starting");
      const { sessionId, authUrl, qrUrl } = await startFn({ data: {} });
      setAuthUrl(authUrl);
      setQrUrl(qrUrl);
      setPhase("waiting");

      // Open the hosted Tokenproof page in a new tab as a fallback for desktop
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        window.open(authUrl, "_blank", "noopener,noreferrer");
      }

      // Poll the server for completion
      pollRef.current = window.setInterval(async () => {
        try {
          const res = await pollFn({ data: { sessionId } });
          if (res.status === "verified" && res.session) {
            window.clearInterval(pollRef.current!);
            const { error } = await supabase.auth.setSession({
              access_token: res.session.access_token,
              refresh_token: res.session.refresh_token,
            });
            if (error) throw error;
            toast.success(
              `Verified — ${res.collection ?? "BAYC/MAYC"} ownership confirmed`,
            );
            setPhase("done");
            onOpenChange(false);
          } else if (res.status === "rejected" || res.status === "expired") {
            window.clearInterval(pollRef.current!);
            toast.error(`Tokenproof ${res.status}`);
            setPhase("idle");
            setAuthUrl(null);
            setQrUrl(null);
          }
        } catch (e) {
          window.clearInterval(pollRef.current!);
          toast.error(e instanceof Error ? e.message : "Verification failed");
          setPhase("idle");
        }
      }, 2500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start Tokenproof");
      setPhase("idle");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-gold/10 via-transparent to-accent/5 p-5">
        <div className="text-2xl font-bold text-gradient-gold">Tokenproof</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Required to enter every area of BAYCMC. Verifies BAYC or MAYC
          ownership via{" "}
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
              Waiting for approval…
            </p>
          </div>
        ) : (
          <button
            onClick={handleStart}
            disabled={phase === "starting"}
            className="mt-4 w-full rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold transition disabled:opacity-50 hover:opacity-90"
          >
            {phase === "starting"
              ? "Preparing Tokenproof…"
              : "Verify with Tokenproof"}
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
