import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { verifyLuminaOwnership } from "@/server/lumina.functions";
import { toast } from "sonner";

interface VerifRow {
  bayc_verified: boolean;
  lumina_verified: boolean;
}

/**
 * User-facing verification status: shows BAYC ownership and Lumina
 * verification with explicit error states. Lumina re-check is manual per
 * product decision (no automatic call after on-chain check).
 */
export function VerificationStatusPanel() {
  const { user, loading: authLoading } = useAuth();
  const [row, setRow] = useState<VerifRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [luminaBusy, setLuminaBusy] = useState(false);
  const [luminaError, setLuminaError] = useState<string | null>(null);
  const verifyLumina = useServerFn(verifyLuminaOwnership);

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("user_verifications")
      .select("bayc_verified, lumina_verified")
      .eq("user_id", user.id)
      .maybeSingle();
    if (e) setError(e.message);
    setRow(data ?? { bayc_verified: false, lumina_verified: false });
    setLoading(false);
  }

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  async function handleLuminaCheck() {
    setLuminaBusy(true);
    setLuminaError(null);
    try {
      const res = await verifyLumina({ data: {} });
      if (res.ok) {
        toast.success(
          res.verified ? "Lumina ownership verified" : "Lumina did not detect ownership",
        );
        await load();
      } else {
        setLuminaError(res.error ?? "Lumina check failed");
      }
    } catch (e) {
      setLuminaError(e instanceof Error ? e.message : "Lumina check failed");
    } finally {
      setLuminaBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-gold" />
        <div className="text-lg font-semibold">Verification status</div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Your gated-access checks. BAYC unlocks the clubhouse; Lumina layers extra perks.
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Could not load status: {error}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <StatusRow
          label="BAYC verified"
          loading={loading}
          ok={!!row?.bayc_verified}
          hint={
            row?.bayc_verified
              ? "On-chain BAYC/MAYC ownership confirmed."
              : "Not yet verified. Sign in and approve a wallet signature to verify ownership."
          }
        />
        <StatusRow
          label="Lumina verified"
          loading={loading}
          ok={!!row?.lumina_verified}
          hint={
            row?.lumina_verified
              ? "Lumina confirmed ownership for your wallet."
              : "Run a Lumina check against your verified wallet."
          }
          action={
            <button
              onClick={handleLuminaCheck}
              disabled={luminaBusy}
              className="rounded-md border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-semibold text-gold hover:bg-gold/20 disabled:opacity-50"
            >
              {luminaBusy ? "Checking…" : row?.lumina_verified ? "Re-check" : "Check now"}
            </button>
          }
          error={luminaError}
        />
      </div>
    </div>
  );
}

function StatusRow({
  label,
  loading,
  ok,
  hint,
  action,
  error,
}: {
  label: string;
  loading: boolean;
  ok: boolean;
  hint: string;
  action?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : ok ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <span
            className={
              ok
                ? "rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-success"
                : "rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
            }
          >
            {loading ? "…" : ok ? "verified" : "not verified"}
          </span>
        </div>
        {action}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      {error && (
        <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
