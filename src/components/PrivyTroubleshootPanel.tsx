import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type ProbeStatus = "idle" | "checking" | "ok" | "blocked";

/**
 * In-app diagnostics for Privy iframe load failures.
 *
 * Privy's auth UI loads inside an iframe served from auth.privy.io. When the
 * current origin isn't on Privy's allowed Domains list, the browser blocks
 * the frame with either a "Frame ancestor is not allowed" CSP error or a
 * cross-origin SecurityError when our app touches the frame's window.
 *
 * We probe by mounting a hidden iframe and watching for a load event within
 * a timeout. No load → almost certainly frame-ancestor blocked.
 */
export function PrivyTroubleshootPanel() {
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [origin, setOrigin] = useState<string>("");
  const [open, setOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // Listen for the SecurityError that fires when Privy tries to read its
  // cross-origin iframe — that's a strong "blocked" signal too.
  useEffect(() => {
    function onErr(event: ErrorEvent | PromiseRejectionEvent) {
      const msg =
        ("message" in event && typeof event.message === "string"
          ? event.message
          : "") ||
        ("reason" in event && event.reason
          ? String((event.reason as Error).message ?? event.reason)
          : "");
      if (
        msg.includes("Blocked a frame") ||
        msg.includes("Frame ancestor") ||
        msg.toLowerCase().includes("frame-ancestor")
      ) {
        setStatus("blocked");
        setOpen(true);
      }
    }
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr as EventListener);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onErr as EventListener);
    };
  }, []);

  function runProbe() {
    setStatus("checking");
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = "https://auth.privy.io/";

    let settled = false;
    const finish = (next: ProbeStatus) => {
      if (settled) return;
      settled = true;
      setStatus(next);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      try {
        iframe.remove();
      } catch {
        /* noop */
      }
    };

    iframe.addEventListener("load", () => {
      // The iframe loaded — but if frame-ancestor is blocking us, the browser
      // serves a CSP error page. We can't read cross-origin contents, so a
      // successful load here means Privy *did* allow our origin.
      finish("ok");
    });
    iframe.addEventListener("error", () => finish("blocked"));

    document.body.appendChild(iframe);
    iframeRef.current = iframe;
    timeoutRef.current = window.setTimeout(() => finish("blocked"), 6000);
  }

  useEffect(() => {
    runProbe();
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      try {
        iframeRef.current?.remove();
      } catch {
        /* noop */
      }
    };
  }, []);

  // The full allowlist Privy needs: the live origin plus the stable
  // Lovable preview/published hosts. Including all of them up front means
  // the user only has to paste once and it keeps working across deploys.
  const PROJECT_ID = "098c1ce2-d90f-4478-895e-745a73b03b4b";
  const STATIC_ORIGINS = [
    `https://${PROJECT_ID}.lovableproject.com`,
    `https://id-preview--${PROJECT_ID}.lovable.app`,
    `https://project--${PROJECT_ID}.lovable.app`,
    `https://project--${PROJECT_ID}-dev.lovable.app`,
  ];
  const origins = Array.from(
    new Set([origin, ...STATIC_ORIGINS].filter(Boolean)),
  );
  const allowlistText = origins.join("\n");

  async function copyOrigins() {
    try {
      await navigator.clipboard.writeText(allowlistText);
      toast.success(`Copied ${origins.length} origins`);
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  }

  // Stay silent when everything looks fine and the user hasn't opened the panel.
  if (status === "ok" && !open) return null;

  return (
    <div
      data-testid="privy-troubleshoot-panel"
      data-status={status}
      className="rounded-xl border border-border bg-secondary/10 p-4"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {status === "blocked" ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : status === "ok" ? (
            <CheckCircle2 className="h-4 w-4 text-gold" />
          ) : (
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {status === "blocked"
            ? "Wallet sign-in blocked: Privy iframe failed (frame-ancestors / CSP)"
            : status === "ok"
            ? "Privy connection: OK"
            : "Checking Privy connection…"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {open ? "Hide" : "Details"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-xs text-muted-foreground">
          {status === "blocked" ? (
            <>
              <p>
                Privy's iframe refused to load on this device. This is almost
                always because the current site origin isn't on Privy's
                <span className="font-medium text-foreground"> Allowed Domains </span>
                list. Add the origin below in your Privy dashboard
                (Settings → Domains), then tap Re-check.
              </p>
              <textarea
                data-testid="privy-allowlist-textarea"
                readOnly
                rows={origins.length}
                value={allowlistText}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
                className="w-full resize-none rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] text-foreground"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  data-testid="privy-allowlist-copy"
                  onClick={copyOrigins}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] hover:bg-secondary"
                >
                  <Copy className="h-3 w-3" />
                  Copy all origins
                </button>
                <a
                  href="https://dashboard.privy.io"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] hover:bg-secondary"
                >
                  Open Privy dashboard
                </a>
                <button
                  onClick={runProbe}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gradient-gold px-2.5 py-1.5 text-[11px] font-semibold text-gold-foreground hover:opacity-90"
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-check
                </button>
              </div>
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                Tokenproof above still works while this is being fixed.
              </p>
            </>
          ) : (
            <p>
              Privy's iframe loads from this device. If sign-in still fails,
              re-check after refreshing the page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
